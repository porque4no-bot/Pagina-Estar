const fs = require('fs');
const path = require('path');
require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  getQuoteStore, loadQuote, saveQuote, effectiveStatus, computeQuoteTotal
} = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, releaseHold, buildExtrasFromQuote, postOrderExtrasToFolio, insertReservation } = require('./_otasync');
const { loadIntent: loadGuestPaymentIntent, markIntentStatus: markGuestPaymentStatus, GUEST_ORDER_REF_RE } = require('./_guest-payments');
const { verifyDirectBookingAmount, EXTRAS_KEYS, EXTRAS_PRICES } = require('./_direct-pricing');
const { sendEmail, adminEmail, paymentConfirmationHtml, adminPendingHtml, paymentPendingHtml, paymentRejectedHtml } = require('./_email');
const { acquireQuoteLock, releaseQuoteLock } = require('./_quote-lock');
const { trackPurchase } = require('./_analytics');
const { sendConfirmationEmail } = require('./send-confirmation');
const { savePaymentDetails } = require('./_payment-details');
const { flag, get } = require('./_settings');

const QUOTE_ID_RE = /^COT-\d{4}-[A-Z0-9]{5}$/;

/* Session key (pkey) shared across functions via Netlify Blobs.
   See _otasync.getSessionKey for the implementation. */
const { getSessionKey: sharedGetSessionKey } = require('./_otasync');

// In-memory simple processed transaction ID deduplicator (warm instances).
// Capped at 500 entries to prevent unbounded growth on long-lived containers.
const processedTransactionIds = new Set();
function addProcessedTransaction(id) {
  if (processedTransactionIds.size >= 500) {
    processedTransactionIds.delete(processedTransactionIds.values().next().value);
  }
  processedTransactionIds.add(id);
}

// Persistent deduplication store (survives cold starts)
let txStore;
try {
  txStore = getStore({ name: 'processed-transactions', consistency: 'strong' });
} catch (e) {
  if (process.env.DEBUG) console.warn('[dedup] Blobs unavailable, using in-memory dedup only:', e.message);
  txStore = null;
}

// Helper to get session key from Kunas PMS — delegates to shared store
async function getSessionKey(_token, _username, _password) {
  return sharedGetSessionKey();
}

async function readResponseSnippet(response) {
  try {
    const text = await response.text();
    return String(text || '').replace(/\s+/g, ' ').slice(0, 1000);
  } catch (e) {
    return '';
  }
}

async function findAvailableRoomId({ token, pkey, propertyId, checkin, checkout, roomTypeId }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch('https://app.otasync.me/api/room/data/available_rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        key: pkey,
        id_properties: propertyId,
        dfrom: checkin,
        dto: checkout,
        id_room_types: parseInt(roomTypeId, 10),
        include_id_reservations: 0,
        exclude_id_rooms: []
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
  } catch (err) {
    clearTimeout(timeoutId);
    if (process.env.DEBUG) console.warn('[wompi-webhook] available room lookup failed:', err.message);
    return 0;
  }

  if (!response.ok) {
    const detail = await readResponseSnippet(response);
    console.warn(`[wompi-webhook] available_rooms returned ${response.status}${detail ? ': ' + detail : ''}`);
    return 0;
  }

  try {
    const data = await response.json();
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const first = rooms.find(r => String(r.id_room_types) === String(roomTypeId) && r.id_rooms) || rooms.find(r => r.id_rooms);
    return first && first.id_rooms ? parseInt(first.id_rooms, 10) || 0 : 0;
  } catch (e) {
    console.warn('[wompi-webhook] available_rooms returned invalid JSON:', e.message);
    return 0;
  }
}

// Sanitize phone: only digits, +, spaces
function sanitizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[^\d+\s]/g, '').trim().substring(0, 20);
}

// Escape HTML special characters to prevent XSS in PMS notes
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeNotes(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return escapeHtml(raw).substring(0, 500);
}

/* A8: guest free-text note → PMS. Gated OFF by default. Gestionable desde
   /admin (override del panel → env). */
async function notesToPmsEnabled() { return await flag('GUEST_NOTES_TO_PMS_ENABLED'); }

// Helper to decode the URL-safe base64 reference string
function decodeReference(ref) {
  try {
    if (!ref || !/^[a-zA-Z0-9\-_]+$/.test(ref)) {
      return null;
    }
    let base64 = ref.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    if (!decoded.startsWith('1|')) {
      return null;
    }
    const parts = decoded.split('|');
    if (parts.length < 11) {
      return null;
    }
    const [
      version,
      checkinYYMMDD,
      checkoutYYMMDD,
      guestsCount,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask,
      bookingCode
    ] = parts;
    const result = {
      bookingCode,
      checkin: `20${checkinYYMMDD.substring(0, 2)}-${checkinYYMMDD.substring(2, 4)}-${checkinYYMMDD.substring(4, 6)}`,
      checkout: `20${checkoutYYMMDD.substring(0, 2)}-${checkoutYYMMDD.substring(2, 4)}-${checkoutYYMMDD.substring(4, 6)}`,
      guestsCount: parseInt(guestsCount) || 1,
      roomTypeId,
      firstName,
      lastName,
      email,
      phone,
      extrasMask,
      // Optional flags encoded at positions 11 and 12
      isColombian: parts[11] === '1' ? true : parts[11] === '0' ? false : undefined,
      isBusiness:  parts[12] === '1' ? true : parts[12] === '0' ? false : undefined
    };
    if (parts[13]) {
      result.amountCents = parseInt(parts[13], 10) || 0;
    }
    /* Plan tarifario elegido por el huésped (pos. 14). 'F' = Flexible
       (100% hasta 24 h), 'B' = Best/Estricta (100% hasta 7 días). Referencias
       antiguas no lo traen → queda undefined (trazabilidad best-effort). */
    if (parts[14]) {
      result.ratePlan = parts[14] === 'F' ? 'flexible' : 'best';
    }
    return result;
  } catch (err) {
    console.error("Error decoding reference:", err.message);
    return null;
  }
}

function computeWompiChecksum(body, secret) {
  const properties = body?.signature?.properties;
  if (!Array.isArray(properties) || body?.timestamp === undefined || !secret) {
    throw new Error('Firma Wompi incompleta');
  }

  let dataToSign = '';
  for (const prop of properties) {
    if (typeof prop !== 'string' || !/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/.test(prop)) {
      throw new Error(`Ruta de firma Wompi inválida: ${prop}`);
    }

    let value = body.data;
    for (const key of prop.split('.')) {
      if (value === null || typeof value !== 'object'
        || !Object.prototype.hasOwnProperty.call(value, key)) {
        throw new Error(`Propiedad de firma Wompi no encontrada: ${prop}`);
      }
      value = value[key];
    }
    dataToSign += String(value);
  }

  return crypto
    .createHash('sha256')
    .update(dataToSign + String(body.timestamp) + secret)
    .digest('hex');
}

function verifyWompiSignature(body, receivedSignature, secret) {
  if (typeof receivedSignature !== 'string' || !/^[a-f0-9]{64}$/i.test(receivedSignature)) {
    return false;
  }

  const expectedSignature = computeWompiChecksum(body, secret);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(receivedSignature, 'hex')
  );
}

/* Frente C — decide la salida a Odoo del huésped directo según el opt-in de
   marketing (persistido por create-wompi-signature). Ley 1581: solo con opt-in
   explícito se añade el tag 'Opt-in marketing' (además del tag de canal) y se
   marca para Email Marketing. Sin opt-in → solo el partner, sin marketing.
   Pura/testeable: no toca red ni Blobs. */
function buildGuestMarketing(decoded, marketingOptIn) {
  const optIn = Boolean(marketingOptIn && marketingOptIn.accepted === true);
  const tags = ['Huésped directo'];
  if (optIn) tags.push('Opt-in marketing');
  return {
    optIn,
    tags,
    /* addToMailingList solo con opt-in y email presente. */
    addToMailing: Boolean(optIn && decoded && decoded.email)
  };
}

function mustChargeDirectBookingIva(decoded) {
  if (decoded?.isColombian !== undefined || decoded?.isBusiness !== undefined) {
    return Boolean(decoded.isColombian || decoded.isBusiness);
  }

  const cleanPhone = sanitizePhone(decoded?.phone).replace(/\s+/g, '');
  return cleanPhone.startsWith('+57')
    || cleanPhone.startsWith('57')
    || (cleanPhone.length === 10 && cleanPhone.startsWith('3'));
}

function directBookingPricing(decoded, paidAmount) {
  const mustPayIva = mustChargeDirectBookingIva(decoded);
  /* La mascota ($200k) viaja con IVA incluido: se excluye de la base de IVA
     (el cobro online ya la incluye, no se vuelve a gravar en el alojamiento). */
  const mascotaIdx = EXTRAS_KEYS.indexOf('mascota');
  const mascotaCharge = (mascotaIdx >= 0 && decoded?.extrasMask && decoded.extrasMask[mascotaIdx] === '1')
    ? (EXTRAS_PRICES.mascota?.price || 0) : 0;
  const taxableBase = Math.max(0, paidAmount - mascotaCharge);
  const ivaAmount = Math.round(taxableBase * 0.19);
  return {
    mustPayIva,
    ivaAmount,
    ivaNote: mustPayIva
      ? `POR COBRAR EN ALOJAMIENTO (${ivaAmount})`
      : `EXENTO PRELIMINAR - validar documento y motivo; si no corresponde, cobrar IVA (${ivaAmount})`,
    roomPrice: mustPayIva ? Math.round(taxableBase * 1.19) + mascotaCharge : paidAmount
  };
}

/* Server-side confirmation email for a direct booking. The webhook is the
   RELIABLE trigger: if the guest closes the tab after paying (or the Wompi
   redirect never returns to the site), the client-side send in motor-app never
   fires — but the reservation already exists. Idempotent with that client send
   (sendConfirmationEmail dedups on the booking code), so the guest gets exactly
   one email. `breakfast` is derived from the extras mask (position of 'desayuno'
   in EXTRAS_KEYS) so the email carries the QR breakfast-pass link when due.
   Never throws: the payment is captured and the reservation created, so an email
   failure must not surface as a webhook error. */
async function sendDirectBookingConfirmation(args, overrides = {}) {
  const send = overrides.sendConfirmationEmail || sendConfirmationEmail;
  const { decoded, displayBookingCode, roomName, nights, paidAmount, totalAmount } = args || {};
  try {
    if (!decoded || !decoded.email) return { sent: false, reason: 'no-email' };
    const breakfastIdx = EXTRAS_KEYS.indexOf('desayuno');
    const breakfast = breakfastIdx >= 0 && String(decoded.extrasMask || '')[breakfastIdx] === '1';
    return await send({
      guestEmail: decoded.email,
      guestName: `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim() || decoded.email,
      bookingCode: displayBookingCode,
      roomName,
      checkIn: decoded.checkin,
      checkOut: decoded.checkout,
      nights,
      totalAmount,
      paidAmount,
      phone: sanitizePhone(decoded.phone),
      breakfast,
      via: 'webhook'
    });
  } catch (e) {
    console.error(`[wompi-webhook] confirmation email failed (non-fatal): ${e.message}. bookingCode=${displayBookingCode}`);
    return { sent: false, reason: 'error', error: e.message };
  }
}

// Helper to obfuscate base64 references for logs
function obfuscateReference(ref) {
  if (!ref || typeof ref !== 'string') return '';
  return ref.length > 8 ? `${ref.substring(0, 4)}...${ref.substring(ref.length - 4)}` : '***';
}

/* ── Guest notifications for non-approved payments ──────────────────────
   Deduped in a store SEPARATE from 'processed-transactions': marking a
   PENDING transaction there would make its later APPROVED webhook look like
   a duplicate and skip the reservation. This store only dedupes the
   courtesy emails. Mirrored in mercadopago-webhook.js (rollback provider). */
let paymentEmailStore;
try {
  paymentEmailStore = getStore({ name: 'payment-failure-emails', consistency: 'strong' });
} catch (e) {
  if (process.env.DEBUG) console.warn('[payment-emails] Blobs unavailable, using in-memory dedup only:', e.message);
  paymentEmailStore = null;
}
const sentPaymentEmails = new Set();

/* True the first time a (transaction, kind) pair is seen. Marked BEFORE the
   send so concurrent webhook retries can't double-email; a courtesy email
   lost to a send failure is not retried. If Blobs is unavailable we still
   send — Wompi retries webhooks, so a duplicate email is possible, but
   that's preferable to the guest never learning the outcome. */
async function shouldSendPaymentEmail(transactionId, kind) {
  const key = `wompi-${transactionId}-${kind}`;
  if (sentPaymentEmails.has(key)) return false;
  /* Cap igual que processedTransactionIds, para no crecer sin límite en
     instancias calientes de larga vida. */
  if (sentPaymentEmails.size >= 500) sentPaymentEmails.delete(sentPaymentEmails.values().next().value);
  sentPaymentEmails.add(key);
  if (paymentEmailStore) {
    try {
      if (await paymentEmailStore.get(key)) return false;
      await paymentEmailStore.set(key, '1');
    } catch (e) {
      if (process.env.DEBUG) console.warn('[payment-emails] dedup store failed:', e.message);
    }
  }
  return true;
}

function paymentDeclinedEmailHtml({ name, code, retryUrl }) {
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A3B12;">Tu pago no pudo procesarse</h2>
    <p>Hola ${escapeHtml(name) || 'viajero/a'},</p>
    <p>Tu entidad financiera no aprobó el pago de tu reserva${code ? ` <strong>${escapeHtml(String(code))}</strong>` : ''} en Hotel Estar. <strong>No se realizó ningún cobro</strong> y la reserva no quedó confirmada.</p>
    <p>Los motivos más comunes son:</p>
    <ul>
      <li>Fondos insuficientes o cupo de la tarjeta excedido</li>
      <li>Límites para compras por internet configurados con tu banco</li>
      <li>Verificación 3D Secure no completada</li>
    </ul>
    <p>Puedes intentarlo de nuevo cuando quieras:</p>
    <p><a href="${retryUrl}" style="display:inline-block;padding:12px 24px;background:#2C2C2C;border-radius:8px;color:#fff;text-decoration:none;font-size:13px;">Reintentar mi reserva</a></p>
    <p style="font-size:12px;color:#9A9A8A;">¿Necesitas ayuda? Escríbenos a reservas@estar.com.co o al +57 310 249 0414.</p>
  </body></html>`;
}

function paymentPendingEmailHtml({ name, code }) {
  return `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A6A2E;">Tu pago está en proceso</h2>
    <p>Hola ${escapeHtml(name) || 'viajero/a'},</p>
    <p>Tu banco aún está procesando el pago de tu reserva${code ? ` <strong>${escapeHtml(String(code))}</strong>` : ''} en Hotel Estar. Esto puede tomar unos minutos.</p>
    <p>Apenas el banco apruebe la transacción te enviaremos la confirmación automáticamente — no necesitas hacer nada más.</p>
    <p><strong>Importante: no vuelvas a pagar.</strong> Un segundo intento podría generar un cobro doble.</p>
    <p style="font-size:12px;color:#9A9A8A;">¿Dudas? Escríbenos a reservas@estar.com.co o al +57 310 249 0414.</p>
  </body></html>`;
}

/* Email the guest when a payment is declined/voided/errored ('declined') or
   still being processed by the bank ('pending'). Direct bookings encode the
   guest in the reference itself; COT- quotes store the contact in Blobs.
   Never throws — guest notifications must not affect webhook processing. */
async function notifyGuestPaymentOutcome(transaction, kind, overrides = {}) {
  const deps = { sendEmail, getQuoteStore, loadQuote, effectiveStatus, ...overrides };
  try {
    if (!(await shouldSendPaymentEmail(transaction.id, kind))) return;

    let contact = null;
    if (QUOTE_ID_RE.test(transaction.reference || '')) {
      // Corporate quote: the contact lives in the stored quote.
      const store = deps.getQuoteStore();
      const quote = await deps.loadQuote(store, transaction.reference);
      /* No contradecir una cotización ya resuelta: si ya está aceptada (reserva
         confirmada) o cancelada/vencida, no enviar "tu pago no pudo procesarse". */
      const qStatus = quote ? deps.effectiveStatus(quote) : null;
      if (quote && quote.email && qStatus !== 'aceptada' && qStatus !== 'cancelada' && qStatus !== 'vencida') {
        const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
        contact = {
          email: quote.email,
          name: quote.contacto || quote.empresa || '',
          code: transaction.reference,
          retryUrl: quote.publicToken
            ? `${base}/cotizacion.html?id=${encodeURIComponent(transaction.reference)}&t=${encodeURIComponent(quote.publicToken)}`
            : `${base}/empresas.html`
        };
      }
    } else {
      // Direct booking: the guest is encoded in the reference itself.
      const decoded = decodeReference(transaction.reference);
      if (decoded && decoded.email) {
        contact = {
          email: decoded.email,
          name: decoded.firstName || '',
          code: decoded.bookingCode || '',
          retryUrl: 'https://estar.com.co/reservar.html'
        };
      }
    }
    if (!contact) return;

    await deps.sendEmail({
      to: contact.email,
      subject: kind === 'pending'
        ? 'Tu pago está en proceso — Hotel Estar'
        : 'Tu pago no pudo procesarse — Hotel Estar',
      html: kind === 'pending' ? paymentPendingHtml({ contact }) : paymentRejectedHtml({ contact })
    });
  } catch (e) {
    console.error(`[wompi-webhook] guest ${kind} payment email failed:`, e.message);
  }
}

// Build OTASync reservation rooms array from quote items (expands `unidades`).
function buildQuoteRooms(quote, roomDetails) {
  const rooms = [];
  (quote.items || []).forEach(it => {
    const nights = it.noches || 1;
    const avgPrice = it.tarifaPorNoche || 0;
    const totalPrice = avgPrice * nights;
    const matched = roomDetails[it.roomTypeId];
    const roomName = (matched && matched.name) || it.habitacion || 'Clásica';

    const nightsArray = [];
    const baseDate = new Date(quote.checkin);
    for (let n = 0; n < nights; n++) {
      const d = new Date(baseDate);
      d.setDate(d.getDate() + n);
      nightsArray.push({
        night_date: d.toISOString().split('T')[0],
        price: avgPrice,
        original_price: avgPrice,
        breakfast: 0, lunch: 0, dinner: 0
      });
    }

    const units = Math.max(1, it.unidades || 1);
    for (let u = 0; u < units; u++) {
      rooms.push({
        id_room_types: parseInt(it.roomTypeId) || 0,
        id_rooms: 0,
        room_type: roomName,
        room_number: "",
        avg_price: avgPrice,
        total_price: totalPrice,
        children_1: 0, children_2: 0, children_3: 0,
        adults: 1, seniors: 0,
        extras: [],
        payments: [],
        overbooking: 0,
        nights: nightsArray
      });
    }
  });
  return rooms;
}

/* Handle a Wompi payment whose reference is a guest-app service order (GST-...).
   Loads the payment intent, verifies the paid amount matches what we signed,
   posts the charge + payment onto the reservation folio in OTASync/Kunas, and
   marks the intent paid (idempotent on the intent status). add_extra/add_payment
   are NOT idempotent in OTASync and the caller pre-marks the transaction as
   processed, so we never auto-retry: on a folio failure we flag the intent for
   manual follow-up rather than risk duplicate folio lines. */
async function handleGuestServicePayment(transaction, corsHeaders, overrides = {}) {
  const deps = {
    loadIntent: loadGuestPaymentIntent,
    markIntentStatus: markGuestPaymentStatus,
    postOrderToFolio: postOrderExtrasToFolio,
    ...overrides
  };
  const reference = transaction.reference;
  const reply = (obj) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(obj) });

  let intent;
  try {
    intent = await deps.loadIntent(reference);
  } catch (e) {
    console.error('[wompi-webhook] guest-payment store unavailable:', e.message);
    return reply({ message: 'Guest payment store unavailable; logged for manual follow-up' });
  }
  if (!intent) {
    console.error(`[wompi-webhook] guest order ${reference} not found for paid transaction ${transaction.id}`);
    return reply({ message: 'Guest order intent not found' });
  }
  if (intent.status === 'paid') {
    return reply({ received: true, duplicate: true });
  }

  // Defense in depth: only post the amount we signed for this order.
  const paidCents = Number(transaction.amount_in_cents);
  const expectedCents = Number(intent.amountInCents);
  if (Number.isFinite(paidCents) && Number.isFinite(expectedCents) && paidCents !== expectedCents) {
    console.error(`[wompi-webhook] guest order ${reference} amount mismatch: paid=${paidCents}, expected=${expectedCents}, tx=${transaction.id}. Not posting; manual follow-up.`);
    await deps.markIntentStatus(reference, 'amount_mismatch', { transactionId: transaction.id, paidCents });
    return reply({ message: 'Amount mismatch; logged for manual follow-up' });
  }

  try {
    const result = await deps.postOrderToFolio({
      idReservations: intent.bookingCode,
      items: intent.items,
      payment: { amount: expectedCents / 100, method: 'card', note: `Pago en línea Wompi ${transaction.id}` }
    });
    await deps.markIntentStatus(reference, 'paid', {
      transactionId: transaction.id, paidAt: new Date().toISOString(), folio: result
    });
    return reply({ received: true, folio: result });
  } catch (e) {
    console.error(`[wompi-webhook] guest order ${reference} folio posting failed for paid transaction ${transaction.id}: ${e.message}. MANUAL follow-up required.`);
    await deps.markIntentStatus(reference, 'paid_folio_failed', { transactionId: transaction.id, error: e.message });
    return reply({ message: 'Paid but folio posting failed; logged for manual follow-up' });
  }
}

// Handle a Wompi payment whose reference is a stored quote id (COT-...).
// Loads the quote, verifies the amount, creates the OTASync reservation and
// marks the quote as 'aceptada'. Returns a Netlify response object.
// The per-quote lock that prevents concurrent webhooks from double-booking
// lives in ./_quote-lock so the MercadoPago webhook can share it.
async function handleQuotePayment(transaction, corsHeaders, overrides = {}) {
  const deps = {
    getQuoteStore,
    loadQuote,
    saveQuote,
    effectiveStatus,
    computeQuoteTotal,
    releaseHold,
    getAvailabilityByType,
    findUnavailable,
    buildExtrasFromQuote,
    sendEmail,
    adminEmail,
    paymentConfirmationHtml,
    adminPendingHtml,
    getSessionKey,
    fetch,
    acquireQuoteLock,
    releaseQuoteLock,
    ...overrides
  };
  const quoteId = transaction.reference;

  let store, quote;
  try {
    store = deps.getQuoteStore();
    quote = await deps.loadQuote(store, quoteId);
  } catch (e) {
    console.error('[wompi-webhook] quote store unavailable:', e.message);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote store unavailable; logged for manual follow-up' }) };
  }

  if (!quote) {
    console.error(`[wompi-webhook] quote ${quoteId} not found for paid transaction ${transaction.id}`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote not found' }) };
  }

  // Idempotent: already accepted
  if (quote.status === 'aceptada') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  const status = deps.effectiveStatus(quote);
  if (status === 'cancelada' || status === 'vencida') {
    console.error(`[wompi-webhook] paid transaction ${transaction.id} for ${status} quote ${quoteId}. Manual follow-up required.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: `Quote is ${status}; logged for manual follow-up` }) };
  }

  /* Single-writer lock per quoteId. If two Wompi webhooks for the same quote
     arrive in parallel (e.g. two transactions with different ids both APPROVED
     against the same reference), the second one is refused and logged for
     manual handling — better than double-booking in OTASync. */
  const lock = await deps.acquireQuoteLock(quoteId, transaction.id);
  if (!lock.acquired) {
    console.error(`[wompi-webhook] quote ${quoteId} is already being processed by tx ${lock.ownerTx} (started ${lock.startedAt}). Refusing tx ${transaction.id}.`);
    try {
      await deps.sendEmail({
        to: deps.adminEmail(),
        subject: `⚠ Doble pago detectado — ${quoteId}`,
        html: `<p>La cotización <strong>${quoteId}</strong> recibió un segundo pago aprobado mientras procesábamos el primero.</p>
               <ul>
                 <li>Primera transacción (en curso): ${lock.ownerTx}</li>
                 <li>Segunda transacción (rechazada): ${transaction.id}</li>
               </ul>
               <p>Verifica con Wompi y reembolsa la transacción duplicada.</p>`
      });
    } catch (e) { console.error('[wompi-webhook] double-pay alert email failed:', e.message); }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote already being processed by another transaction', ownerTx: lock.ownerTx }) };
  }

  /* Wrap the rest of processing so the lock is always released on exit.
     The quote is saved as 'aceptada' before the lock is released, so
     a concurrent webhook retrying after release hits the duplicate check. */
  try {

  // Verify the paid amount matches the server-computed total (anti-tampering).
  const { totalCents } = deps.computeQuoteTotal(quote);
  const paidCents = transaction.amount_in_cents;
  if (Math.abs(paidCents - totalCents) > 100) {
    console.error(`[wompi-webhook] amount mismatch for quote ${quoteId}: paid=${paidCents} expected=${totalCents}, tx=${transaction.id}. Reservation NOT created; manual follow-up required.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Amount mismatch; logged for manual follow-up' }) };
  }

  const now = new Date().toISOString();
  const paidAmount = paidCents / 100;

  // Kunas credentials
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';
  const channelId = process.env.OTASYNC_CHANNEL_ID || '66483';
  const channelName = process.env.OTASYNC_CHANNEL_NAME || 'Pagina web';
  const hasCredentials = token && username && password;

  // Without PMS credentials we still mark the quote paid (mock / local).
  if (!hasCredentials) {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.bookingCodes = [];
    quote.updatedAt = now;
    try { await deps.saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, mock: true, quoteId }) };
  }

  const hasHold = Array.isArray(quote.holdReservationIds) && quote.holdReservationIds.length > 0;

  // Release any tentative hold first so the units free up for the confirmed
  // reservation (and so the availability check below doesn't see our own hold).
  if (hasHold) {
    for (const holdId of quote.holdReservationIds) {
      try { await deps.releaseHold(holdId); } catch (e) { console.error('[wompi-webhook] releaseHold failed for', quoteId, holdId, e.message); }
    }
    quote.holdReservationIds = [];
  }

  // Final availability check before booking (skipped when a hold guaranteed the
  // rooms). Payment already happened, so if rooms are no longer free we must NOT
  // overbook: mark paid but leave the reservation pending for manual handling.
  if (!hasHold && quote.checkin && quote.checkout) {
    try {
      const { availByType, isMock } = await deps.getAvailabilityByType(quote.checkin, quote.checkout);
      if (!isMock) {
        const shortfalls = deps.findUnavailable(quote.items, availByType);
        if (shortfalls.length > 0) {
          console.error(`[wompi-webhook] PAID but UNAVAILABLE for quote ${quoteId}, tx ${transaction.id}: ${JSON.stringify(shortfalls)}. Reservation NOT created; manual handling required.`);
          quote.status = 'aceptada';
          quote.paidAt = now;
          quote.transactionId = transaction.id;
          quote.bookingCodes = [];
          quote.reservationPending = true;
          quote.availabilityOk = false;
          quote.unavailable = shortfalls;
          quote.updatedAt = now;
          try { await deps.saveQuote(store, quote); } catch (e) { /* non-fatal */ }
          try {
            await deps.sendEmail({
              to: deps.adminEmail(),
              subject: `⚠ Pago sin reserva — ${quoteId}`,
              html: deps.adminPendingHtml({ quote, transactionId: transaction.id, shortfalls })
            });
          } catch (e) { console.error('[wompi-webhook] admin alert email failed:', e.message); }
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
        }
      }
    } catch (e) {
      console.error('[wompi-webhook] availability re-check failed; marking reservation pending:', e.message);
      quote.status = 'aceptada';
      quote.paidAt = now;
      quote.transactionId = transaction.id;
      quote.bookingCodes = [];
      quote.reservationPending = true;
      quote.availabilityOk = false;
      quote.updatedAt = now;
      try { await deps.saveQuote(store, quote); } catch (saveErr) { console.error('[wompi-webhook] failed to mark pending:', saveErr.message); }
      try {
        await deps.sendEmail({
          to: deps.adminEmail(),
          subject: `Pago pendiente de verificación — ${quoteId}`,
          html: deps.adminPendingHtml({ quote, transactionId: transaction.id, shortfalls: [{ reason: 'availability_check_failed' }] })
        });
      } catch (mailErr) { console.error('[wompi-webhook] admin alert email failed:', mailErr.message); }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
    }
  }

  // Payment is already captured and this tx is deduped, so any failure while
  // creating the reservation must NOT be lost: record the quote as paid+pending
  // and alert the admin so it can be retried from the portal.
  const recordPending = async (reason) => {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.bookingCodes = [];
    quote.reservationPending = true;
    quote.updatedAt = now;
    try { await deps.saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    try {
      await deps.sendEmail({
        to: deps.adminEmail(),
        subject: `⚠ Pago sin reserva — ${quoteId}`,
        html: deps.adminPendingHtml({ quote, transactionId: transaction.id, shortfalls: [] })
      });
    } catch (e) { console.error('[wompi-webhook] admin alert email failed:', e.message); }
    console.error(`[wompi-webhook] reservation ${reason} for quote ${quoteId}, tx ${transaction.id}; marked reservationPending.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
  };

  let roomDetails = {};
  try {
    const dbPath = path.join(__dirname, '../../rooms_db.json');
    if (fs.existsSync(dbPath)) roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch (e) { /* names fall back to quote item habitacion */ }

  let pkey;
  try {
    pkey = await deps.getSessionKey(token, username, password);
  } catch (e) {
    return await recordPending('auth failed: ' + e.message);
  }

  const rooms = buildQuoteRooms(quote, roomDetails);
  const roomsPrice = rooms.reduce((s, r) => s + r.total_price, 0);
  const { extras: quoteExtras, extrasPrice } = deps.buildExtrasFromQuote(quote);
  const totalGuests = quote.numPersonas || rooms.length || 1;

  const contacto = (quote.contacto || quote.empresa || 'Empresa').trim();
  const nameParts = contacto.split(/\s+/);
  const firstName = nameParts.shift() || quote.empresa || 'Empresa';
  const lastName = nameParts.join(' ') || quote.empresa || '';

  const nights = Math.max(1, Math.round((new Date(quote.checkout) - new Date(quote.checkin)) / 86400000) || 1);
  const nightsDates = [];
  for (let n = 0; n < nights; n++) {
    const d = new Date(quote.checkin);
    d.setDate(d.getDate() + n);
    nightsDates.push(d.toISOString().split('T')[0]);
  }

  const paymentInfo = [{
    amount: paidAmount,
    payment_date: now.split('T')[0],
    payment_method: 'card',
    note: `Wompi ID: ${transaction.id}, Cotización: ${quoteId}, Status: APPROVED`
  }];

  const note = `Reserva corporativa desde cotización ${quoteId}. Empresa: ${escapeHtml(quote.empresa || '')}. NIT: ${escapeHtml(quote.nit || 'N/D')}. Contacto: ${escapeHtml(contacto)} / ${sanitizePhone(quote.telefono)} / ${escapeHtml(quote.email || '')}. Total pagado: ${paidAmount}. ID Transacción: ${transaction.id}`;

  const reservationPayload = {
    key: pkey,
    id_properties: propertyId,
    token: token,
    status: "confirmed",
    rooms,
    guests: [{ first_name: firstName, last_name: lastName, email: quote.email || '', id_guests: 0, guest_type: "adults" }],
    extras: quoteExtras,
    payments: paymentInfo,
    children_1: 0, children_2: 0, children_3: 0,
    adults: totalGuests, seniors: 0,
    total_guests: totalGuests,
    discount_type: "percent",
    discount_amount: 0,
    discount_note: "",
    rooms_price: roomsPrice,
    rooms_discounted: roomsPrice,
    extras_price: extrasPrice,
    board_price: 0,
    city_tax_price: 0,
    insurance_price: 0,
    total_price: roomsPrice + extrasPrice,
    id_boards: "",
    id_reservations: 0,
    nights: nights,
    nights_dates: nightsDates,
    reservation_type: "web",
    active_id_room_types: String((quote.items[0] && quote.items[0].roomTypeId) || ''),
    preselected_id_rooms: 0,
    reference: quoteId,
    id_contigents: 0,
    date_arrival: quote.checkin,
    date_departure: quote.checkout,
    guest_email: quote.email || '',
    id_channels: channelId,
    channel: channelName,
    note
  };

  const insertController = new AbortController();
  const insertTimeoutId = setTimeout(() => insertController.abort(), 10000);

  let response;
  try {
    response = await deps.fetch('https://app.otasync.me/api/reservation/insert/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reservationPayload),
      signal: insertController.signal
    });
    clearTimeout(insertTimeoutId);
  } catch (err) {
    clearTimeout(insertTimeoutId);
    return await recordPending('threw: ' + err.message);
  }

  if (!response.ok) {
    return await recordPending('returned status ' + response.status);
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    return await recordPending('returned non-JSON body');
  }
  const bookingCode = data.id_reservations || quoteId;

  quote.status = 'aceptada';
  quote.paidAt = now;
  quote.transactionId = transaction.id;
  quote.bookingCodes = [bookingCode];
  quote.reservationPending = false;
  quote.updatedAt = now;
  try { await deps.saveQuote(store, quote); } catch (e) { console.error('[wompi-webhook] failed to mark quote accepted:', e.message); }

  try {
    if (quote.email) {
      await deps.sendEmail({
        to: quote.email,
        cc: deps.adminEmail(),
        subject: `Reserva confirmada ${bookingCode} — Hotel Estar`,
        html: deps.paymentConfirmationHtml({ quote, bookingCode, total: paidAmount })
      });
    }
  } catch (e) { console.error('[wompi-webhook] confirmation email failed:', e.message); }

    /* Snapshot refund-relevant payment fields at payment time (durable), so a
       later refund/ticket has auth code, date, last-4 and value without digging
       in the Wompi panel. Best-effort — never blocks. */
    await savePaymentDetails(bookingCode, transaction);

    /* A-6: server-side conversion for corporate quote payments. */
    try {
      await trackPurchase({ transactionId: String(bookingCode), value: paidAmount });
    } catch (e) { /* analytics never blocks */ }

    /* Maestro de clientes (Fase 1): la empresa pagadora queda como partner en
       Odoo. Va DESPUÉS de crear la reserva y guardar la cotización como aceptada,
       para que una demora/caída de Odoo nunca impida la reserva ya pagada
       (mismo orden seguro que la reserva directa). No fatal. */
    try {
      const { upsertPartner } = require('./_odoo');
      await upsertPartner({
        name: quote.empresa || quote.contacto || 'Empresa',
        vat: quote.nit,
        email: quote.email,
        phone: sanitizePhone(quote.telefono),
        isCompany: true,
        tags: ['Corporativo'],
        comment: `Cliente corporativo. Cotización ${quoteId}${quote.contacto ? '. Contacto: ' + quote.contacto : ''}.`
      });
    } catch (odooErr) {
      console.error('[wompi-webhook] Odoo upsert (cotización) no fatal:', odooErr.message);
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };
  } finally {
    if (!lock.blobsUnavailable) await deps.releaseQuoteLock(quoteId);
  }
}

exports.handler = async (event, context) => {
  // CORS Headers
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, X-Event-Checksum',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (allowedOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' })
    };
  }

  const MAX_BODY_SIZE = 10000; // 10 KB
  if (event.body && event.body.length > MAX_BODY_SIZE) {
    return { statusCode: 413, body: JSON.stringify({ error: 'Payload too large' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON request body' })
    };
  }

  // Wompi Signature Verification — MANDATORY
  const receivedSignature = event.headers['x-event-checksum'] || (body.signature && body.signature.checksum);
  const WOMPI_WEBHOOK_SECRET = process.env.WOMPI_WEBHOOK_SECRET;

  if (!WOMPI_WEBHOOK_SECRET) {
    console.error('CRITICAL: WOMPI_WEBHOOK_SECRET is not configured. Rejecting webhook.');
    try {
      await require('./_alert').reportAlert({
        kind: 'wompi_webhook_misconfig', severity: 'critical',
        message: 'WOMPI_WEBHOOK_SECRET no está configurado: el webhook rechaza TODOS los pagos (reservas no se crean).',
        dedupeKey: 'wompi-secret-missing'
      });
    } catch (_) { /* alerta best-effort */ }
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Webhook secret not configured on server' })
    };
  }

  if (!body.signature || !body.signature.properties || !receivedSignature) {
    console.error("Wompi signature verification failed: signature, properties, or checksum is missing.");
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Unauthorized. Missing signature components.' })
    };
  }

  try {
    if (!verifyWompiSignature(body, String(receivedSignature), WOMPI_WEBHOOK_SECRET)) {
      console.error("Wompi signature verification failed");
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Unauthorized. Invalid signature.' })
      };
    }
    if (process.env.DEBUG) console.log("Wompi signature successfully verified");
  } catch (sigErr) {
    console.error("Error verifying Wompi signature:", sigErr.message);
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Signature verification processing error' })
    };
  }

  const { event: eventName, data } = body;
  
  if (eventName !== 'transaction.updated') {
    if (process.env.DEBUG) console.log(`Ignoring unsupported Wompi event: ${eventName}`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Event ${eventName} ignored` })
    };
  }

  const transaction = data && data.transaction;
  if (!transaction) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing transaction data' })
    };
  }

  if (process.env.DEBUG) console.log(`Processing Wompi webhook: transaction.id=${transaction.id}, reference=${obfuscateReference(transaction.reference)}, status=${transaction.status}`);

  if (transaction.status === 'DECLINED' || transaction.status === 'VOIDED' || transaction.status === 'ERROR') {
    const failedDecoded = decodeReference(transaction.reference);
    const bookingCodeForLog = failedDecoded ? failedDecoded.bookingCode : transaction.reference;
    console.error(`FAILED PAYMENT — status=${transaction.status}, transactionId=${transaction.id}, bookingCode=${bookingCodeForLog}, amount_cents=${transaction.amount_in_cents}, reference=${obfuscateReference(transaction.reference)}. Manual follow-up required.`);
    /* Email al huésped solo para rechazos genuinos. VOIDED = transacción que fue
       APROBADA y luego anulada/revertida (sí hubo cobro), así que "no se realizó
       ningún cobro" sería falso; VOIDED solo se registra para seguimiento manual. */
    if (transaction.status === 'DECLINED' || transaction.status === 'ERROR') {
      await notifyGuestPaymentOutcome(transaction, 'declined');
    }
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Transaction ${transaction.status}. Logged for manual follow-up.` })
    };
  }

  if (transaction.status !== 'APPROVED') {
    if (transaction.status === 'PENDING') {
      // Bank still processing: warn the guest not to pay again (double charge).
      await notifyGuestPaymentOutcome(transaction, 'pending');
    }
    if (process.env.DEBUG) console.log(`Transaction status is not APPROVED: ${transaction.status}. Skipping PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Transaction status is ${transaction.status}. Skipping.` })
    };
  }

  // Check simple in-memory deduplication (fast path for warm instances)
  if (processedTransactionIds.has(transaction.id)) {
    if (process.env.DEBUG) console.log(`Transaction ${transaction.id} was already processed by this container. Skipping duplicate PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ received: true, duplicate: true })
    };
  }

  // Check persistent store (definitive check for cold starts)
  if (txStore) {
    try {
      const seen = await txStore.get(String(transaction.id));
      if (seen) {
        if (process.env.DEBUG) console.log(`[dedup] Transaction ${transaction.id} already processed (persistent)`);
        return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
      }
    } catch (e) {
      if (process.env.DEBUG) console.warn('[dedup] Failed to check persistent store:', e.message);
    }
  }

  // Guest-app service order paid online: reference is the order eventId (GST-...).
  // A-13: enrutar SIEMPRE al handler de servicio si la referencia es GST- (no
  // depender del GUEST_SERVICE_PAYMENT_MODE actual). El handler es idempotente y,
  // si no existe el intent, responde 200 sin efecto. Depender del modo estrancaba
  // el pago cuando el admin lo cambiaba entre el checkout y la llegada del webhook.
  if (GUEST_ORDER_REF_RE.test(transaction.reference || '')) {
    addProcessedTransaction(transaction.id);
    if (txStore) {
      try { await txStore.set(String(transaction.id), '1', { ttl: 86400 }); } catch (e) { /* non-fatal */ }
    }
    return await handleGuestServicePayment(transaction, corsHeaders);
  }

  // Corporate quote payment: reference is a stored quote id (COT-...).
  if (QUOTE_ID_RE.test(transaction.reference || '')) {
    // Mark processed before doing work to avoid duplicate reservations on retries
    addProcessedTransaction(transaction.id);
    if (txStore) {
      try { await txStore.set(String(transaction.id), '1', { ttl: 86400 }); } catch (e) { /* non-fatal */ }
    }
    return await handleQuotePayment(transaction, corsHeaders);
  }

  // Decode the reservation details from the transaction reference
  const decoded = decodeReference(transaction.reference);
  if (!decoded) {
    if (process.env.DEBUG) console.warn(`Wompi transaction reference ${obfuscateReference(transaction.reference)} is not a valid encoded reservation. Skipping PMS insertion.`);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: 'Reference was not an encoded reservation payload' })
    };
  }

  // Mark as processed in both in-memory and persistent store
  addProcessedTransaction(transaction.id);
  if (txStore) {
    try {
      await txStore.set(String(transaction.id), '1', { ttl: 86400 }); // 24h TTL
    } catch (e) {
      if (process.env.DEBUG) console.warn('[dedup] Failed to store transaction ID:', e.message);
    }
  }

  // Check if create-booking already registered this reservation (prevents duplicate OTASync insertion)
  let directBookingResultStore;
  try {
    directBookingResultStore = getStore({ name: 'booking-results', consistency: 'strong' });
    const cached = await directBookingResultStore.get(`direct-${decoded.bookingCode}`);
    if (cached) {
      const cachedData = JSON.parse(cached);
      if (process.env.DEBUG) console.log(`[wompi-webhook] Booking ${decoded.bookingCode} already in booking-results (created by create-booking). Skipping duplicate OTASync insertion.`);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ success: true, bookingCode: cachedData.bookingCode, duplicate: true })
      };
    }
  } catch (e) {
    if (process.env.DEBUG) console.warn('[wompi-webhook] booking-results store check failed:', e.message);
    directBookingResultStore = null;
  }

  // Kunas Credentials from Environment
  const token = process.env.OTASYNC_TOKEN || '';
  const username = process.env.OTASYNC_USERNAME || '';
  const password = process.env.OTASYNC_PASSWORD || '';
  const propertyId = process.env.OTASYNC_PROPERTY_ID || '9889';
  const channelId = process.env.OTASYNC_CHANNEL_ID || '66483';
  const channelName = process.env.OTASYNC_CHANNEL_NAME || 'Pagina web';

  const hasCredentials = token && username && password;
  if (!hasCredentials) {
    if (process.env.DEBUG) console.warn("Kunas credentials not configured. Simulating successful webhook insertion.");
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Mock booking confirmed. Credentials missing on Netlify.',
        bookingCode: decoded.bookingCode
      })
    };
  }

  /* Frente A: load any discount applied at signing time (persisted by
     create-wompi-signature keyed by bookingCode). When present we MUST re-validate
     the code here (not expired / not exhausted / fechas) BEFORE creating the
     reservation, and recompute the expected DISCOUNTED amount from OTASync — this
     overrides the reference's encoded amountCents so a tampered low amount cannot
     slip through. The code never traveled in the reference. Gated OFF by default. */
  let appliedDiscount = null;
  if ((await flag('DISCOUNT_CODES_ENABLED')) && decoded.bookingCode) {
    try {
      const discStore = getStore({ name: 'booking-discounts', consistency: 'strong' });
      const raw = await discStore.get(`disc-${decoded.bookingCode}`);
      if (raw) appliedDiscount = JSON.parse(raw);
    } catch (e) {
      if (process.env.DEBUG) console.warn('[wompi-webhook] discount blob read failed (non-fatal):', e.message);
    }
  }

  /* Server-side price verification: if the reference encodes the price,
     compare the paid amount directly. Otherwise, fall back to recomputing
     from OTASync availability. This prevents post-payment rate changes
     from blocking approved transactions. */
  let priceVerifyOk = true;
  let priceReason = '';
  let expectedCentsForAlert = 0;
  let discountVerdict = null;

  if (appliedDiscount && appliedDiscount.code && appliedDiscount.signedAmountCents != null && Number.isFinite(Number(appliedDiscount.signedAmountCents))) {
    /* El monto CON descuento ya quedó fijado por la firma de integridad Wompi al
       firmar (paid == signed, garantía de Wompi). Confiar en ese monto en vez de
       re-validar el código: si el cupón cruzó vencimiento/cupo/blackout ENTRE la
       firma y el webhook, un pago legítimo con descuento NO debe rechazarse
       (quedaría cobrado sin reserva). consumeDiscountUse (CAS, más abajo) sigue
       siendo el ÚNICO guardián del cupo. */
    const signed = Number(appliedDiscount.signedAmountCents);
    if (Math.abs(transaction.amount_in_cents - signed) > 100) {
      priceVerifyOk = false;
      priceReason = 'amount_mismatch_signed_discount';
      expectedCentsForAlert = signed;
    }
  } else if (appliedDiscount && appliedDiscount.code) {
    /* Blob de descuento viejo sin signedAmountCents → re-validar como antes. */
    try {
      discountVerdict = await verifyDirectBookingAmount(decoded, transaction.amount_in_cents, {
        discountCode: appliedDiscount.code,
        email: appliedDiscount.email || decoded.email || ''
      });
      if (!discountVerdict.ok) {
        priceVerifyOk = false;
        priceReason = (discountVerdict.discount && discountVerdict.discount.applied === false && discountVerdict.discount.reason)
          ? `discount_${discountVerdict.discount.reason}`
          : discountVerdict.reason;
        expectedCentsForAlert = discountVerdict.expectedCentsAll ? discountVerdict.expectedCentsAll[0] : discountVerdict.expectedCents;
      }
      if (discountVerdict.isMock) {
        console.warn(`[wompi-webhook] OTASync mock fallback — skipping discounted price verification. bookingCode=${decoded.bookingCode}, tx=${transaction.id}`);
      }
    } catch (priceErr) {
      console.error('[wompi-webhook] discounted price verification threw, proceeding:', priceErr.message);
    }
  } else if (decoded.amountCents !== undefined) {
    if (Math.abs(transaction.amount_in_cents - decoded.amountCents) > 100) {
      priceVerifyOk = false;
      priceReason = 'amount_mismatch_reference';
      expectedCentsForAlert = decoded.amountCents;
    }
  } else {
    try {
      const verdict = await verifyDirectBookingAmount(decoded, transaction.amount_in_cents);
      if (!verdict.ok) {
        priceVerifyOk = false;
        priceReason = verdict.reason;
        expectedCentsForAlert = verdict.expectedCentsAll ? verdict.expectedCentsAll[0] : verdict.expectedCents;
      }
      if (verdict.isMock) {
        console.warn(`[wompi-webhook] OTASync mock fallback active — skipping price verification. bookingCode=${decoded.bookingCode}, tx=${transaction.id}`);
      }
    } catch (priceErr) {
      /* Don't fail the booking creation on a recompute error — log and let
         the downstream flow proceed. Wompi has already approved the payment. */
      console.error('[wompi-webhook] price verification threw, proceeding with booking:', priceErr.message);
    }
  }

  if (!priceVerifyOk) {
    console.error(`[wompi-webhook] price_mismatch — refusing to create direct booking. bookingCode=${decoded.bookingCode}, tx=${transaction.id}, roomType=${decoded.roomTypeId}, paid_cents=${transaction.amount_in_cents}, expected_cents=${expectedCentsForAlert}, reason=${priceReason}`);
    try {
      await sendEmail({
        to: adminEmail(),
        subject: `⚠ Pago Wompi con monto incorrecto — ${decoded.bookingCode}`,
        html: `<p>Un pago Wompi fue aprobado por un monto distinto al precio esperado. La reserva NO se creó en OTASync.</p>
               <ul>
                 <li><strong>Código:</strong> ${decoded.bookingCode}</li>
                 <li><strong>Transacción Wompi:</strong> ${transaction.id}</li>
                 <li><strong>Habitación:</strong> ${decoded.roomTypeId}</li>
                 <li><strong>Fechas:</strong> ${decoded.checkin} → ${decoded.checkout}</li>
                 <li><strong>Monto pagado (centavos):</strong> ${transaction.amount_in_cents}</li>
                 <li><strong>Monto esperado (centavos):</strong> ${expectedCentsForAlert}</li>
                 <li><strong>Motivo:</strong> ${priceReason}</li>
               </ul>
               <p>Revisar manualmente: o bien devolver el pago, o crear la reserva en OTASync si el motivo fue una desviación legítima.</p>`
      });
    } catch (mailErr) {
      console.error('[wompi-webhook] price_mismatch admin alert failed:', mailErr.message);
    }
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'price_mismatch', message: 'Paid amount does not match expected price; admin alerted.' })
    };
  }

  /* Stay-level idempotency (A-4). The bookingCode is unique per payment attempt,
     so if a guest pays twice for the SAME stay (two devices / retries) the
     per-transaction and per-bookingCode dedups don't catch it and we would
     create two OTASync reservations. Key on the stay itself and refuse the
     second insert, alerting the admin to refund the duplicate charge. */
  const stayIdemKey = `booking_${decoded.roomTypeId}_${decoded.checkin}_${decoded.checkout}_${String(decoded.email || '').toLowerCase().trim()}`;
  /* Netlify Blobs has no TTL: expiry is age-based. 7 days covers genuine
     double-payment races without permanently blocking a guest who cancels
     (with refund) and later legitimately re-books the same stay. */
  const STAY_IDEM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  let stayIdemStore = null;
  try {
    stayIdemStore = getStore({ name: 'booking-idempotency', consistency: 'strong' });
    const existing = await stayIdemStore.get(stayIdemKey);
    if (existing) {
      const prev = JSON.parse(existing);
      const expired = !prev.createdAt || (Date.now() - prev.createdAt) > STAY_IDEM_MAX_AGE_MS;
      if (!expired && prev.transactionId && prev.transactionId !== transaction.id) {
        console.error(`[wompi-webhook] DUPLICATE STAY paid: stay=${stayIdemKey} already booked by tx ${prev.transactionId}; second tx ${transaction.id}. Not creating a second reservation.`);
        try {
          await sendEmail({
            to: adminEmail(),
            subject: `⚠ Doble pago de reserva directa — ${decoded.bookingCode}`,
            html: `<p>Se recibió un segundo pago aprobado para la MISMA estadía. No se creó una segunda reserva.</p>
                   <ul><li>Estadía: ${escapeHtml(decoded.checkin)} → ${escapeHtml(decoded.checkout)}, hab. ${escapeHtml(String(decoded.roomTypeId))}</li>
                   <li>Reserva existente (tx): ${escapeHtml(prev.transactionId)} → ${escapeHtml(String(prev.bookingCode || ''))}</li>
                   <li>Segundo pago (tx): ${escapeHtml(transaction.id)}</li></ul>
                   <p>Verifica con Wompi y reembolsa el cargo duplicado.</p>`
          });
        } catch (e) { console.error('[wompi-webhook] duplicate-stay alert failed:', e.message); }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, bookingCode: prev.bookingCode, duplicate: true }) };
      }
    }
  } catch (e) {
    if (process.env.DEBUG) console.warn('[wompi-webhook] stay idempotency check skipped:', e.message);
    stayIdemStore = null;
  }

  try {
    const pkey = await getSessionKey(token, username, password);
    const selectedRoomId = await findAvailableRoomId({
      token,
      pkey,
      propertyId,
      checkin: decoded.checkin,
      checkout: decoded.checkout,
      roomTypeId: decoded.roomTypeId
    });

    if (selectedRoomId === 0) {
      console.error(`[wompi-webhook] Direct booking PAID but SOLD OUT. No rooms available for roomTypeId=${decoded.roomTypeId}, bookingCode=${decoded.bookingCode}, tx=${transaction.id}. Marking reservationPending.`);
      try {
        await sendEmail({
          to: adminEmail(),
          subject: `⚠ Pago sin reserva directa (Habitación Agotada) — ${decoded.bookingCode}`,
          html: `<p>Se recibió un pago aprobado por Wompi para una reserva directa, pero la habitación seleccionada ya no tiene disponibilidad en OTASync. La reserva NO se creó.</p>
                 <ul>
                   <li><strong>Código:</strong> ${decoded.bookingCode}</li>
                   <li><strong>Huésped:</strong> ${decoded.firstName} ${decoded.lastName} — ${decoded.email}</li>
                   <li><strong>Check-in / Check-out:</strong> ${decoded.checkin} → ${decoded.checkout}</li>
                   <li><strong>Habitación (Room Type ID):</strong> ${decoded.roomTypeId}</li>
                   <li><strong>ID Transacción Wompi:</strong> ${transaction.id}</li>
                 </ul>
                 <p>La transacción está marcada como procesada. Crear manualmente en OTASync o gestionar reembolso.</p>`
        });
      } catch (mailErr) {
        console.error('[wompi-webhook] sold out admin alert failed:', mailErr.message);
      }

      if (directBookingResultStore) {
        try {
          await directBookingResultStore.set(`direct-${decoded.bookingCode}`, JSON.stringify({
            bookingCode: decoded.bookingCode,
            reservationPending: true,
            reason: 'sold_out',
            provider: 'wompi',
            paymentMethod: transaction.payment_method_type,
            transactionId: transaction.id,
            createdAt: new Date().toISOString()
          }), { ttl: 86400 * 7 });
        } catch (e) { /* non-fatal */ }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          bookingCode: decoded.bookingCode,
          reservationPending: true
        })
      };
    }

    // Calculate dates & nights
    const checkinDate = new Date(decoded.checkin);
    const checkoutDate = new Date(decoded.checkout);
    const diffTime = checkoutDate - checkinDate;
    const nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

    // Load rooms_db.json to lookup Room Name by roomTypeId
    let roomDetails = {};
    try {
      const dbPath = path.join(__dirname, '../../rooms_db.json');
      if (fs.existsSync(dbPath)) {
        roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      }
    } catch (dbErr) {
      console.error('Failed to load rooms_db.json database:', dbErr.message);
    }

    const matchedRoom = roomDetails[decoded.roomTypeId];
    const roomName = matchedRoom ? matchedRoom.name : 'Clásica';

    // pricing math: paidAmount = Wompi paid amount (subtotal without IVA)
    const paidAmount = transaction.amount_in_cents / 100;

    /* Plan tarifario AUTORITATIVO: se deriva del MONTO realmente pagado (best vs
       flexible recomputados desde OTASync), NO del campo de la referencia que
       controla el cliente — así nadie paga el precio Estricta y queda registrado
       como Flexible/reembolsable. Best-effort: si no se puede recomputar
       (mock/error) cae al de la referencia. */
    let ratePlan = (discountVerdict && discountVerdict.matchedPlan) || null;
    if (!ratePlan) {
      try {
        const planOpts = (appliedDiscount && appliedDiscount.code)
          ? { discountCode: appliedDiscount.code, email: appliedDiscount.email || decoded.email || '' }
          : {};
        const planVerdict = await verifyDirectBookingAmount(decoded, transaction.amount_in_cents, planOpts);
        if (planVerdict && planVerdict.matchedPlan) ratePlan = planVerdict.matchedPlan;
      } catch (e) { /* best-effort: cae al de la referencia abajo */ }
    }
    if (!ratePlan) ratePlan = decoded.ratePlan || null;

    // Determine IVA: use flags encoded in reference first (set by front-end),
    // then fall back to phone heuristic to match front-end logic exactly.
    const { ivaAmount, ivaNote, roomPrice } = directBookingPricing(decoded, paidAmount);
    const avgPrice = Math.round(roomPrice / nights);

    // Build the night-by-night breakdown array
    const nightsArray = [];
    const nightsDates = [];
    for (let i = 0; i < nights; i++) {
      const d = new Date(checkinDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      
      nightsDates.push(dateStr);
      nightsArray.push({
        night_date: dateStr,
        price: avgPrice,
        original_price: avgPrice,
        breakfast: 0,
        lunch: 0,
        dinner: 0
      });
    }

    const paymentInfo = [{
      amount: paidAmount,
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'card',
      note: `Wompi ID: ${transaction.id}, Ref: ${decoded.bookingCode}, Status: APPROVED`
    }];

    // Map extras from extrasMask (orden = _pricing.js EXTRAS_KEYS)
    // desayuno, parqueadero, late, early, traslado, tour, mascota
    const extrasList = [];
    const extraNames = ['Desayuno', 'Parqueadero', 'Late check-out (hasta 2pm)', 'Early check-in (desde 6am)', 'Traslado Aeropuerto', 'Tour Manizales', 'Mascota'];
    for (let i = 0; i < extraNames.length; i++) {
      if (decoded.extrasMask[i] === '1') {
        extrasList.push(extraNames[i]);
      }
    }
    const extrasText = extrasList.length > 0 ? extrasList.join(', ') : 'Ninguno';

    /* A8: pull the guest's free-text note persisted at signing time and attach
       it to the reservation. Best-effort; absent blob or flag OFF => as today. */
    let guestNote = '';
    if (await notesToPmsEnabled() && decoded.bookingCode) {
      try {
        const notesStore = getStore({ name: 'booking-notes', consistency: 'strong' });
        const raw = await notesStore.get(`note-${decoded.bookingCode}`);
        if (raw) { guestNote = sanitizeNotes((JSON.parse(raw) || {}).notes || ''); }
      } catch (e) {
        if (process.env.DEBUG) console.warn('[wompi-webhook] booking-notes read failed (non-fatal):', e.message);
      }
    }

    // Build Kunas / OTASync reservation payload
    const reservationPayload = {
      key: pkey,
      id_properties: propertyId,
      token: token,
      status: "confirmed",
      rooms: [
        {
          id_room_types: parseInt(decoded.roomTypeId),
          id_rooms: selectedRoomId,
          room_type: roomName,
          room_number: "",
          avg_price: avgPrice,
          total_price: roomPrice,
          children_1: 0,
          children_2: 0,
          children_3: 0,
          adults: decoded.guestsCount || 1,
          seniors: 0,
          extras: [],
          payments: [],
          overbooking: 0,
          nights: nightsArray
        }
      ],
      guests: [
        {
          first_name: decoded.firstName,
          last_name: decoded.lastName,
          email: decoded.email,
          id_guests: 0,
          guest_type: "adults"
        }
      ],
      extras: [],
      payments: paymentInfo,
      children_1: 0,
      children_2: 0,
      children_3: 0,
      adults: decoded.guestsCount || 1,
      seniors: 0,
      total_guests: decoded.guestsCount || 1,
      discount_type: "percent",
      discount_amount: 0,
      discount_note: "",
      rooms_price: roomPrice,
      rooms_discounted: roomPrice,
      extras_price: 0,
      board_price: 0,
      city_tax_price: 0,
      insurance_price: 0,
      total_price: roomPrice,
      id_boards: "",
      id_reservations: 0,
      nights: nights,
      nights_dates: nightsDates,
      reservation_type: "web",
      active_id_room_types: String(decoded.roomTypeId),
      preselected_id_rooms: 0,
      reference: decoded.bookingCode || "Hotel Estar Custom Booking Engine",
      id_contigents: 0,
      date_arrival: decoded.checkin,
      date_departure: decoded.checkout,
      guest_email: decoded.email,
      id_channels: channelId,
      channel: channelName,
      note: `${guestNote ? 'Nota del huésped: ' + guestNote + '. ' : ''}Plan: ${ratePlan === 'flexible' ? 'Flexible (reembolso 100% hasta 24 h antes)' : ratePlan === 'best' ? 'Estricta (reembolso 100% hasta 7 días antes)' : 'N/D'}. Teléfono del huésped: ${sanitizePhone(decoded.phone)}. Extras: ${escapeHtml(extrasText)}. IVA (19%): ${ivaNote}. Creado por Webhook Wompi. ID Transacción: ${transaction.id}`
    };

    /* A-4/C5: insertar con reintentos + backoff + alerta crítica (misma resiliencia
       que la ruta directa de Mercado Pago vía _payments). Si falla tras los
       reintentos, dejar un marcador reservationPending para que reconcile-payments
       lo detecte EXPLÍCITAMENTE (no solo por ausencia del registro), y re-lanzar
       para que el catch del handler avise por correo y responda 200 (Wompi no
       reintenta el webhook). */
    let data;
    try {
      data = await insertReservation(reservationPayload);
    } catch (err) {
      if (directBookingResultStore) {
        try {
          await directBookingResultStore.set(`direct-${decoded.bookingCode}`, JSON.stringify({
            reservationPending: true,
            provider: 'wompi',
            bookingCode: decoded.bookingCode,
            transactionId: transaction.id,
            amountInCents: transaction.amount_in_cents,
            createdAt: new Date().toISOString()
          }));
        } catch (_) { /* best-effort */ }
      }
      throw err;
    }
    const finalBookingCode = data.id_reservations || decoded.bookingCode;
    console.log(`[wompi-webhook] OTASync insert response: ${JSON.stringify(data)}, finalBookingCode=${finalBookingCode}`);

    // Store result so the booking-status poller (and any retry) sees the code.
    if (directBookingResultStore) {
      try {
        await directBookingResultStore.set(`direct-${decoded.bookingCode}`, JSON.stringify({
          bookingCode: finalBookingCode,
          provider: 'wompi',
          paymentMethod: transaction.payment_method_type,
          transactionId: transaction.id,
          amountInCents: transaction.amount_in_cents,
          ratePlan: ratePlan || null,
          createdAt: new Date().toISOString()
        }), { ttl: 86400 * 7 });
      } catch (e) { /* non-fatal */ }
    }

    // Persist the stay-level idempotency record (A-4) so a second payment for
    // the same stay is detected and refused above.
    if (stayIdemStore) {
      try {
        await stayIdemStore.set(stayIdemKey, JSON.stringify({ bookingCode: finalBookingCode, transactionId: transaction.id, createdAt: Date.now() }));
      } catch (e) { /* non-fatal */ }
    }

    /* Reliable confirmation email (closed-tab / lost-redirect safety net).
       The client-side send in motor-app is best-effort; this is the dependable
       trigger. Idempotent with it (dedup on the booking code) and non-fatal. */
    await sendDirectBookingConfirmation({
      decoded,
      displayBookingCode: finalBookingCode,
      roomName,
      nights,
      paidAmount,
      totalAmount: roomPrice
    });

    /* Snapshot refund-relevant payment fields at payment time (durable), so a
       later refund/ticket has auth code, date, last-4 and value without digging
       in the Wompi panel. Best-effort — never blocks. */
    await savePaymentDetails(finalBookingCode, transaction, { ratePlan: ratePlan || null });
    if (decoded.bookingCode && decoded.bookingCode !== finalBookingCode) {
      await savePaymentDetails(decoded.bookingCode, transaction, { ratePlan: ratePlan || null });
    }

    /* Frente A: increment discount usage ONLY after the reservation exists, and
       idempotently keyed on the stable client bookingCode (so a webhook retry
       does not double-count). consumeDiscountUse also records the email for the
       one-use-per-email rule. Best-effort — the reservation is already created so
       a usage-count failure must never surface as a webhook error. */
    if (appliedDiscount && appliedDiscount.code && (discountVerdict ? discountVerdict.ok : true)) {
      try {
        const { consumeDiscountUse } = require('./_discount-store');
        const def = discountVerdict && discountVerdict.discount && discountVerdict.discount.applied
          ? discountVerdict.discount : null;
        await consumeDiscountUse(appliedDiscount.code, {
          email: appliedDiscount.email || decoded.email || '',
          bookingCode: decoded.bookingCode,
          maxUses: def && Number.isFinite(def.maxUses) ? def.maxUses : undefined
        });
      } catch (discErr) {
        console.error(`[wompi-webhook] discount usage increment failed (non-fatal): ${discErr.message}. bookingCode=${decoded.bookingCode}, code=${appliedDiscount.code}`);
      }
    }

    /* Frente C: opt-in de marketing del huésped (persistido por
       create-wompi-signature, keyed por bookingCode). Ley 1581: solo entra a
       marketing con opt-in explícito. Sin blob = NO opt-in. Best-effort. */
    let marketingOptIn = null;
    if (decoded.bookingCode) {
      try {
        const mktStore = getStore({ name: 'booking-marketing', consistency: 'strong' });
        const raw = await mktStore.get(`mkt-${decoded.bookingCode}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.accepted === true) marketingOptIn = parsed;
        }
      } catch (e) {
        if (process.env.DEBUG) console.warn('[wompi-webhook] booking-marketing read failed (non-fatal):', e.message);
      }
    }

    /* Maestro de clientes (Fase 1): el huésped directo queda como partner
       (persona) en Odoo, deduplicado por email. Con opt-in de marketing (Frente
       C) se añade el tag 'Opt-in marketing' y se le agrega a la lista de Email
       Marketing 'Newsletter'. Sin opt-in → solo el partner, sin marketing.
       No fatal. */
    try {
      const { upsertPartner, addToMailingList } = require('./_odoo');
      const guestName = `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim() || decoded.email;
      const mkt = buildGuestMarketing(decoded, marketingOptIn);
      await upsertPartner({
        name: guestName,
        email: decoded.email,
        phone: sanitizePhone(decoded.phone),
        isCompany: false,
        tags: mkt.tags,
        comment: `Huésped de reserva directa ${finalBookingCode}.${mkt.optIn ? ' Opt-in de marketing (motor de reserva directa).' : ''}`
      });
      /* Email Marketing: SOLO con opt-in (Ley 1581) y con email. Se intenta aun
         en modo mock (no-op) para que el flujo sea idéntico con y sin Odoo. */
      if (mkt.addToMailing) {
        await addToMailingList({ email: decoded.email, name: guestName, listName: 'Newsletter' });
      }
    } catch (odooErr) {
      console.error('[wompi-webhook] Odoo upsert (huésped) no fatal:', odooErr.message);
    }

    /* A-6: server-side conversion (Measurement Protocol). Same transaction_id
       as the client purchase so GA4 dedupes. value = online subtotal charged. */
    try {
      await trackPurchase({
        transactionId: String(finalBookingCode),
        value: transaction.amount_in_cents / 100,
        items: [{ item_id: String(decoded.roomTypeId), item_name: roomName, price: avgPrice, quantity: nights }]
      });
    } catch (e) { /* analytics never blocks */ }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        bookingCode: finalBookingCode
      })
    };
  } catch (err) {
    console.error(`[wompi-webhook] Error creating direct booking in Kunas: ${err.message}. bookingCode=${decoded.bookingCode}, tx=${transaction.id}`);
    // Alert admin so the reservation can be manually created — the transaction is already
    // deduped so Wompi retries will be no-ops; manual intervention is required.
    try {
      await sendEmail({
        to: adminEmail(),
        subject: `⚠ Pago sin reserva directa — ${decoded.bookingCode}`,
        html: `<p>Falló la creación de reserva en OTASync tras pago Wompi confirmado.</p>
               <ul>
                 <li><strong>Código:</strong> ${decoded.bookingCode}</li>
                 <li><strong>Huésped:</strong> ${decoded.firstName} ${decoded.lastName} — ${decoded.email}</li>
                 <li><strong>Check-in / Check-out:</strong> ${decoded.checkin} → ${decoded.checkout}</li>
                 <li><strong>ID Transacción Wompi:</strong> ${transaction.id}</li>
                 <li><strong>Error:</strong> ${err.message}</li>
               </ul>
               <p>La transacción está marcada como procesada. Crear manualmente en OTASync.</p>`
      });
    } catch (mailErr) {
      console.error('[wompi-webhook] admin alert for failed direct booking failed:', mailErr.message);
    }
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Failed to create booking in PMS; admin alerted for manual follow-up.' })
    };
  }
};

exports._test = {
  decodeReference,
  sanitizePhone,
  escapeHtml,
  computeWompiChecksum,
  verifyWompiSignature,
  mustChargeDirectBookingIva,
  buildGuestMarketing,
  directBookingPricing,
  handleQuotePayment,
  handleGuestServicePayment,
  acquireQuoteLock,
  notifyGuestPaymentOutcome,
  sendDirectBookingConfirmation
};

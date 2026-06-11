const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  getQuoteStore, loadQuote, saveQuote, effectiveStatus, computeQuoteTotal
} = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, releaseHold, buildExtrasFromQuote } = require('./_otasync');
const { sendEmail, adminEmail, paymentConfirmationHtml, adminPendingHtml } = require('./_email');

const QUOTE_ID_RE = /^COT-\d{4}-[A-Z0-9]{5}$/;

// Helper to load local .env variables if not already set (e.g. local development)
function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') {
    return;
  }
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.substring(1, value.length - 1);
          }
          if (!process.env[key]) {
            process.env[key] = value.trim();
          }
        }
      });
    }
  } catch (e) {
    console.error('Failed to load local .env file:', e.message);
  }
}

loadEnv();

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
    return {
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
  const ivaAmount = Math.round(paidAmount * 0.19);
  return {
    mustPayIva,
    ivaAmount,
    ivaNote: mustPayIva
      ? `POR COBRAR EN ALOJAMIENTO (${ivaAmount})`
      : `EXENTO PRELIMINAR - validar documento y motivo; si no corresponde, cobrar IVA (${ivaAmount})`,
    roomPrice: mustPayIva ? Math.round(paidAmount * 1.19) : paidAmount
  };
}

// Helper to obfuscate base64 references for logs
function obfuscateReference(ref) {
  if (!ref || typeof ref !== 'string') return '';
  return ref.length > 8 ? `${ref.substring(0, 4)}...${ref.substring(ref.length - 4)}` : '***';
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

// Handle a Wompi payment whose reference is a stored quote id (COT-...).
// Loads the quote, verifies the amount, creates the OTASync reservation and
// marks the quote as 'aceptada'. Returns a Netlify response object.
/* Acquire a per-quote lock so two concurrent Wompi webhooks for the same
   reference don't both end up creating reservations in OTASync. Uses Netlify
   Blobs' onlyIfNew semantics for a compare-and-set primitive. Returns:
     { acquired: true }                     — first writer, proceed
     { acquired: true, alreadyOurs: true }  — same transaction retrying, proceed
     { acquired: false, ownerTx, startedAt } — another transaction holds the lock */
async function acquireQuoteLock(quoteId, transactionId) {
  let lockStore;
  try { lockStore = getStore({ name: 'quote-locks', consistency: 'strong' }); }
  catch (e) {
    console.error('[wompi-webhook] quote-locks store unavailable:', e.message);
    /* Without Blobs we cannot prevent the race; let the caller proceed. The
       transaction-level dedup in processed-transactions still protects
       against duplicate webhook deliveries of the same txId. */
    return { acquired: true, blobsUnavailable: true };
  }

  try {
    await lockStore.setJSON(quoteId, { transactionId, startedAt: Date.now() }, { onlyIfNew: true });
    return { acquired: true };
  } catch (e) {
    /* Lock already exists. If it's our own retry, proceed idempotently;
       otherwise refuse so the second writer doesn't double-book. */
    let existing;
    try { existing = await lockStore.get(quoteId, { type: 'json' }); }
    catch (readErr) { existing = null; }
    if (existing && existing.transactionId === transactionId) {
      return { acquired: true, alreadyOurs: true };
    }
    return {
      acquired: false,
      ownerTx: existing && existing.transactionId,
      startedAt: existing && existing.startedAt
    };
  }
}

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

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };
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
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Transaction ${transaction.status}. Logged for manual follow-up.` })
    };
  }

  if (transaction.status !== 'APPROVED') {
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

    // Map extras from extrasMask
    // BE_EXTRAS: desayuno, parqueadero, late, early, traslado, tour
    const extrasList = [];
    const extraNames = ['Desayuno', 'Parqueadero', 'Late Check-out', 'Early Check-in', 'Traslado Aeropuerto', 'Tour Manizales'];
    for (let i = 0; i < 6; i++) {
      if (decoded.extrasMask[i] === '1') {
        extrasList.push(extraNames[i]);
      }
    }
    const extrasText = extrasList.length > 0 ? extrasList.join(', ') : 'Ninguno';

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
      note: `Teléfono del huésped: ${sanitizePhone(decoded.phone)}. Extras: ${escapeHtml(extrasText)}. IVA (19%): ${ivaNote}. Creado por Webhook Wompi. ID Transacción: ${transaction.id}`
    };

    const insertController = new AbortController();
    const insertTimeoutId = setTimeout(() => insertController.abort(), 10000);
    let response;
    try {
      response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reservationPayload),
        signal: insertController.signal
      });
      clearTimeout(insertTimeoutId);
    } catch (err) {
      clearTimeout(insertTimeoutId);
      if (err.name === 'AbortError') {
        return { statusCode: 504, body: JSON.stringify({ error: 'Request timeout' }) };
      }
      throw err;
    }

    if (!response.ok) {
      const detail = await readResponseSnippet(response);
      console.error(`[wompi-webhook] Kunas insert failed. status=${response.status}, roomTypeId=${decoded.roomTypeId}, id_rooms=${selectedRoomId || 0}, bookingCode=${decoded.bookingCode}, tx=${transaction.id}, amount=${transaction.amount_in_cents}${detail ? ', body=' + detail : ''}`);
      throw new Error(`Kunas API booking submission returned status ${response.status}`);
    }

    const data = await response.json();
    const finalBookingCode = data.id_reservations || decoded.bookingCode;
    console.log(`[wompi-webhook] OTASync insert response: ${JSON.stringify(data)}, finalBookingCode=${finalBookingCode}`);

    // Store result so create-booking knows not to duplicate this reservation
    if (directBookingResultStore) {
      try {
        await directBookingResultStore.set(`direct-${decoded.bookingCode}`, JSON.stringify({ bookingCode: finalBookingCode }), { ttl: 86400 * 7 });
      } catch (e) { /* non-fatal */ }
    }

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
  directBookingPricing,
  handleQuotePayment,
  acquireQuoteLock
};

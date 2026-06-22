const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  normalizeTransaction,
  processApprovedPayment,
  timingSafeEqualString,
  decodeDirectReference,
  alreadyProcessed,
  markProcessed,
  QUOTE_ID_RE
} = require('./_payments');
const { getQuoteStore, loadQuote } = require('./_quotes-store');
const {
  loadIntent: loadGuestPaymentIntent,
  markIntentStatus: markGuestPaymentStatus,
  GUEST_ORDER_REF_RE
} = require('./_guest-payments');
const { postOrderExtrasToFolio } = require('./_otasync');
const { sendEmail, paymentPendingHtml, paymentRejectedHtml } = require('./_email');

function headers() {
  return { 'Content-Type': 'application/json' };
}

function response(statusCode, body) {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
}

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Guest notifications for non-approved payments ──────────────────────
   Mirrors wompi-webhook.js (Mercado Pago is the rollback provider). Deduped
   in a store SEPARATE from 'processed-transactions': marking a pending
   payment there would make its later approved webhook look like a duplicate
   and skip the reservation. */
let paymentEmailStore;
try {
  paymentEmailStore = getStore({ name: 'payment-failure-emails', consistency: 'strong' });
} catch (e) {
  if (process.env.DEBUG) console.warn('[payment-emails] Blobs unavailable, using in-memory dedup only:', e.message);
  paymentEmailStore = null;
}
const sentPaymentEmails = new Set();

/* True the first time a (payment, kind) pair is seen. Marked BEFORE the send
   so concurrent webhook retries can't double-email. If Blobs is unavailable
   we still send — Mercado Pago retries webhooks, so a duplicate email is
   possible, but that's preferable to the guest never learning the outcome. */
async function shouldSendPaymentEmail(paymentId, kind) {
  const key = `mp-${paymentId}-${kind}`;
  if (sentPaymentEmails.has(key)) return false;
  /* Cap para no crecer sin límite en instancias calientes (igual que Wompi). */
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

/* Email the guest when a payment is rejected ('declined') or still being
   processed by the bank ('pending'). MPDIR- references encode the guest;
   COT- quotes store the contact in Blobs. Never throws — guest notifications
   must not affect webhook processing. */
async function notifyGuestPaymentOutcome(transaction, kind, overrides = {}) {
  const deps = { sendEmail, getQuoteStore, loadQuote, ...overrides };
  try {
    if (!(await shouldSendPaymentEmail(transaction.id, kind))) return;

    let contact = null;
    if (QUOTE_ID_RE.test(transaction.reference || '')) {
      // Corporate quote: the contact lives in the stored quote.
      const store = deps.getQuoteStore();
      const quote = await deps.loadQuote(store, transaction.reference);
      if (quote && quote.email) {
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
      // Direct booking: the guest is encoded in the MPDIR- reference itself.
      const decoded = decodeDirectReference(transaction.reference);
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
    console.error(`[mercadopago-webhook] guest ${kind} payment email failed:`, e.message);
  }
}

/* Handle a Mercado Pago payment whose reference is a guest-app service order
   (GST-...). Mirror of wompi-webhook.handleGuestServicePayment: loads the
   payment intent, verifies the paid amount matches what we stored, posts the
   charge + payment onto the reservation folio in OTASync/Kunas, and marks the
   intent paid (idempotent on the intent status). add_extra/add_payment are NOT
   idempotent in OTASync and the caller pre-marks the transaction as processed,
   so we never auto-retry: a folio failure flags the intent for manual
   follow-up rather than risk duplicate folio lines. Deps injectable for tests. */
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
    console.error('[mercadopago-webhook] guest-payment store unavailable:', e.message);
    return reply({ message: 'Guest payment store unavailable; logged for manual follow-up' });
  }
  if (!intent) {
    console.error(`[mercadopago-webhook] guest order ${reference} not found for paid payment ${transaction.id}`);
    return reply({ message: 'Guest order intent not found' });
  }
  if (intent.status === 'paid') {
    return reply({ received: true, duplicate: true });
  }

  // Defense in depth: only post the amount we stored for this order.
  const paidCents = Number(transaction.amountCents);
  const expectedCents = Number(intent.amountInCents);
  if (Number.isFinite(paidCents) && Number.isFinite(expectedCents) && paidCents !== expectedCents) {
    console.error(`[mercadopago-webhook] guest order ${reference} amount mismatch: paid=${paidCents}, expected=${expectedCents}, payment=${transaction.id}. Not posting; manual follow-up.`);
    await deps.markIntentStatus(reference, 'amount_mismatch', { transactionId: transaction.id, paidCents });
    return reply({ message: 'Amount mismatch; logged for manual follow-up' });
  }

  try {
    const result = await deps.postOrderToFolio({
      idReservations: intent.bookingCode,
      items: intent.items,
      payment: { amount: expectedCents / 100, method: 'card', note: `Pago en línea Mercado Pago ${transaction.id}` }
    });
    await deps.markIntentStatus(reference, 'paid', {
      transactionId: transaction.id, paidAt: new Date().toISOString(), folio: result
    });
    return reply({ received: true, folio: result });
  } catch (e) {
    console.error(`[mercadopago-webhook] guest order ${reference} folio posting failed for paid payment ${transaction.id}: ${e.message}. MANUAL follow-up required.`);
    await deps.markIntentStatus(reference, 'paid_folio_failed', { transactionId: transaction.id, error: e.message });
    return reply({ message: 'Paid but folio posting failed; logged for manual follow-up' });
  }
}

function getPaymentId(event, body) {
  const qs = event.queryStringParameters || {};
  return String(
    qs['data.id'] ||
    qs.id ||
    (body && body.data && body.data.id) ||
    (body && body.id) ||
    ''
  );
}

/* Signature verification.
 *
 * Mercado Pago Checkout Pro does NOT always let the merchant generate a webhook
 * secret in the panel. When MERCADOPAGO_WEBHOOK_SECRET is absent we therefore
 * SKIP signature validation and lean on the only thing an attacker cannot forge:
 * the payment is re-fetched from the Mercado Pago API with OUR access token
 * (fetchPayment below) and we only act on status==='approved' WITH a matching
 * amount. A forged webhook carrying a fake/foreign payment id either 404s at the
 * API or returns a payment that is not 'approved' / does not match the expected
 * amount, so it can never create a reservation.
 *
 * When the secret IS configured we still validate the HMAC signature first, as
 * defense in depth (the API re-fetch then runs as a second gate). */
function verifyMercadoPagoSignature(event, paymentId, env = process.env) {
  const secret = env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    /* No secret configured → cannot HMAC-verify. Defer entirely to the
       API re-fetch (source of truth). Not an error. */
    return { ok: true, verified: false, reason: 'no_secret_api_verify' };
  }

  const headers = event.headers || {};
  const signatureHeader = headers['x-signature'] || headers['X-Signature'];
  const requestId = headers['x-request-id'] || headers['X-Request-Id'];
  if (!signatureHeader || !requestId || !paymentId) {
    return { ok: false, statusCode: 401, message: 'Missing signature components' };
  }

  const parts = {};
  signatureHeader.split(',').forEach(part => {
    const [key, value] = part.split('=').map(s => s && s.trim());
    if (key && value) parts[key] = value;
  });

  if (!parts.ts || !parts.v1) {
    return { ok: false, statusCode: 401, message: 'Invalid signature format' };
  }

  const manifest = `id:${paymentId};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  if (!timingSafeEqualString(parts.v1, expected)) {
    console.error('[mercadopago-webhook] invalid signature');
    return { ok: false, statusCode: 401, message: 'Invalid signature' };
  }

  return { ok: true, verified: true };
}

/* Re-fetch the payment from the Mercado Pago API. THIS is the source of truth:
   we authenticate with our own access token, so the JSON it returns (status,
   amount, currency, reference) cannot be forged by whoever posted the webhook.
   `fetchImpl` and `env` are injectable for tests (no network, no real token). */
async function fetchPayment(paymentId, { fetchImpl = fetch, env = process.env } = {}) {
  const accessToken = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured');

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetchImpl(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout fetching Mercado Pago payment') : err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago payment lookup failed with status ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

async function handleWebhook(event, overrides = {}) {
  const deps = {
    env: process.env,
    fetchImpl: fetch,
    processApprovedPayment,
    handleGuestServicePayment,
    notifyGuestPaymentOutcome,
    alreadyProcessed,
    markProcessed,
    ...overrides
  };
  const env = deps.env;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method Not Allowed. Use POST.' });
  if (event.body && event.body.length > 20000) return response(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return response(400, { error: 'Invalid JSON request body' }); }

  const paymentId = getPaymentId(event, body);
  const sig = verifyMercadoPagoSignature(event, paymentId, env);
  if (!sig.ok) return response(sig.statusCode, { error: sig.message });
  if (!paymentId) return response(400, { error: 'Missing payment id' });

  /* Source of truth: re-fetch the payment from the MP API with our access token.
     When no webhook secret is set this is the ONLY trust anchor (a forged
     webhook cannot make this return an approved, amount-matching payment). */
  let payment;
  try {
    payment = await fetchPayment(paymentId, { fetchImpl: deps.fetchImpl, env });
  } catch (e) {
    console.error('[mercadopago-webhook]', e.message);
    return response(502, { error: 'Failed to verify payment with Mercado Pago' });
  }

  const transaction = normalizeTransaction('mercadopago', payment);
  if (env.DEBUG) {
    console.log(`[mercadopago-webhook] payment=${transaction.id} reference=${transaction.reference} status=${transaction.status} verified=${sig.verified}`);
  }

  if (transaction.status === 'rejected' || transaction.status === 'failed') {
    console.error(`[mercadopago-webhook] payment ${transaction.id} ${transaction.rawStatus}; reference=${transaction.reference}`);
    /* Guest email only for genuine declines: normalizeStatus also maps
       refunds/chargebacks to 'failed', where "no se realizó ningún cobro"
       would be wrong. */
    const raw = String(transaction.rawStatus || '').toLowerCase();
    if (raw === 'rejected' || raw === 'cancelled') {
      await deps.notifyGuestPaymentOutcome(transaction, 'declined');
    }
    return response(200, { message: `Payment ${transaction.status}. Logged for manual follow-up.` });
  }

  if (transaction.status !== 'approved') {
    if (transaction.status === 'pending') {
      /* "No vuelvas a pagar" solo aplica a tarjetas en proceso. En métodos
         offline (PSE/Efecty/ticket), 'pending' significa que el huésped AÚN debe
         pagar, así que ese mensaje sería engañoso → se omite. */
      const pm = String(transaction.paymentMethod || '').toLowerCase();
      if (/credit|debit|visa|master|amex|account_money/.test(pm)) {
        await deps.notifyGuestPaymentOutcome(transaction, 'pending');
      }
    }
    return response(200, { message: `Payment status is ${transaction.status}. Skipping reservation.` });
  }

  if (transaction.currency !== 'COP') {
    console.error(`[mercadopago-webhook] invalid currency ${transaction.currency} for payment ${transaction.id}`);
    return response(200, { message: 'Invalid currency; logged for manual follow-up' });
  }

  /* Guest-app service order paid online: reference is the order eventId (GST-...).
     Gated by GUEST_SERVICE_PAYMENT_MODE (mercadopago/both) so it stays inert
     until guest-app online payment is enabled for MP. Deduped by the shared
     processed-transactions store (markProcessed) before posting to the folio,
     since add_extra/add_payment are not idempotent. */
  if (GUEST_ORDER_REF_RE.test(transaction.reference || '') &&
      ['mercadopago', 'both'].includes(String(env.GUEST_SERVICE_PAYMENT_MODE || '').toLowerCase())) {
    if (await deps.alreadyProcessed(transaction.id)) {
      return response(200, { received: true, duplicate: true });
    }
    await deps.markProcessed(transaction.id);
    try {
      return await deps.handleGuestServicePayment(transaction, headers());
    } catch (e) {
      console.error('[mercadopago-webhook] guest service payment failed:', e.message);
      return response(500, { error: 'Failed to process guest service payment' });
    }
  }

  /* Reservation creation (direct bookings + corporate quotes). The amount is
     re-verified server-side inside processApprovedPayment (against the stored
     quote total or the encoded direct-reference amount) — the client price is
     never trusted. */
  try {
    return await deps.processApprovedPayment(transaction, headers());
  } catch (e) {
    console.error('[mercadopago-webhook] reservation processing failed:', e.message);
    return response(500, { error: 'Failed to process approved payment' });
  }
}

exports.handler = (event) => handleWebhook(event);

exports._test = {
  handleWebhook,
  verifyMercadoPagoSignature,
  fetchPayment,
  notifyGuestPaymentOutcome,
  handleGuestServicePayment
};

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  normalizeTransaction,
  processApprovedPayment,
  timingSafeEqualString,
  decodeDirectReference,
  QUOTE_ID_RE
} = require('./_payments');
const { getQuoteStore, loadQuote } = require('./_quotes-store');
const { sendEmail } = require('./_email');

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
  sentPaymentEmails.add(key);
  if (paymentEmailStore) {
    try {
      if (await paymentEmailStore.get(key)) return false;
      await paymentEmailStore.set(key, '1', { ttl: 86400 * 7 });
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
      html: kind === 'pending' ? paymentPendingEmailHtml(contact) : paymentDeclinedEmailHtml(contact)
    });
  } catch (e) {
    console.error(`[mercadopago-webhook] guest ${kind} payment email failed:`, e.message);
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

function verifyMercadoPagoSignature(event, paymentId) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error('CRITICAL: MERCADOPAGO_WEBHOOK_SECRET is not configured. Rejecting webhook.');
    return { ok: false, statusCode: 500, message: 'Webhook secret not configured on server' };
  }

  const signatureHeader = event.headers['x-signature'] || event.headers['X-Signature'];
  const requestId = event.headers['x-request-id'] || event.headers['X-Request-Id'];
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

  return { ok: true };
}

async function fetchPayment(paymentId) {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured');

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  let res;
  try {
    res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: headers(), body: '' };
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method Not Allowed. Use POST.' });
  if (event.body && event.body.length > 20000) return response(413, { error: 'Payload too large' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return response(400, { error: 'Invalid JSON request body' }); }

  const paymentId = getPaymentId(event, body);
  const sig = verifyMercadoPagoSignature(event, paymentId);
  if (!sig.ok) return response(sig.statusCode, { error: sig.message });

  let payment;
  try {
    payment = await fetchPayment(paymentId);
  } catch (e) {
    console.error('[mercadopago-webhook]', e.message);
    return response(502, { error: 'Failed to verify payment with Mercado Pago' });
  }

  const transaction = normalizeTransaction('mercadopago', payment);
  if (process.env.DEBUG) {
    console.log(`[mercadopago-webhook] payment=${transaction.id} reference=${transaction.reference} status=${transaction.status}`);
  }

  if (transaction.status === 'rejected' || transaction.status === 'failed') {
    console.error(`[mercadopago-webhook] payment ${transaction.id} ${transaction.rawStatus}; reference=${transaction.reference}`);
    /* Guest email only for genuine declines: normalizeStatus also maps
       refunds/chargebacks to 'failed', where "no se realizó ningún cobro"
       would be wrong. */
    const raw = String(transaction.rawStatus || '').toLowerCase();
    if (raw === 'rejected' || raw === 'cancelled') {
      await notifyGuestPaymentOutcome(transaction, 'declined');
    }
    return response(200, { message: `Payment ${transaction.status}. Logged for manual follow-up.` });
  }

  if (transaction.status !== 'approved') {
    if (transaction.status === 'pending') {
      // Bank still processing: warn the guest not to pay again (double charge).
      await notifyGuestPaymentOutcome(transaction, 'pending');
    }
    return response(200, { message: `Payment status is ${transaction.status}. Skipping reservation.` });
  }

  try {
    return await processApprovedPayment(transaction, headers());
  } catch (e) {
    console.error('[mercadopago-webhook] reservation processing failed:', e.message);
    return response(500, { error: 'Failed to process approved payment' });
  }
};

exports._test = {
  notifyGuestPaymentOutcome
};

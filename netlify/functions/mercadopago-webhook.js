const crypto = require('crypto');
const {
  normalizeTransaction,
  processApprovedPayment,
  timingSafeEqualString
} = require('./_payments');

function headers() {
  return { 'Content-Type': 'application/json' };
}

function response(statusCode, body) {
  return { statusCode, headers: headers(), body: JSON.stringify(body) };
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
    return response(200, { message: `Payment ${transaction.status}. Logged for manual follow-up.` });
  }

  if (transaction.status !== 'approved') {
    return response(200, { message: `Payment status is ${transaction.status}. Skipping reservation.` });
  }

  try {
    return await processApprovedPayment(transaction, headers());
  } catch (e) {
    console.error('[mercadopago-webhook] reservation processing failed:', e.message);
    return response(500, { error: 'Failed to process approved payment' });
  }
};

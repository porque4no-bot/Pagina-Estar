const crypto = require('crypto');

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
  return headers;
}

function json(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

function cleanReference(value) {
  return String(value || '').trim();
}

function cleanEnv(value) {
  return String(value || '').trim();
}

function wompiModeFromPublicKey(value) {
  const key = cleanEnv(value);
  if (key.startsWith('pub_prod_')) return 'prod';
  if (key.startsWith('pub_test_')) return 'test';
  return '';
}

function wompiModeFromIntegritySecret(value) {
  const secret = cleanEnv(value);
  if (secret.startsWith('prod_integrity_')) return 'prod';
  if (secret.startsWith('test_integrity_')) return 'test';
  return '';
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed. Use POST.' });
  if (event.body && event.body.length > 3000) return json(413, { error: 'Payload too large' });

  const secret = cleanEnv(process.env.WOMPI_INTEGRITY_SECRET);
  if (!secret) {
    console.error('CRITICAL: WOMPI_INTEGRITY_SECRET is not configured.');
    return json(503, { error: 'Wompi integrity secret is not configured' });
  }

  const publicKeyMode = wompiModeFromPublicKey(process.env.WOMPI_PUBLIC_KEY);
  const integrityMode = wompiModeFromIntegritySecret(secret);
  if (publicKeyMode && integrityMode && publicKeyMode !== integrityMode) {
    console.error(`CRITICAL: Wompi key mode mismatch. public=${publicKeyMode}, integrity=${integrityMode}`);
    return json(503, { error: 'Wompi public key and integrity secret belong to different environments' });
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Invalid JSON request body' }); }

  const reference = cleanReference(body.reference);
  const amountInCents = parseInt(body.amountInCents, 10);
  const currency = String(body.currency || 'COP').trim().toUpperCase();

  if (!reference || reference.length > 255 || !Number.isFinite(amountInCents) || amountInCents <= 0 || currency !== 'COP') {
    return json(400, { error: 'Invalid Wompi signature payload' });
  }

  const integrity = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest('hex');

  return json(200, { reference, amountInCents, currency, signature: { integrity } });
};

const crypto = require('crypto');
const { getQuoteStore, loadQuote, effectiveStatus, computeQuoteTotal } = require('./_quotes-store');

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
  const clientAmountInCents = parseInt(body.amountInCents, 10);
  const currency = String(body.currency || 'COP').trim().toUpperCase();

  if (!reference || reference.length > 255 || !Number.isFinite(clientAmountInCents) || clientAmountInCents <= 0 || currency !== 'COP') {
    return json(400, { error: 'Invalid Wompi signature payload' });
  }

  /* For corporate quote payments (reference matches COT-YYYY-XXXXX), the amount
     is NOT trusted from the cliente. We load the quote from the store, recompute
     the total via computeQuoteTotal and sign with THAT value. This prevents a
     cliente from initiating arbitrary-amount payments against any quote. */
  let amountInCents = clientAmountInCents;
  const isQuoteRef = /^COT-\d{4}-[A-Z0-9]{5}$/.test(reference);
  if (isQuoteRef) {
    let quote;
    try { quote = await loadQuote(getQuoteStore(), reference); }
    catch (e) {
      console.error('[create-wompi-signature] quote store unavailable:', e.message);
      return json(503, { error: 'Cotización no disponible. Intenta de nuevo.' });
    }
    if (!quote) return json(404, { error: 'Cotización no encontrada' });

    const status = effectiveStatus(quote);
    if (status === 'cancelada' || status === 'vencida' || status === 'aceptada') {
      return json(409, { error: `Cotización ${status}, no se puede pagar` });
    }

    const totals = computeQuoteTotal(quote);
    amountInCents = totals.totalCents;
  }

  const integrity = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest('hex');

  return json(200, { reference, amountInCents, currency, signature: { integrity } });
};

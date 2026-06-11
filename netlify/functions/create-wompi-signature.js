const crypto = require('crypto');
const { getQuoteStore, loadQuote, effectiveStatus, computeQuoteTotal } = require('./_quotes-store');
const { decodeDirectReference, verifyDirectBookingAmount } = require('./_direct-pricing');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

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
  const publicToken = String(body.publicToken || '').trim();

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

    if (quote.publicToken && !timingSafeEqual(publicToken, quote.publicToken)) {
      return json(403, { error: 'Token de acceso inválido' });
    }

    const status = effectiveStatus(quote);
    if (status === 'cancelada' || status === 'vencida' || status === 'aceptada') {
      return json(409, { error: `Cotización ${status}, no se puede pagar` });
    }

    const totals = computeQuoteTotal(quote);
    amountInCents = totals.totalCents;
  } else {
    /* Direct booking: the reference is a base64-encoded payload that pins
       the room type, dates, extras and IVA flags. Recompute the authoritative
       subtotal from OTASync availability so a tampered client amount cannot
       be signed. Quote payments are already protected above via the store. */
    const decoded = decodeDirectReference(reference);
    if (!decoded) {
      console.warn('[create-wompi-signature] reference is neither a quote id nor a decodable direct payload; refusing to sign');
      return json(400, { error: 'invalid_reference' });
    }

    let verdict;
    try {
      verdict = await verifyDirectBookingAmount(decoded, clientAmountInCents);
    } catch (e) {
      console.error('[create-wompi-signature] price recompute failed:', e.message);
      return json(503, { error: 'price_check_unavailable' });
    }

    if (!verdict.ok) {
      console.error(`[create-wompi-signature] price_mismatch refusing to sign: bookingCode=${decoded.bookingCode}, roomType=${decoded.roomTypeId}, client=${clientAmountInCents}, expected=${verdict.expectedCentsAll ? verdict.expectedCentsAll.join('|') : verdict.expectedCents}, reason=${verdict.reason}`);
      return json(400, { error: 'price_mismatch' });
    }
    if (verdict.isMock) {
      console.warn(`[create-wompi-signature] OTASync mock fallback active — accepting client amount without recompute. bookingCode=${decoded.bookingCode}, client=${clientAmountInCents}`);
    }
  }

  const integrity = crypto
    .createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest('hex');

  return json(200, { reference, amountInCents, currency, signature: { integrity } });
};

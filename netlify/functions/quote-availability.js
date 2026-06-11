const crypto = require('crypto');
const { getQuoteStore, loadQuote, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable } = require('./_otasync');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/* Public re-check of a stored quote's room availability, called right before
   the client opens the Wompi widget so we don't charge for unavailable rooms. */
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  const limited = await checkRateLimit(event, { name: 'quote-availability', limit: 40, windowMs: 15 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  const params = event.queryStringParameters || {};
  const id = params.id || '';
  const token = String(params.t || '').trim();
  if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(id)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id inválido' }) };
  }

  let quote;
  try {
    quote = await loadQuote(getQuoteStore(), id);
  } catch (e) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
  }
  if (!quote) return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };

  if (quote.publicToken && !timingSafeEqual(token, quote.publicToken)) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotizacion no encontrada' }) };
  }

  const status = effectiveStatus(quote);
  if (status === 'cancelada' || status === 'vencida' || status === 'aceptada') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ available: false, reason: status }) };
  }

  if (!quote.checkin || !quote.checkout) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ available: true }) };
  }

  // A tentative hold already guarantees the rooms for this quote
  if (Array.isArray(quote.holdReservationIds) && quote.holdReservationIds.length) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ available: true, held: true }) };
  }

  try {
    const { availByType, isMock } = await getAvailabilityByType(quote.checkin, quote.checkout);
    if (isMock) return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ available: true, mock: true }) };
    const shortfalls = findUnavailable(quote.items, availByType);
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ available: shortfalls.length === 0, unavailable: shortfalls })
    };
  } catch (e) {
    /* Fail CLOSED on PMS errors: without a hold and without a successful
       re-check, we cannot guarantee the rooms. Letting the client open
       Wompi would risk paying for unavailable rooms (and the webhook may
       also fail to re-check). The client should surface the degraded state
       so the guest can retry or contact us. */
    console.error('[quote-availability] PMS check failed:', e.message);
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ available: false, degraded: true, reason: 'availability_check_failed' })
    };
  }
};

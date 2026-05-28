const { getQuoteStore, loadQuote, effectiveStatus } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable } = require('./_otasync');

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

  const id = (event.queryStringParameters || {}).id || '';
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

  const status = effectiveStatus(quote);
  if (status === 'cancelada' || status === 'vencida') {
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
    console.error('[quote-availability] check failed:', e.message);
    // Fail open so a transient PMS hiccup doesn't block a legitimate payment;
    // the webhook re-checks before creating the reservation.
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ available: true, degraded: true }) };
  }
};

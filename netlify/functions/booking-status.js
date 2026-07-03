/* Polling endpoint for the booking flow.
 *
 * After the cliente completes payment in Wompi (or Mercado Pago), the
 * authoritative reservation creation happens server-side in the payment
 * webhook. The cliente polls this endpoint to learn when the webhook has
 * landed and the booking code is ready to display.
 *
 * The webhook writes a JSON entry to 'booking-results' keyed by
 * 'direct-{bookingCode}' once OTASync confirms the reservation. We respond
 * with status='pending' while that key is missing and status='confirmed'
 * once it appears.
 *
 * Public endpoint — rate limited by IP. The bookingCode is the user-visible
 * code already exposed in the success URL / confirmation screen, so no
 * additional secret is required to read its status.
 */

const { getStore } = require('@netlify/blobs');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');

const MAX_BOOKING_CODE_LEN = 80;

function getResultsStore() {
  try {
    const opts = { name: 'booking-results', consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }
    return getStore(opts);
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  /* 60 requests / 5 min per IP — covers polling every 3-5 s for ~5 min while
     the webhook lands, with headroom for re-tries. */
  const limited = await checkRateLimit(event, { name: 'booking-status', limit: 60, windowMs: 5 * 60 * 1000 });
  if (!limited.ok) return rateLimitResponse(corsHeaders, limited.retryAfter);

  const params = event.queryStringParameters || {};
  const bookingCode = String(params.ref || '').trim();
  if (!bookingCode || bookingCode.length > MAX_BOOKING_CODE_LEN || !/^[A-Za-z0-9_-]+$/.test(bookingCode)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'ref inválido' }) };
  }

  const store = getResultsStore();
  if (!store) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Booking store unavailable' }) };
  }

  let entry;
  try {
    const raw = await store.get(`direct-${bookingCode}`);
    if (raw) {
      try { entry = JSON.parse(raw); }
      catch (e) { entry = null; }
    }
  } catch (e) {
    console.error('[booking-status] store read failed:', e.message);
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Booking store error' }) };
  }

  if (!entry) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ status: 'pending', ref: bookingCode })
    };
  }

  /* Map any persisted shape to a stable payload the cliente can consume. */
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      status: 'confirmed',
      ref: bookingCode,
      bookingCode: entry.bookingCode || bookingCode,
      otasyncId: entry.otasyncId || entry.id_reservations || null,
      reservationPending: Boolean(entry.reservationPending),
      reason: entry.reason || null
    })
  };
};

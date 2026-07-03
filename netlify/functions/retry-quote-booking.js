const { authorize } = require('./_authz');
const { getQuoteStore, loadQuote, saveQuote, computeQuoteTotal } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, createConfirmedReservation, hasOtasyncCreds } = require('./_otasync');

/* Admin-only: retry creating the PMS reservation for a quote that was paid
   but left in reservationPending (booking failed at payment time). */
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authorize(event, 'quotes.edit');
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const quoteId = String(body.quoteId || '').trim();
  if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(quoteId)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'quoteId inválido' }) };
  }

  if (!hasOtasyncCreds()) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'OTASync no configurado' }) };
  }

  let store, quote;
  try {
    store = getQuoteStore();
    quote = await loadQuote(store, quoteId);
  } catch (e) {
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
  }
  if (!quote) return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };

  if (!(quote.status === 'aceptada' && quote.reservationPending)) {
    return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'La cotización no está en estado "reserva pendiente"' }) };
  }

  // Make sure rooms are actually free now
  try {
    const { availByType, isMock } = await getAvailabilityByType(quote.checkin, quote.checkout);
    if (!isMock) {
      const shortfalls = findUnavailable(quote.items, availByType);
      if (shortfalls.length > 0) {
        return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'Aún sin disponibilidad', unavailable: shortfalls }) };
      }
    }
  } catch (e) {
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'No se pudo verificar la disponibilidad' }) };
  }

  let bookingCode;
  try {
    const total = computeQuoteTotal(quote).total;
    bookingCode = await createConfirmedReservation(quote, { paidAmount: total, transactionId: quote.transactionId });
  } catch (e) {
    console.error('[retry-quote-booking] reservation failed for', quoteId, e.message);
    return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'No se pudo crear la reserva en Kunas' }) };
  }

  quote.bookingCodes = [bookingCode];
  quote.reservationPending = false;
  quote.availabilityOk = true;
  delete quote.unavailable;
  quote.updatedAt = new Date().toISOString();
  try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };
};

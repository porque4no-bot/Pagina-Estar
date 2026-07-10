const { authorize } = require('./_authz');
const { getQuoteStore, loadQuote, saveQuote, computeQuoteTotal } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, createConfirmedReservation, hasOtasyncCreds } = require('./_otasync');
const { acquireQuoteLock, releaseQuoteLock } = require('./_quote-lock');

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

  /* Single-writer lock: sin él, dos POST concurrentes (doble clic en el panel)
     pasan ambos el check de estado y crean DOS reservas. Mismo candado que usa
     wompi-webhook. Si otro escritor lo tiene, devolvemos 409. */
  const lock = await acquireQuoteLock(quoteId, quote.transactionId || `retry-${quoteId}`);
  if (!lock.acquired) {
    return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'La cotización se está procesando en este momento. Intenta de nuevo en unos segundos.' }) };
  }

  try {
    /* Recarga bajo el lock: otro escritor (webhook o retry previo) pudo haber
       completado la reserva justo antes de adquirirlo. */
    let fresh;
    try { fresh = await loadQuote(store, quoteId); } catch (e) { fresh = quote; }
    if (fresh && !(fresh.status === 'aceptada' && fresh.reservationPending)) {
      return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ error: 'La cotización ya no está en estado "reserva pendiente" (otro proceso la completó).' }) };
    }
    quote = fresh || quote;

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
    /* saveQuote debe cuadrar: si falla, la reserva ya se creó pero la quote sigue
       marcada pendiente y un retry posterior duplicaría. Reintentar una vez y, si
       aun así falla, alertar para seguimiento manual (no volver a "reintentable"). */
    try {
      await saveQuote(store, quote);
    } catch (e) {
      try { await saveQuote(store, quote); }
      catch (e2) {
        console.error('[retry-quote-booking] saveQuote falló tras crear la reserva', quoteId, e2.message);
        try {
          await require('./_alert').reportAlert({
            kind: 'quote_retry_save_failed', severity: 'high',
            message: `Reserva ${bookingCode} creada para ${quoteId} pero no se pudo persistir el estado; NO reintentar (duplicaría).`,
            context: { quoteId, bookingCode },
            dedupeKey: `quote-retry-save-${quoteId}`
          });
        } catch (_) { /* alerta best-effort */ }
      }
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };
  } finally {
    await releaseQuoteLock(quoteId);
  }
};

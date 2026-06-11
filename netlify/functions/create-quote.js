require('./_env');
const crypto = require('crypto');
const { authenticateAdmin } = require('./_firebase-auth');
const { getQuoteStore, saveQuote, sanitizeQuoteInput } = require('./_quotes-store');
const { getAvailabilityByType, findUnavailable, createHold } = require('./_otasync');

function generateQuoteId() {
  const year = new Date().getFullYear();
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `COT-${year}-${s}`;
}

function generatePublicToken() {
  return crypto.randomBytes(24).toString('base64url');
}

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const auth = await authenticateAdmin(event);
    if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

    if (event.body && event.body.length > 20000) return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Payload demasiado grande' }) };

    let body;
    try { body = JSON.parse(event.body); }
    catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

    if (!body.empresa || !body.email || !Array.isArray(body.items) || body.items.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: empresa, email, items' }) };
    }

    const quoteId = generateQuoteId();
    const now = new Date();
    const sanitized = sanitizeQuoteInput(body);

    /* Availability gate: block creation when the PMS lacks free units.
       Skipped when OTASync credentials are missing (local/mock). */
    let availabilityOk = true;
    if (sanitized.checkin && sanitized.checkout) {
      try {
        const { availByType, isMock } = await getAvailabilityByType(sanitized.checkin, sanitized.checkout);
        if (!isMock) {
          const shortfalls = findUnavailable(sanitized.items, availByType);
          if (shortfalls.length > 0) {
            return {
              statusCode: 409,
              headers: corsHeaders,
              body: JSON.stringify({ error: 'Sin disponibilidad para las fechas seleccionadas', unavailable: shortfalls })
            };
          }
        }
      } catch (e) {
        console.error('[create-quote] availability check failed:', e.message);
        return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ error: 'No se pudo verificar la disponibilidad. Intenta de nuevo.' }) };
      }
    }

    const quoteData = {
      quoteId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'activa',
      views: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      createdBy: auth.email || 'admin',
      availabilityOk,
      availabilityCheckedAt: now.toISOString(),
      publicToken: generatePublicToken(),
      bloquearHabitaciones: body.bloquearHabitaciones === true,
      holdReservationIds: [],
      ...sanitized
    };

    /* Persist to Netlify Blobs */
    let store;
    try {
      store = getQuoteStore();
      await saveQuote(store, quoteData);
    } catch (e) {
      console.error('[create-quote] blob store unavailable:', e.message, e.stack);
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible. Intenta de nuevo.' }) };
    }

    /* Optional: place a tentative hold in Kunas to block the rooms */
    if (quoteData.bloquearHabitaciones && quoteData.checkin && quoteData.checkout) {
      try {
        const holdId = await createHold(quoteData);
        if (holdId) {
          quoteData.holdReservationIds = [holdId];
          await saveQuote(store, quoteData);
        }
      } catch (e) {
        console.error('[create-quote] hold creation failed for', quoteId, ':', e.message);
      }
    }

    const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
    const shareUrl = `${base}/cotizacion.html?id=${quoteId}&t=${quoteData.publicToken}`;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ quoteId, shareUrl })
    };
  } catch (err) {
    console.error('[create-quote] error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error interno del servidor', details: err.message })
    };
  }
};

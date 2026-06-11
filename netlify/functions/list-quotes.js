require('./_env');
const { authenticateAdmin } = require('./_firebase-auth');
const { getQuoteStore, listAllQuotes, effectiveStatus } = require('./_quotes-store');

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
    if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

    const auth = await authenticateAdmin(event);
    if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

    let quotes;
    try {
      const store = getQuoteStore();
      quotes = await listAllQuotes(store);
    } catch (e) {
      console.error('[list-quotes] blob store unavailable:', e.message);
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
    }

    /* Full objects (admin only) — include internal fields for editing. Add derived status. */
    quotes.forEach(q => { q.statusEfectivo = effectiveStatus(q); });
    quotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quotes }) };
  } catch (err) {
    console.error('[list-quotes] error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno del servidor', details: err.message }) };
  }
};

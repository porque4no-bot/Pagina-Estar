const { authenticateAdmin } = require('./_firebase-auth');
const { readAuditLog } = require('./_quote-audit');

/* Admin-only read of the append-only audit log for a corporate quote.
   GET /api/read-quote-audit?id=COT-... */
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authenticateAdmin(event);
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  const id = String((event.queryStringParameters || {}).id || '').trim();
  if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(id)) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id inválido' }) };
  }

  let log;
  try { log = await readAuditLog(id); }
  catch (e) {
    console.error('[read-quote-audit] read failed:', e.message);
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Audit log no disponible' }) };
  }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ quoteId: id, entries: log }) };
};

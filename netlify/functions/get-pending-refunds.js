require('./_env');
const { authorize } = require('./_authz');
const { listRefunds } = require('./_refunds-store');

/* Admin-only: list refund records (optionally filtered by ?status=). Powers the
   "Reembolsos" tab in cotizar-admin.html. Read-only. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const auth = await authorize(event, 'refunds.view');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  const status = (event.queryStringParameters || {}).status || null;
  try {
    const refunds = await listRefunds(status);
    return { statusCode: 200, headers, body: JSON.stringify({ refunds }) };
  } catch (e) {
    console.error('[get-pending-refunds]', e.message);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Almacenamiento de reembolsos no disponible' }) };
  }
};

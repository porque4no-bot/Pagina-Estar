/* Admin-only one-shot to seed the Google service account JSON into Netlify
 * Blobs ('secrets/google-service-account.json'). Required because AWS Lambda
 * enforces a 4KB total env var limit and the service account JSON alone is
 * 2-3KB, leaving no room for our other secrets.
 *
 * Usage (from cotizar-admin.html or similar admin page):
 *   POST /api/upload-drive-credentials
 *   Authorization: Bearer <Firebase admin id token>
 *   Content-Type: application/json
 *   Body: <the full service account JSON, as an object>
 */

const { authorize } = require('./_authz');
const { writeBlobCredentials, probe } = require('./_google-drive');

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = await authorize(event, 'integrations.credentials.upload');
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  if (!event.body || event.body.length > 8000) {
    return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Payload too large or missing' }) };
  }

  let credentials;
  try { credentials = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  /* Basic shape validation — the writeBlobCredentials helper will also reject
     if private_key or client_email are missing. */
  if (typeof credentials !== 'object' || !credentials.private_key || !credentials.client_email) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Body must be a service account JSON with private_key and client_email' }) };
  }

  try {
    await writeBlobCredentials(credentials);
  } catch (e) {
    console.error('[upload-drive-credentials] persist failed:', e.message);
    return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
  }

  /* Verify immediately so the admin gets confirmation that the new credentials
     actually work against the destination folder. */
  const verification = await probe();

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      ok: true,
      stored: true,
      verification,
      clientEmail: credentials.client_email
    })
  };
};

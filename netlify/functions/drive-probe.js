/* Admin-only health probe for the Google Drive service-account integration.
   GET /api/drive-probe
   Returns whether GOOGLE_SERVICE_ACCOUNT_JSON parses, whether GOOGLE_DRIVE_FOLDER_ID
   resolves to a folder in a Shared Drive, and the folder's name/mimeType. Used
   during setup to confirm Netlify env vars + Drive sharing without uploading
   anything. */

const { authorize } = require('./_authz');
const { probe } = require('./_google-drive');

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

  const auth = await authorize(event, 'integrations.probe');
  if (!auth.ok) return { statusCode: auth.statusCode, headers: corsHeaders, body: JSON.stringify({ error: auth.error }) };

  const result = await probe();
  return {
    statusCode: result.ok ? 200 : 503,
    headers: corsHeaders,
    body: JSON.stringify(result)
  };
};

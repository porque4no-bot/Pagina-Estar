const fs = require('fs');
const path = require('path');

function loadEnv() {
  if (process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true') return;
  try {
    const envPath = path.join(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m) return;
      let v = m[2] || '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v.trim();
    });
  } catch (e) {}
}

loadEnv();

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const params = event.queryStringParameters || {};
  const encoded = params.d;

  if (!encoded) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parámetro d requerido' }) };
  }

  let quoteData;
  try {
    quoteData = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (e) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada', expired: false }) };
  }

  if (!quoteData || !quoteData.quoteId) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada', expired: false }) };
  }

  /* Check expiry */
  if (quoteData.expiresAt) {
    const expires = new Date(quoteData.expiresAt);
    if (!isNaN(expires.getTime()) && expires < new Date()) {
      return { statusCode: 410, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización vencida', expired: true }) };
    }
  }

  /* Strip internal field before returning */
  const { createdBy, ...publicData } = quoteData;
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(publicData) };
};

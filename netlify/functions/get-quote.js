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

  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

    const params = event.queryStringParameters || {};
    const encoded = params.d;

    if (!encoded) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parámetro d requerido' }) };
    }

    let quoteData;
    try {
      // Decode manually to support older Node runtimes that lack base64url support
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      quoteData = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
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
  } catch (err) {
    console.error('[get-quote] error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error interno del servidor', details: err.message })
    };
  }
};

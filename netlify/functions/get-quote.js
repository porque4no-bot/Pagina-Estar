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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const quoteId = event.queryStringParameters && event.queryStringParameters.id;
  if (!quoteId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falta el parámetro id' }) };

  if (!/^COT-\d{4}-[A-Z0-9]{5}$/.test(quoteId)) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };
  }

  let quoteData;
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('quotes');
    quoteData = await store.get(quoteId, { type: 'json' });
  } catch (err) {
    console.error('[get-quote] Blobs error:', err.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error al obtener la cotización' }) };
  }

  if (!quoteData) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada' }) };
  }

  if (quoteData.expiresAt && new Date(quoteData.expiresAt) < new Date()) {
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Esta cotización ha vencido', expired: true }) };
  }

  const { createdBy, ...publicData } = quoteData;
  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Cache-Control': 'no-store' },
    body: JSON.stringify(publicData)
  };
};

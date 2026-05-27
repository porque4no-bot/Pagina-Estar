const fs = require('fs');
const path = require('path');
const { authenticateAdmin } = require('./_firebase-auth');
const { getQuoteStore, saveQuote, sanitizeQuoteInput } = require('./_quotes-store');

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

function generateQuoteId() {
  const year = new Date().getFullYear();
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `COT-${year}-${s}`;
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

    const quoteData = {
      quoteId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'activa',
      views: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      createdBy: auth.email || 'admin',
      ...sanitized
    };

    /* Persist to Netlify Blobs */
    try {
      const store = getQuoteStore();
      await saveQuote(store, quoteData);
    } catch (e) {
      console.error('[create-quote] blob store unavailable:', e.message);
      return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible. Intenta de nuevo.' }) };
    }

    const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
    const shareUrl = `${base}/cotizacion.html?id=${quoteId}`;

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

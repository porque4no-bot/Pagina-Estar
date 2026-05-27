const fs = require('fs');
const path = require('path');
const { getStore } = require('@netlify/blobs');

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
  try {
    return await handleRequest(event, context, corsHeaders);
  } catch (err) {
    console.error('[create-quote] Unhandled error:', err);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error interno: ' + (err.message || String(err)) }) };
  }
};

async function handleRequest(event, context, corsHeaders) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) corsHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  const user = context.clientContext && context.clientContext.user;
  if (!user) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Autenticación requerida' }) };

  if (event.body && event.body.length > 20000) return { statusCode: 413, headers: corsHeaders, body: JSON.stringify({ error: 'Payload demasiado grande' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { empresa, contacto, email, telefono, nit, referencia, validaHasta, items, descuento, condiciones } = body;

  if (!empresa || !email || !Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Faltan campos: empresa, email, items' }) };
  }

  const sanitizedItems = items.map(item => {
    const u = Math.max(1, Math.min(100, parseInt(item.unidades) || 1));
    const n = Math.max(1, Math.min(365, parseInt(item.noches) || 1));
    const t = Math.max(0, parseFloat(item.tarifaPorNoche) || 0);
    return {
      habitacion: String(item.habitacion || 'Clásica').slice(0, 100),
      unidades: u,
      noches: n,
      tarifaPorNoche: t,
      subtotal: u * n * t
    };
  });

  const quoteId = generateQuoteId();
  const now = new Date();
  const parsedExpiry = validaHasta ? new Date(validaHasta) : null;
  const expiresAt = (parsedExpiry && !isNaN(parsedExpiry.getTime()))
    ? parsedExpiry.toISOString()
    : new Date(now.getTime() + 30 * 86400000).toISOString();

  const quoteData = {
    quoteId,
    empresa: String(empresa).slice(0, 200),
    contacto: String(contacto || '').slice(0, 200),
    email: String(email).slice(0, 254),
    telefono: String(telefono || '').slice(0, 50),
    nit: String(nit || '').slice(0, 50),
    referencia: String(referencia || '').slice(0, 300),
    createdAt: now.toISOString(),
    expiresAt,
    items: sanitizedItems,
    descuento: {
      tipo: (descuento && descuento.tipo === 'fijo') ? 'fijo' : 'porcentaje',
      valor: Math.max(0, parseFloat((descuento && descuento.valor) || 0))
    },
    condiciones: String(condiciones || '').slice(0, 2000),
    createdBy: user.email || user.sub || 'admin'
  };

  try {
    const store = getStore('quotes');
    await store.setJSON(quoteId, quoteData);
  } catch (err) {
    console.error('[create-quote] Blobs error:', err.message, err.stack);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Error al guardar la cotización: ' + err.message }) };
  }

  const base = (process.env.URL || process.env.DEPLOY_URL || 'https://estar.com.co').replace(/\/$/, '');
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({ quoteId, shareUrl: `${base}/cotizacion.html?id=${quoteId}` })
  };
};

const fs = require('fs');
const path = require('path');
const { getQuoteStore, loadQuote, saveQuote, effectiveStatus, toPublic } = require('./_quotes-store');

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

/* Legacy: decode a quote that was fully encoded in the URL (?d=) */
function decodeLegacy(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

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
    const id = params.id;
    const encoded = params.d;
    const isPreview = params.preview === '1';

    /* ── Stored quote (id-based) ── */
    if (id) {
      let store, quote;
      try {
        store = getQuoteStore();
        quote = await loadQuote(store, id);
      } catch (e) {
        console.error('[get-quote] blob store unavailable:', e.message, e.stack);
        return { statusCode: 503, headers: corsHeaders, body: JSON.stringify({ error: 'Almacenamiento no disponible' }) };
      }

      if (!quote) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada', expired: false }) };
      }

      const status = effectiveStatus(quote);
      if (status === 'cancelada') {
        return { statusCode: 410, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización cancelada', cancelled: true }) };
      }
      if (status === 'vencida') {
        return { statusCode: 410, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización vencida', expired: true }) };
      }

      /* Track view (skip admin previews) */
      if (!isPreview) {
        const now = new Date().toISOString();
        quote.views = (quote.views || 0) + 1;
        if (!quote.firstViewedAt) quote.firstViewedAt = now;
        quote.lastViewedAt = now;
        if (quote.status === 'activa') quote.status = 'vista';
        try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
      }

      const pub = toPublic(quote);
      if (status === 'aceptada') {
        pub.paid = true;
        pub.bookingCode = (quote.bookingCodes && quote.bookingCodes[0]) || null;
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(pub) };
    }

    /* ── Legacy encoded quote (?d=) ── */
    if (encoded) {
      let quoteData;
      try { quoteData = decodeLegacy(encoded); }
      catch (e) { return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada', expired: false }) }; }

      if (!quoteData || !quoteData.quoteId) {
        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización no encontrada', expired: false }) };
      }
      if (quoteData.expiresAt) {
        const expires = new Date(quoteData.expiresAt);
        if (!isNaN(expires.getTime()) && expires < new Date()) {
          return { statusCode: 410, headers: corsHeaders, body: JSON.stringify({ error: 'Cotización vencida', expired: true }) };
        }
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(toPublic(quoteData)) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Parámetro id o d requerido' }) };
  } catch (err) {
    console.error('[get-quote] error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Error interno del servidor', details: err.message })
    };
  }
};

require('./_env');
const crypto = require('crypto');
const { getQuoteStore, loadQuote, computeQuoteTotal } = require('./_quotes-store');
const { renderQuotePDF } = require('./_pdf-render');

const QUOTE_ID_RE = /^COT-\d{4}-[A-Z0-9]{5}$/;

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && ba.length > 0 && crypto.timingSafeEqual(ba, bb);
}

/* Server-side PDF for the corporate quote viewer. Replaces the fragile
   client-side html2canvas render: text-only PDFKit output that always matches
   the stored quote (same data the webhook charges). Gated by the publicToken,
   like get-quote / quote-availability. */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  const params = event.queryStringParameters || {};
  const id = String(params.id || '').trim();
  const token = String(params.t || '').trim();
  if (!QUOTE_ID_RE.test(id)) return { statusCode: 400, headers, body: 'Identificador de cotización inválido' };

  let quote;
  try {
    quote = await loadQuote(getQuoteStore(), id);
  } catch (e) {
    console.error('[quote-pdf] quote store unavailable:', e.message);
    return { statusCode: 503, headers, body: 'Servicio no disponible. Intenta de nuevo.' };
  }
  if (!quote) return { statusCode: 404, headers, body: 'Cotización no encontrada' };

  /* Second factor: the public token must match (uniform 404 on mismatch so an
     enumerated id alone discloses nothing). */
  if (quote.publicToken && !timingSafeEqual(token, quote.publicToken)) {
    return { statusCode: 404, headers, body: 'Cotización no encontrada' };
  }

  let pdf;
  try {
    const totals = computeQuoteTotal(quote);
    pdf = await renderQuotePDF(quote, totals);
  } catch (e) {
    console.error('[quote-pdf] render failed:', e.message);
    return { statusCode: 500, headers, body: 'No se pudo generar el PDF.' };
  }

  return {
    statusCode: 200,
    headers: {
      ...headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Cotizacion-${id}.pdf"`,
      'Cache-Control': 'no-store'
    },
    body: pdf.toString('base64'),
    isBase64Encoded: true
  };
};

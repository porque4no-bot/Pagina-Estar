require('./_env');
const { authorize } = require('./_authz');
const { flag } = require('./_settings');

/* GET — borradores de factura pendientes de emitir (facturación electrónica DIAN
   vía Numera). Lee del store de Netlify Blobs 'invoices'. Cada borrador es lo que
   se acumula antes de emitir de verdad (hoy la emisión está en DRY-RUN: ver
   _numera.js + invoice-admin-action.js). Read-only. Backs la pestaña de
   facturación en /admin.

   Mock-safe: si no hay Blobs disponibles (local sin credenciales) o el store aún
   no existe, devuelve una lista vacía sin lanzar. */

const STORE_NAME = 'invoices';

function invoicesStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: STORE_NAME, consistency: 'strong' };
  /* Netlify reserva el prefijo NETLIFY_ y no lo expone a las funciones, así que
     preferimos los nombres neutros (BLOBS_*) y caemos a los demás. */
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

/* Lee todos los borradores del store. Mock-safe: cualquier fallo (sin Blobs,
   store vacío, blob corrupto) → lista vacía; nunca lanza.
   deps.store inyectable para tests (sin red). */
async function listInvoiceDrafts(deps = {}) {
  let store;
  try { store = deps.store || invoicesStore(); }
  catch (e) { return { isMock: true, invoices: [] }; }

  try {
    const { blobs } = await store.list();
    const out = [];
    for (const b of (blobs || [])) {
      try {
        const raw = await store.get(b.key);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) { /* borrador ilegible → se omite */ }
    }
    /* filtro opcional por estado, si el borrador lo trae */
    return { invoices: out };
  } catch (e) {
    /* store inexistente / sin Blobs → nada pendiente todavía */
    return { isMock: true, invoices: [] };
  }
}

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

  const auth = await authorize(event, 'invoices.view');
  if (!auth.ok) return { statusCode: auth.statusCode, headers, body: JSON.stringify({ error: auth.error }) };

  const status = (event.queryStringParameters || {}).status || null;
  try {
    const invoicingEnabled = await flag('NUMERA_INVOICING_ENABLED');
    const result = await listInvoiceDrafts();
    let invoices = result.invoices || [];
    if (status) invoices = invoices.filter(inv => String(inv && inv.status || '') === status);
    return { statusCode: 200, headers, body: JSON.stringify({ invoices, isMock: !!result.isMock, invoicingEnabled }) };
  } catch (e) {
    console.error('[get-pending-invoices]', e.message);
    /* Mock-safe hasta el borde: nunca 5xx por falta de Blobs. */
    return { statusCode: 200, headers, body: JSON.stringify({ invoices: [], isMock: true }) };
  }
};

exports._test = { listInvoiceDrafts };

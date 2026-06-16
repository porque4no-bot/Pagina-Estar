/* Conector con Odoo (ERP/CRM/contabilidad) — Fase 1 de la integración.

   Objetivo de esta fase: el MAESTRO DE CLIENTES. Cada persona o empresa que
   entra por cualquier canal (formulario corporativo, larga estadía, reserva,
   bot) se crea o se encuentra como un único `res.partner` en Odoo, para que
   CRM, marketing, cotizaciones, reservas y facturas cuelguen del mismo cliente.

   Diseño:
   - Habla con Odoo por su API externa vía **JSON-RPC** (`/jsonrpc`), que se
     resuelve con `fetch` + JSON puro (sin dependencias XML). Compatible con
     Odoo 17–19.
   - **Sin credenciales = no-op logueado** (mock), igual que el resto de
     integraciones del repo: nada se rompe en local ni mientras no enchufemos
     Odoo. Cuando estén las variables, empieza a sincronizar de verdad.
   - **Deduplicación** del cliente por NIT/cédula (`vat`) y, en su defecto, por
     email — para no crear partners repetidos desde distintos canales.
   - El transporte (`fetch`) es inyectable para pruebas sin red.

   Variables de entorno (ver .env.example):
     ODOO_URL        https://miempresa.odoo.com   (sin slash final)
     ODOO_DB         nombre de la base de datos
     ODOO_USERNAME   login del usuario de integración (email)
     ODOO_API_KEY    API key del usuario (Preferencias → Seguridad de la cuenta)
     ODOO_TIMEOUT_MS opcional, default 10000
*/

function odooConfig() {
  return {
    url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
    db: process.env.ODOO_DB || '',
    username: process.env.ODOO_USERNAME || '',
    apiKey: process.env.ODOO_API_KEY || '',
    timeoutMs: parseInt(process.env.ODOO_TIMEOUT_MS, 10) || 10000
  };
}

function isConfigured() {
  const c = odooConfig();
  return Boolean(c.url && c.db && c.username && c.apiKey);
}

/* ── Normalización de datos del cliente → valores de res.partner ──
   `vat` en Colombia es el NIT/cédula; lo dejamos solo con dígitos y guión de
   verificación para que la deduplicación sea estable. */
function normalizeVat(vat) {
  const s = String(vat || '').trim();
  if (!s) return '';
  return s.replace(/[^0-9kK\-]/g, '');
}

function buildPartnerValues(data) {
  const values = {};
  if (data.name) values.name = String(data.name).slice(0, 200);
  const vat = normalizeVat(data.vat || data.nit);
  if (vat) values.vat = vat;
  if (data.email) values.email = String(data.email).toLowerCase().trim().slice(0, 254);
  if (data.phone) values.phone = String(data.phone).slice(0, 50);
  if (data.isCompany !== undefined) values.is_company = Boolean(data.isCompany);
  if (data.comment) values.comment = String(data.comment).slice(0, 2000);
  if (data.country) values.country_code = String(data.country).slice(0, 2);
  return values;
}

/* ── JSON-RPC ── */
async function jsonRpc(service, method, args, transport) {
  const c = odooConfig();
  const fetchImpl = transport || fetch;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetchImpl(`${c.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    const data = await res.json().catch(() => ({}));
    if (data && data.error) {
      const msg = (data.error.data && data.error.data.message) || data.error.message || 'Odoo RPC error';
      throw new Error(msg);
    }
    return data ? data.result : undefined;
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Odoo request timeout') : err;
  }
}

/* uid cacheado por proceso (la API key no expira con el uso). */
let cachedUid = null;
async function authenticate(transport) {
  if (cachedUid) return cachedUid;
  const c = odooConfig();
  const uid = await jsonRpc('common', 'authenticate', [c.db, c.username, c.apiKey, {}], transport);
  if (!uid) throw new Error('Odoo authentication failed (revisa ODOO_DB / ODOO_USERNAME / ODOO_API_KEY)');
  cachedUid = uid;
  return uid;
}

async function executeKw(model, method, args, kwargs, transport) {
  const c = odooConfig();
  const uid = await authenticate(transport);
  return jsonRpc('object', 'execute_kw', [c.db, uid, c.apiKey, model, method, args, kwargs || {}], transport);
}

/* ── Maestro de clientes: crear o actualizar un partner ──
   Devuelve { id, created, isMock }. Deduplica por vat y luego por email.
   Nunca debe tumbar el flujo de negocio: los llamadores envuelven en try/catch
   y tratan el error como no fatal. */
async function upsertPartner(data, opts) {
  opts = opts || {};
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock upsertPartner (sin credenciales):', data && (data.name || data.email));
    return { id: null, created: false, isMock: true };
  }
  const transport = opts.transport;
  const values = buildPartnerValues(data);
  if (!values.name && !values.email && !values.vat) {
    throw new Error('upsertPartner requiere al menos name, email o vat');
  }

  let domain = null;
  if (values.vat) domain = [['vat', '=', values.vat]];
  else if (values.email) domain = [['email', '=ilike', values.email]];

  let existingId = null;
  if (domain) {
    const found = await executeKw('res.partner', 'search', [domain], { limit: 1 }, transport);
    if (Array.isArray(found) && found.length) existingId = found[0];
  }

  if (existingId) {
    await executeKw('res.partner', 'write', [[existingId], values], {}, transport);
    return { id: existingId, created: false, isMock: false };
  }
  const id = await executeKw('res.partner', 'create', [values], {}, transport);
  return { id, created: true, isMock: false };
}

/* Para tests: limpiar el uid cacheado entre escenarios. */
function _resetAuthCache() { cachedUid = null; }

module.exports = {
  odooConfig, isConfigured, normalizeVat, buildPartnerValues,
  jsonRpc, authenticate, executeKw, upsertPartner, _resetAuthCache
};

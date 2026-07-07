require('./_env');
const { flag } = require('./_settings');
const { requirePortalSession } = require('./portal-session');
const { getQuoteStore, listAllQuotes, effectiveStatus, toPublic } = require('./_quotes-store');
const odoo = require('./_odoo');

/* ── Portal EMPRESA — backend de SOLO LECTURA ────────────────────────────────
   Alimenta la vista de "cuenta corriente" del cliente corporativo del portal.
   Verifica el token de sesión PROPIO del portal (patrón guest-session, emitido
   por portal-session.js) y mapea la sesión → empresa (NIT / partner de Odoo).
   NUNCA expone credenciales OTASync/Odoo al cliente ni escribe nada: solo lee.

   Fuentes:
     - cotizaciones  → _quotes-store (Blobs 'quotes') filtradas por la empresa,
                       expuestas con toPublic() (sin comisión/tarifaBase/tokens).
     - cartera/facturas/pedidos → _odoo.getCartera/getInvoices/getOrders (Odoo,
                       solo-lectura, mock-safe).
     - documentación → enlace a la carpeta Drive de la empresa (por ID).

   GATING: apagado por defecto vía flag('PORTAL_ENABLED'). OFF ⇒ respuesta inerte,
   nunca toca Blobs ni Odoo. Mock-safe: sin credenciales las fuentes devuelven
   estructuras vacías/mock y esta función jamás lanza.

   Ruta: /api/portal-company (vía el rewrite /api/* → /.netlify/functions/:splat).
   Autorización de negocio = token de sesión del portal con profile 'empresa'.
   (No usa authorize()/Firebase: ese es el carril staff/admin; el cliente
   corporativo se autentica con su propia sesión firmada — ver integrationNotes.) */

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  };
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && allowedOrigin !== '*') {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { ...corsHeaders(), ...headers }, body: JSON.stringify(body) };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

/* NIT comparable: solo dígitos (descarta puntos, guiones, espacios y DV con
   separador). Usado únicamente para EMPAREJAR la empresa con sus cotizaciones;
   para Odoo se pasa el NIT crudo (resolvePartnerId ya lo normaliza). */
function normalizeNitDigits(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const noDv = s.replace(/[\s]/g, '').replace(/-\w+$/, '');
  return noDv.replace(/\D/g, '');
}

/* Parsea un JSON de mapa de env de forma tolerante; devuelve {} ante cualquier
   error (config malformada nunca tumba la función). */
function parseJsonMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/* Mapea la sesión (email/profile del token del portal) → identidad de empresa:
   { email, nit }. El NIT sale del claim de sesión si existe, o de un mapa de
   env opcional email→NIT (PORTAL_EMPRESA_NIT_JSON). Sin NIT conocido se usa el
   email como clave de partner en Odoo (getCartera acepta {email}). PURO. */
function resolveCompany(session) {
  const email = normalizeEmail(session && session.sub);
  let nit = String((session && session.nit) || '').trim().slice(0, 50);
  if (!nit) {
    const map = parseJsonMap(process.env.PORTAL_EMPRESA_NIT_JSON);
    const mapped = map[email];
    if (mapped) nit = String(mapped).trim().slice(0, 50);
  }
  return { email, nit };
}

/* partnerKey para Odoo: prioriza NIT (mismo orden de dedup que upsertPartner)
   y cae al email cuando no hay NIT. null si no hay ninguno. */
function partnerKeyFor(company) {
  if (company.nit) return { vat: company.nit };
  if (company.email) return { email: company.email };
  return null;
}

/* Enlace a la carpeta Drive de documentación de la empresa. Resuelve por NIT
   (dígitos) o email desde un mapa de env opcional (PORTAL_DRIVE_FOLDER_JSON), o
   cae a una carpeta por defecto (PORTAL_DRIVE_FOLDER_ID). Devuelve null si no
   hay carpeta configurada — nunca inventa un enlace. */
function docsLinkFor(company) {
  const map = parseJsonMap(process.env.PORTAL_DRIVE_FOLDER_JSON);
  const byNit = company.nit ? (map[company.nit] || map[normalizeNitDigits(company.nit)]) : null;
  const byEmail = company.email ? map[company.email] : null;
  const folderId = String(byNit || byEmail || process.env.PORTAL_DRIVE_FOLDER_ID || '').trim();
  if (!folderId) return null;
  return {
    folderId,
    url: `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`
  };
}

/* Empareja una cotización con la empresa de la sesión: por NIT (dígitos) o, en
   su defecto, por email del contacto. PURO. */
function quoteBelongsToCompany(quote, company) {
  if (!quote) return false;
  const qNit = normalizeNitDigits(quote.nit);
  const cNit = normalizeNitDigits(company.nit);
  if (cNit && qNit && qNit === cNit) return true;
  if (company.email && normalizeEmail(quote.email) === company.email) return true;
  return false;
}

/* Cotizaciones de la empresa (solo-lectura, cara al cliente): filtra por empresa
   y aplica toPublic() (quita comisión, tarifaBase, tokens, campos internos).
   Best-effort: si Blobs no está disponible devuelve lista vacía con nota. */
async function loadCompanyQuotes(company) {
  let store;
  try {
    store = getQuoteStore();
  } catch (e) {
    console.error('[portal-company] blob store unavailable:', e.message);
    return { quotes: [], count: 0, unavailable: true };
  }
  let all;
  try {
    all = await listAllQuotes(store);
  } catch (e) {
    console.error('[portal-company] listAllQuotes failed:', e.message);
    return { quotes: [], count: 0, unavailable: true };
  }
  const mine = all
    .filter(q => quoteBelongsToCompany(q, company))
    .map(q => {
      const status = effectiveStatus(q);
      const pub = toPublic(q);
      pub.statusEfectivo = status;
      return pub;
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  return { quotes: mine, count: mine.length };
}

/* Cada slice de Odoo es mock-safe y no lanza; aun así lo envolvemos para que un
   fallo de una fuente no rompa el resto de la respuesta. */
async function safe(promiseFactory, fallback) {
  try {
    return await promiseFactory();
  } catch (e) {
    console.error('[portal-company] source failed:', e.message);
    return fallback;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  /* GATE: apagado por defecto. Inerte, sin tocar Blobs/Odoo, sin filtrar nada. */
  if (!(await flag('PORTAL_ENABLED'))) {
    return json(200, { ok: false, enabled: false });
  }

  /* Identidad = token de sesión propio del portal (purpose 'session'). */
  let session;
  try {
    session = requirePortalSession(event);
  } catch (e) {
    return json(e.statusCode || 401, { error: 'Sesión del portal inválida o expirada.' });
  }

  /* Este backend es exclusivo del perfil EMPRESA. */
  if (session.profile !== 'empresa') {
    return json(403, { error: 'Este portal es solo para clientes empresa.' });
  }

  const company = resolveCompany(session);
  if (!company.email && !company.nit) {
    return json(200, {
      ok: true,
      profile: { email: company.email, nit: company.nit },
      quotes: { quotes: [], count: 0 },
      cartera: { partnerId: null, total: 0, buckets: odoo.emptyBuckets(), documentos: [], count: 0 },
      invoices: { partnerId: null, count: 0, invoices: [] },
      orders: { partnerId: null, count: 0, orders: [] },
      docs: null
    });
  }

  const partnerKey = partnerKeyFor(company);
  const section = String((event.queryStringParameters && event.queryStringParameters.section) || '').trim().toLowerCase();

  try {
    /* Slice único bajo demanda (?section=...) para vistas parciales del portal. */
    if (section === 'quotes') return json(200, { ok: true, quotes: await loadCompanyQuotes(company) });
    if (section === 'cartera') return json(200, { ok: true, cartera: await safe(() => odoo.getCartera(partnerKey), null) });
    if (section === 'invoices') return json(200, { ok: true, invoices: await safe(() => odoo.getInvoices(partnerKey), null) });
    if (section === 'orders') return json(200, { ok: true, orders: await safe(() => odoo.getOrders(partnerKey), null) });
    if (section === 'docs') return json(200, { ok: true, docs: docsLinkFor(company) });

    /* Vista general: todas las fuentes en paralelo (todas mock-safe). */
    const [quotes, cartera, invoices, orders] = await Promise.all([
      loadCompanyQuotes(company),
      safe(() => odoo.getCartera(partnerKey), null),
      safe(() => odoo.getInvoices(partnerKey), null),
      safe(() => odoo.getOrders(partnerKey), null)
    ]);

    return json(200, {
      ok: true,
      profile: { email: company.email, nit: company.nit || null },
      quotes,
      cartera,
      invoices,
      orders,
      docs: docsLinkFor(company)
    });
  } catch (err) {
    console.error('[portal-company]', err.message);
    return json(500, { error: 'No fue posible cargar la información de la empresa.' });
  }
};

/* Exportados para pruebas unitarias de la lógica pura (sin red/Blobs). */
exports.normalizeNitDigits = normalizeNitDigits;
exports.resolveCompany = resolveCompany;
exports.partnerKeyFor = partnerKeyFor;
exports.quoteBelongsToCompany = quoteBelongsToCompany;
exports.docsLinkFor = docsLinkFor;
exports.parseJsonMap = parseJsonMap;

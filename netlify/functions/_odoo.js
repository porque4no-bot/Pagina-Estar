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
     ODOO_COMPANY_ID opcional. Si se setea (p. ej. la empresa del hotel), los
                     partners se crean/actualizan asignados a esa empresa en
                     bases MULTIEMPRESA. Sin él, quedan compartidos (visibles en
                     todas las empresas).
     ODOO_TIMEOUT_MS opcional, default 10000
*/

function odooConfig() {
  return {
    url: (process.env.ODOO_URL || '').replace(/\/+$/, ''),
    db: process.env.ODOO_DB || '',
    username: process.env.ODOO_USERNAME || '',
    apiKey: process.env.ODOO_API_KEY || '',
    companyId: parseInt(process.env.ODOO_COMPANY_ID, 10) || null,
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
  /* Nota: el país no se setea aquí. `country_code` en res.partner es de solo
     lectura (related de country_id); habría que resolver country_id por código
     (res.country) — se hará en una fase posterior si se necesita. */
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
    if (res && res.ok === false) throw new Error('Odoo HTTP ' + res.status);
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
/* Upserts en vuelo por clave (vat/email): deduplica llamadas concurrentes del
   MISMO cliente dentro del proceso (mitiga partners duplicados por race entre
   search y create). El caso entre instancias distintas requeriría un lock o una
   restricción única en Odoo. */
const _inflightUpserts = new Map();
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
  const c = odooConfig();
  const values = buildPartnerValues(data);
  if (!values.name && !values.email && !values.vat) {
    throw new Error('upsertPartner requiere al menos name, email o vat');
  }

  /* Multiempresa: si se configura ODOO_COMPANY_ID, el partner se asigna a esa
     empresa (la del hotel, p. ej. Mirada SAS) para segregarlo del resto del
     grupo y que sus ventas/facturas cuadren bajo esa empresa. Hay que pasar
     `allowed_company_ids` en el contexto de cada llamada porque el usuario de
     integración puede tener OTRA empresa por defecto: sin eso, la creación se
     rechaza o el registro queda fuera del contexto y "no aparece". Sin la
     variable, el partner queda compartido (company_id nulo → visible en todas
     las empresas). */
  if (c.companyId) values.company_id = c.companyId;
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));

  /* Dedup en vuelo (por proceso): si ya hay un upsert del MISMO cliente en curso,
     reusarlo en lugar de lanzar otro search+create en paralelo. */
  const dedupKey = values.vat || (values.email ? String(values.email).toLowerCase() : '');
  if (dedupKey && _inflightUpserts.has(dedupKey)) return _inflightUpserts.get(dedupKey);

  const work = (async () => {
    let domain = null;
    if (values.vat) domain = [['vat', '=', values.vat]];
    else if (values.email) domain = [['email', '=ilike', values.email]];

    let existingId = null;
    if (domain) {
      const found = await executeKw('res.partner', 'search', [domain], withCtx({ limit: 1 }), transport);
      if (Array.isArray(found) && found.length) existingId = found[0];
    }

    /* Etiquetas de contacto (segmentación tipo CRM SIN necesitar el módulo CRM):
       resuelve/crea cada `res.partner.category` por nombre y la AÑADE al partner
       con el comando (4,id) — añade, no reemplaza las etiquetas que ya tenga. */
    if (Array.isArray(data.tags) && data.tags.length) {
      try {
        const tagIds = [];
        for (const raw of data.tags) {
          const nm = String(raw || '').trim().slice(0, 100);
          if (!nm) continue;
          const hit = await executeKw('res.partner.category', 'search', [[['name', '=', nm]]], withCtx({ limit: 1 }), transport);
          const id = (Array.isArray(hit) && hit.length) ? hit[0]
            : await executeKw('res.partner.category', 'create', [{ name: nm }], withCtx(), transport);
          if (id) tagIds.push(id);
        }
        if (tagIds.length) values.category_id = tagIds.map(id => [4, id]);
      } catch (tagErr) {
        /* Las etiquetas son metadata secundaria: si su resolución falla
           (red/timeout/5xx), el partner se crea igual sin category_id. */
        if (process.env.DEBUG) console.log('[odoo] etiquetas no resueltas (el partner se crea igual):', tagErr.message);
      }
    }

    async function persist(vals) {
      if (existingId) {
        await executeKw('res.partner', 'write', [[existingId], vals], withCtx(), transport);
        return { id: existingId, created: false, isMock: false };
      }
      const id = await executeKw('res.partner', 'create', [vals], withCtx(), transport);
      return { id, created: true, isMock: false };
    }

    try {
      return await persist(values);
    } catch (err) {
      /* La localización colombiana de Odoo puede rechazar el NIT en `vat` por
         formato/dígito de verificación. Para no perder el cliente, reintentamos
         sin `vat` y dejamos el NIT en la nota. Otros errores (auth/red) se
         propagan. */
      if (values.vat) {
        const { vat, ...rest } = values;
        rest.comment = `${rest.comment ? rest.comment + ' ' : ''}NIT: ${vat}.`.slice(0, 2000);
        const out = await persist(rest);
        return { ...out, vatRejected: true };
      }
      throw err;
    }
  })();

  if (dedupKey) {
    _inflightUpserts.set(dedupKey, work);
    work.finally(() => { _inflightUpserts.delete(dedupKey); });
  }
  return work;
}

/* ── CRM: crear una oportunidad (lead) ──
   Requiere el módulo CRM instalado en Odoo. Se usa para interés entrante
   (cotización corporativa, larga estadía) ligado al partner, para que ventas le
   haga seguimiento en el embudo. Devuelve { id, isMock }. No-op mock sin
   credenciales. El llamador lo envuelve en try/catch (no fatal). */
async function createLead(data, opts) {
  opts = opts || {};
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock createLead:', data && data.subject);
    return { id: null, isMock: true };
  }
  const transport = opts.transport;
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));
  const values = { name: String(data.subject || 'Solicitud web').slice(0, 200), type: 'opportunity' };
  if (data.partnerId) values.partner_id = data.partnerId;
  if (data.contactName) values.contact_name = String(data.contactName).slice(0, 200);
  if (data.email) values.email_from = String(data.email).toLowerCase().trim().slice(0, 254);
  if (data.phone) values.phone = String(data.phone).slice(0, 50);
  if (data.description) values.description = String(data.description).slice(0, 2000);
  if (c.companyId) values.company_id = c.companyId;
  const id = await executeKw('crm.lead', 'create', [values], withCtx(), transport);
  return { id, isMock: false };
}

/* Para tests: limpiar el uid cacheado entre escenarios. */
function _resetAuthCache() { cachedUid = null; }

module.exports = {
  odooConfig, isConfigured, normalizeVat, buildPartnerValues,
  jsonRpc, authenticate, executeKw, upsertPartner, createLead, _resetAuthCache
};

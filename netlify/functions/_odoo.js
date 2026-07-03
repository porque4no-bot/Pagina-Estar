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

/* Mapea el idioma del sitio (es/en) al código de idioma instalado en Odoo.
   Odoo guarda el idioma en `res.partner.lang` con códigos `xx_YY`. Para Colombia
   usamos es_CO (la localización CO suele tenerlo activo) y en_US para inglés.
   Acepta tanto 'es'/'en' como un código completo ('es_CO') ya formado. */
function mapLang(lang) {
  const s = String(lang || '').trim();
  if (!s) return '';
  if (/^[a-z]{2}_[A-Z]{2}$/.test(s)) return s;          // ya viene como es_CO/en_US
  const base = s.slice(0, 2).toLowerCase();
  if (base === 'es') return 'es_CO';
  if (base === 'en') return 'en_US';
  return '';
}

/* Construye el texto de la nota (`comment`) enriqueciendo lo que venga del
   canal con datos de estadía cuando existan: último checkout, nº de noches,
   presupuesto y motivo de viaje. Pensado para alimentar scoring y la
   automatización post-estadía SIN crear campos x_ (eso lo hace Studio). */
function buildComment(data) {
  const parts = [];
  if (data.comment) parts.push(String(data.comment).trim());
  const stay = [];
  if (data.lastCheckout) stay.push(`Último checkout: ${String(data.lastCheckout).trim()}`);
  if (data.nights != null && String(data.nights).trim() !== '') {
    const n = parseInt(data.nights, 10);
    if (!isNaN(n) && n > 0) stay.push(`Noches: ${n}`);
  }
  if (data.budget) stay.push(`Presupuesto: ${String(data.budget).trim()}`);
  if (data.motive) stay.push(`Motivo: ${String(data.motive).trim()}`);
  if (stay.length) parts.push(stay.join('. ') + '.');
  return parts.join(' ').trim().slice(0, 2000);
}

function buildPartnerValues(data) {
  const values = {};
  if (data.name) values.name = String(data.name).slice(0, 200);
  const vat = normalizeVat(data.vat || data.nit);
  if (vat) values.vat = vat;
  if (data.email) values.email = String(data.email).toLowerCase().trim().slice(0, 254);
  if (data.phone) values.phone = String(data.phone).slice(0, 50);
  if (data.isCompany !== undefined) values.is_company = Boolean(data.isCompany);
  /* Cargo/rol del contacto → campo estándar `function` (no es Studio). */
  if (data.function || data.title) values.function = String(data.function || data.title).slice(0, 100);
  /* Idioma → campo estándar `res.partner.lang` (es_CO / en_US). */
  const lang = mapLang(data.lang);
  if (lang) values.lang = lang;
  /* Nota enriquecida con datos de estadía (estándar `comment`). */
  const comment = buildComment(data);
  if (comment) values.comment = comment;
  /* Nota: `country_id` NO se resuelve aquí (esta función es pura, sin red).
     `country_code` es de solo lectura (related de country_id); el id se resuelve
     por nombre/ISO contra res.country dentro de upsertPartner (ver resolveCountryId). */
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

/* ── res.country: resolver country_id por nombre o código ISO (cacheado) ──
   `res.partner.country_id` es many2one a res.country. El sitio nos da el país
   como nombre ("Colombia") o ISO2 ("CO"); resolvemos su id con un search y lo
   cacheamos por proceso (el catálogo de países no cambia). Devuelve null si no
   se encuentra (el partner se crea igual sin país). */
const _countryCache = new Map();
async function resolveCountryId(country, transport) {
  const raw = String(country || '').trim();
  if (!raw) return null;
  const cacheKey = raw.toLowerCase();
  if (_countryCache.has(cacheKey)) return _countryCache.get(cacheKey);
  /* ISO2 (p. ej. "CO") vs. nombre ("Colombia"): por código va contra `code`,
     por nombre va contra `name` con ilike (insensible a may/min). */
  const domain = /^[A-Za-z]{2}$/.test(raw)
    ? [['code', '=', raw.toUpperCase()]]
    : [['name', '=ilike', raw]];
  let id = null;
  try {
    const found = await executeKw('res.country', 'search', [domain], { limit: 1 }, transport);
    if (Array.isArray(found) && found.length) id = found[0];
  } catch (e) {
    if (process.env.DEBUG) console.log('[odoo] resolveCountryId falló (el partner se crea sin país):', e.message);
  }
  _countryCache.set(cacheKey, id);
  return id;
}

/* ── Campos personalizados x_estar_ de res.partner ──
   Detecta (cacheado por proceso) qué campos `x_estar_*` existen en ESTA
   instancia de Odoo, para escribirlos solo donde se crearon (prod) y no romper
   en local/instancias sin ellos. Se crearon vía Studio/API: x_estar_canal,
   x_estar_ultimo_checkout, x_estar_noches_total, x_estar_presupuesto,
   x_estar_motivo_viaje, x_estar_perfil. */
let _xFieldsCache = null;
async function knownPartnerXFields(transport) {
  if (_xFieldsCache) return _xFieldsCache;
  try {
    const rows = await executeKw('ir.model.fields', 'search_read',
      [[['model', '=', 'res.partner'], ['name', 'like', 'x_estar_']], ['name']], {}, transport);
    _xFieldsCache = new Set((rows || []).map(r => r.name));
  } catch (e) {
    _xFieldsCache = new Set();
  }
  return _xFieldsCache;
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
    /* País → country_id (estándar, many2one). Se resuelve aquí (no en
       buildPartnerValues) porque necesita un search contra res.country. No
       fatal: si no se resuelve, el partner se crea/actualiza sin país. */
    if (data.country && values.country_id === undefined) {
      try {
        const cid = await resolveCountryId(data.country, transport);
        if (cid) values.country_id = cid;
      } catch (e) {
        if (process.env.DEBUG) console.log('[odoo] country_id no resuelto (el partner se crea igual):', e.message);
      }
    }

    /* Campos x_estar_ (segmentación CRM): se escriben SOLO si existen en la
       instancia. `canal` cae al primer tag si no se pasa explícito; `perfil`
       solo se escribe si el llamador lo da (no sobrescribir uno puesto a mano).
       noches_total = noches de la última estadía (acumulación real = follow-up). */
    try {
      const xf = await knownPartnerXFields(transport);
      if (xf.size) {
        const setX = (name, val) => {
          if (xf.has(name) && val !== undefined && val !== null && String(val).trim() !== '') values[name] = val;
        };
        setX('x_estar_canal', data.canal || (Array.isArray(data.tags) && data.tags[0]) || '');
        setX('x_estar_ultimo_checkout', data.lastCheckout);
        if (data.nights != null && String(data.nights).trim() !== '') setX('x_estar_noches_total', parseInt(data.nights, 10) || 0);
        if (data.budget != null && String(data.budget).trim() !== '') setX('x_estar_presupuesto', parseFloat(String(data.budget).replace(/[^0-9.]/g, '')) || 0);
        setX('x_estar_motivo_viaje', data.motive);
        setX('x_estar_perfil', data.profile); /* solo si se provee explícito */
      }
    } catch (e) {
      if (process.env.DEBUG) console.log('[odoo] x_estar_ no escritos (el partner se crea igual):', e.message);
    }

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
  let description = data.description ? String(data.description) : '';
  /* Marcador de cotización embebido en la descripción (campo estándar, sin x_):
     deja al lead localizable por quoteId con un `ilike` cuando luego se cierre
     ganado/perdido desde el cron de cotizaciones. Token único, formato estable. */
  if (data.quoteId) description = `${description ? description + ' ' : ''}${quoteMarker(data.quoteId)}`;
  if (description) values.description = description.slice(0, 2000);
  if (c.companyId) values.company_id = c.companyId;
  const id = await executeKw('crm.lead', 'create', [values], withCtx(), transport);
  return { id, isMock: false };
}

/* ── Helpdesk (PQR): crear un ticket ──  (Fase 4)
   Requiere el módulo Helpdesk instalado en Odoo. Se usa para las solicitudes de
   servicio y cancelaciones del huésped (guest-action), para que Atención al
   cliente las gestione como PQR en su embudo. El equipo se resuelve con
   `get('HELPDESK_TEAM_ID', '3')` de _settings (default 3 = 'Atención al cliente'),
   pero el llamador puede pasar `teamId` explícito.

   Campos estándar de helpdesk.ticket: name=asunto, description, partner_email,
   partner_name, team_id, company_id (con ODOO_COMPANY_ID), partner_id si se da.
   Devuelve { id, isMock }. No-op mock sin credenciales; el llamador lo envuelve
   en try/catch (no fatal — el flujo del huésped no se rompe si Odoo falla). */
async function createHelpdeskTicket(data, opts) {
  opts = opts || {};
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock createHelpdeskTicket:', data && data.name);
    return { id: null, isMock: true };
  }
  const transport = opts.transport;
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));

  /* team_id: el id explícito (data.teamId / opts.teamId) gana; si no, se toma de
     _settings (env HELPDESK_TEAM_ID, default 3). Se admite que falle la lectura
     de _settings sin tumbar el ticket (cae al 3). */
  let teamId = parseInt(data.teamId != null ? data.teamId : opts.teamId, 10);
  if (!teamId) {
    try {
      const { get } = require('./_settings');
      teamId = parseInt(await get('HELPDESK_TEAM_ID', '3'), 10) || 3;
    } catch (e) {
      teamId = 3;
    }
  }

  const values = { name: String(data.name || 'Solicitud del huésped').slice(0, 200) };
  if (data.description) values.description = String(data.description).slice(0, 4000);
  if (data.email) values.partner_email = String(data.email).toLowerCase().trim().slice(0, 254);
  if (data.partnerName) values.partner_name = String(data.partnerName).slice(0, 200);
  if (teamId) values.team_id = teamId;
  if (data.partnerId) values.partner_id = data.partnerId;
  if (c.companyId) values.company_id = c.companyId;

  const id = await executeKw('helpdesk.ticket', 'create', [values], withCtx(), transport);
  return { id, isMock: false };
}

/* ── Email Marketing: lista + contacto con opt-in (Fase 2) ──
   Solo se llama para fuentes con consentimiento de marketing limpio (hoy: el
   Newsletter del footer, cuyo checkbox dice "Acepto recibir comunicaciones por
   correo"). El contacto general NO entra aquí salvo opt-in explícito (Ley 1581).

   Odoo: `mailing.list` es la lista; `mailing.contact` es la persona suscrita,
   ligada a la(s) lista(s) por el many2many `list_ids`. Buscamos/creamos la lista
   por nombre y luego buscamos/creamos el contacto por email, AÑADIENDO la lista
   con el comando (4,id) — sin pisar otras listas a las que ya pertenezca.

   Mailing NO es multiempresa por contacto del mismo modo que res.partner: la
   `mailing.list` sí puede llevar company_id; el `mailing.contact` no. Por eso el
   contexto de empresa se pasa a las llamadas (consistencia/permisos) pero el
   company_id solo se intenta en la lista. Devuelve
   { listId, contactId, created, isMock }. No-op mock sin credenciales; no fatal
   (el llamador lo envuelve en try/catch). */
async function findOrCreateMailingList(listName, withCtx, transport) {
  const name = String(listName || 'Newsletter').trim().slice(0, 200) || 'Newsletter';
  const found = await executeKw('mailing.list', 'search', [[['name', '=ilike', name]]], withCtx({ limit: 1 }), transport);
  if (Array.isArray(found) && found.length) return found[0];
  const c = odooConfig();
  const vals = { name };
  /* `mailing.list` admite company_id en bases multiempresa; lo asignamos para
     que la lista del hotel quede bajo su empresa cuando ODOO_COMPANY_ID está. */
  if (c.companyId) vals.company_id = c.companyId;
  try {
    return await executeKw('mailing.list', 'create', [vals], withCtx(), transport);
  } catch (e) {
    /* Si la versión/instalación de Mass Mailing no acepta company_id en la
       lista, reintenta sin él (no fatal: la lista igual sirve para opt-in). */
    if (c.companyId) {
      const { company_id, ...rest } = vals;
      return await executeKw('mailing.list', 'create', [rest], withCtx(), transport);
    }
    throw e;
  }
}

async function addToMailingList(data, opts) {
  opts = opts || {};
  const email = String(data.email || '').toLowerCase().trim();
  if (!email) throw new Error('addToMailingList requiere email');
  const listName = String(data.listName || 'Newsletter').trim().slice(0, 200) || 'Newsletter';
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock addToMailingList:', email, '→', listName);
    return { listId: null, contactId: null, created: false, isMock: true };
  }
  const transport = opts.transport;
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));

  const listId = await findOrCreateMailingList(listName, withCtx, transport);

  /* Contacto de mailing, deduplicado por email. Si existe, solo le AÑADE la
     lista (4,id) — no reemplaza otras suscripciones. Si no, lo crea ya ligado. */
  const found = await executeKw('mailing.contact', 'search', [[['email', '=ilike', email]]], withCtx({ limit: 1 }), transport);
  let contactId = (Array.isArray(found) && found.length) ? found[0] : null;
  let created = false;
  if (contactId) {
    await executeKw('mailing.contact', 'write', [[contactId], { list_ids: [[4, listId]] }], withCtx(), transport);
  } else {
    const vals = { email, list_ids: [[4, listId]] };
    const name = String(data.name || '').trim().slice(0, 200);
    if (name) vals.name = name;
    contactId = await executeKw('mailing.contact', 'create', [vals], withCtx(), transport);
    created = true;
  }
  return { listId, contactId, created, isMock: false };
}

/* ── Lead lifecycle (cierre del embudo) ──
   Marcador estable para correlacionar un lead con su cotización sin campos x_:
   se embebe en la descripción del lead y se busca con `ilike`. */
function quoteMarker(quoteId) {
  return `[cotizacion:${String(quoteId || '').trim()}]`;
}

/* Etapa "Ganado" del CRM, cacheada por proceso. Odoo marca la etapa final con
   `is_won = true`; tomamos esa (no dependemos de un nombre traducido). Devuelve
   null si no hay etapas (CRM sin instalar) → el llamador lo trata como no fatal. */
let _wonStageId;
async function getWonStageId(transport) {
  if (_wonStageId !== undefined) return _wonStageId;
  let id = null;
  try {
    const found = await executeKw('crm.stage', 'search', [[['is_won', '=', true]]], { limit: 1 }, transport);
    if (Array.isArray(found) && found.length) id = found[0];
  } catch (e) {
    if (process.env.DEBUG) console.log('[odoo] getWonStageId falló:', e.message);
  }
  _wonStageId = id;
  return id;
}

/* Motivo de pérdida (crm.lost.reason) por nombre, cacheado. Si no existe, lo
   crea (no es Studio; es un catálogo estándar del CRM). Devuelve null si el
   modelo no está disponible. */
const _lostReasonCache = new Map();
async function getLostReasonId(reason, transport) {
  const name = String(reason || 'Otro').trim().slice(0, 100) || 'Otro';
  const key = name.toLowerCase();
  if (_lostReasonCache.has(key)) return _lostReasonCache.get(key);
  let id = null;
  try {
    const found = await executeKw('crm.lost.reason', 'search', [[['name', '=ilike', name]]], { limit: 1 }, transport);
    if (Array.isArray(found) && found.length) id = found[0];
    else id = await executeKw('crm.lost.reason', 'create', [{ name }], {}, transport);
  } catch (e) {
    if (process.env.DEBUG) console.log('[odoo] getLostReasonId falló:', e.message);
  }
  _lostReasonCache.set(key, id);
  return id;
}

/* Encuentra el id del lead asociado a una cotización. Estrategia, en orden:
   1) id explícito (`opts.leadId` / `quote.leadId`),
   2) marcador embebido en la descripción del lead (quoteMarker),
   3) (fallback) la oportunidad más reciente por `email_from` = email del cliente.
   El fallback existe porque el lead público (request-quote) se crea ANTES de que
   exista la cotización, así que no lleva el quoteId; se correlaciona por correo.
   Devuelve null si no hay match. */
async function findLeadIdForQuote(quoteId, opts) {
  opts = opts || {};
  if (opts.leadId) return parseInt(opts.leadId, 10) || null;
  const qid = String(quoteId || '').trim();
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (extra) => ({ limit: 1, context: { ...(ctx || {}), ...(extra || {}) } });
  /* `active_test:false` para encontrar también leads ya archivados (perdidos),
     y reasignarlos a ganado si la cotización terminó aceptándose. */
  if (qid) {
    try {
      const found = await executeKw('crm.lead', 'search', [[['description', 'ilike', quoteMarker(qid)]]], withCtx({ active_test: false }), opts.transport);
      if (Array.isArray(found) && found.length) return found[0];
    } catch (e) {
      if (process.env.DEBUG) console.log('[odoo] findLeadIdForQuote (marcador) falló:', e.message);
    }
  }
  const email = String(opts.email || '').toLowerCase().trim();
  if (email) {
    try {
      const kw = withCtx({ active_test: false });
      kw.order = 'id desc';
      const found = await executeKw('crm.lead', 'search', [[['email_from', '=ilike', email], ['type', '=', 'opportunity']]], kw, opts.transport);
      if (Array.isArray(found) && found.length) return found[0];
    } catch (e) {
      if (process.env.DEBUG) console.log('[odoo] findLeadIdForQuote (email) falló:', e.message);
    }
  }
  return null;
}

/* Marca como GANADO el lead de una cotización aceptada: lo lleva a la etapa
   `is_won` y lo reactiva por si estaba archivado. Idempotente y no fatal.
   `quoteId` es string o un objeto cotización ({ quoteId, leadId }).
   Devuelve { id, won, isMock }. No-op mock sin credenciales. */
async function markLeadWonByQuote(quoteId, opts) {
  opts = opts || {};
  if (quoteId && typeof quoteId === 'object') {
    opts = { ...opts, leadId: opts.leadId || quoteId.leadId, email: opts.email || quoteId.email };
    quoteId = quoteId.quoteId;
  }
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock markLeadWonByQuote:', quoteId);
    return { id: null, won: false, isMock: true };
  }
  const transport = opts.transport;
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));
  const leadId = await findLeadIdForQuote(quoteId, { ...opts, transport });
  if (!leadId) return { id: null, won: false, isMock: false };
  const stageId = await getWonStageId(transport);
  const vals = { active: true };
  if (stageId) vals.stage_id = stageId;
  await executeKw('crm.lead', 'write', [[leadId], vals], withCtx(), transport);
  return { id: leadId, won: true, isMock: false };
}

/* Marca como PERDIDO el lead de una cotización cancelada/vencida: archiva
   (`active:false`) y registra el motivo (`lost_reason` / `lost_reason_id` según
   versión). Idempotente y no fatal. Devuelve { id, lost, isMock }. */
async function markLeadLost(quoteId, reason, opts) {
  opts = opts || {};
  if (quoteId && typeof quoteId === 'object') {
    opts = { ...opts, leadId: opts.leadId || quoteId.leadId, email: opts.email || quoteId.email };
    quoteId = quoteId.quoteId;
  }
  if (!isConfigured()) {
    if (process.env.DEBUG) console.log('[odoo] mock markLeadLost:', quoteId, reason);
    return { id: null, lost: false, isMock: true };
  }
  const transport = opts.transport;
  const c = odooConfig();
  const ctx = c.companyId ? { allowed_company_ids: [c.companyId] } : null;
  const withCtx = (kw) => (ctx ? { ...(kw || {}), context: ctx } : (kw || {}));
  const leadId = await findLeadIdForQuote(quoteId, { ...opts, transport });
  if (!leadId) return { id: null, lost: false, isMock: false };
  const reasonId = await getLostReasonId(reason, transport);
  /* El nombre del campo de motivo cambió entre versiones (lost_reason →
     lost_reason_id en 16+). Seteamos ambos por compatibilidad: Odoo ignora el
     que no exista en su modelo. `active:false` archiva el lead (= perdido). */
  const vals = { active: false };
  if (reasonId) { vals.lost_reason_id = reasonId; vals.lost_reason = reasonId; }
  await executeKw('crm.lead', 'write', [[leadId], vals], withCtx(), transport);
  return { id: leadId, lost: true, isMock: false };
}

/* Para tests: limpiar el uid y los catálogos cacheados entre escenarios. */
function _resetAuthCache() {
  cachedUid = null;
  _wonStageId = undefined;
  _countryCache.clear();
  _lostReasonCache.clear();
}

module.exports = {
  odooConfig, isConfigured, normalizeVat, mapLang, buildComment, buildPartnerValues,
  jsonRpc, authenticate, executeKw, resolveCountryId, upsertPartner, createLead,
  createHelpdeskTicket,
  findOrCreateMailingList, addToMailingList,
  quoteMarker, getWonStageId, getLostReasonId, findLeadIdForQuote,
  markLeadWonByQuote, markLeadLost, _resetAuthCache
};

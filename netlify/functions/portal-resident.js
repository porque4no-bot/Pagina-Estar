require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { checkRateLimit, rateLimitResponse } = require('./_rate-limit');
const { flag } = require('./_settings');
const { requirePortalSession } = require('./portal-session');
const { postOrderExtrasToFolio: _postOrderExtrasToFolio } = require('./_otasync');
const {
  createHelpdeskTicket: _createHelpdeskTicket,
  upsertPartner: _upsertPartner,
  getCartera: _getCartera,
  getInvoices: _getInvoices,
  emptyBuckets: _emptyBuckets
} = require('./_odoo');
const { sendEmail: _sendEmail, adminEmail, esc, formatCOP } = require('./_email');

/* ── Portal RESIDENTE — backend ──────────────────────────────────────────────
   Sirve al cliente RESIDENTE (estadía larga) del portal. Verifica el token de
   sesión PROPIO del portal (patrón guest-session, emitido por portal-session.js,
   purpose 'session', profile 'residente'). NUNCA expone credenciales OTASync/Odoo
   al cliente.

   GET  → estado de cuenta (cartera + facturas de Odoo, solo-lectura, mock-safe).
   POST → solicitudes del residente:
            · type 'aseo'         → aseo extra $50.000 al folio de Kunas/OTASync
                                    (patrón guest-action → postOrderExtrasToFolio,
                                    gated GUEST_SERVICE_FOLIO_ENABLED).
            · type 'mantenimiento'→ solicitud de mantenimiento (notifica al equipo).
            · type 'pqr'          → ticket de PQR en Odoo Helpdesk
                                    (createHelpdeskTicket, gated HELPDESK_ENABLED).
          Toda solicitud notifica al equipo por correo (patrón notifyOrderTeam).

   GATING: apagado por defecto vía flag('PORTAL_ENABLED'). OFF ⇒ respuesta inerte,
   no toca folio/Odoo/correo. Mock-safe: sin credenciales las fuentes devuelven
   estructuras vacías/mock y esta función jamás lanza.

   Ruta: /api/portal-resident (rewrite /api/* → /.netlify/functions/:splat).
   El folio y el helpdesk son best-effort: un fallo nunca tumba la solicitud. */

/* Precio fijo del aseo extra (COP, IVA-inclusive). FUENTE ÚNICA: el catálogo
   compartido _services-catalog.SERVICES.aseoExtra.price — así el $50.000 no
   deriva a distintos valores entre superficies (el problema histórico del
   desayuno 20/25/28k que el catálogo justamente evita). */
const { SERVICES } = require('./_services-catalog');
const ASEO_PRICE_COP = SERVICES.aseoExtra.price;
const ASEO_SERVICE_ID = 'aseo';
const ASEO_SERVICE_NAME = SERVICES.aseoExtra.es;

/* Ventana de idempotencia del cargo de aseo al folio (ms). Un reintento de red o
   un doble-click del residente dentro de esta ventana NO debe generar una segunda
   línea de $50.000 en el folio de Kunas/OTASync (postOrderExtrasToFolio no
   deduplica por sí solo). 10 min: cubre reintentos/doble-envío sin bloquear un
   segundo aseo legítimamente solicitado más tarde en el día. Constante, no mágico. */
const ASEO_IDEM_WINDOW_MS = 10 * 60 * 1000;

/* Ruteo de tipo de solicitud → acción. Puro y testeable: un tipo desconocido
   devuelve null (el handler responde 400). 'aseo' se cobra al folio;
   'mantenimiento' solo notifica al equipo; 'pqr' abre un ticket de Helpdesk. */
const REQUEST_ROUTES = {
  aseo: { action: 'folio' },
  mantenimiento: { action: 'maintenance' },
  pqr: { action: 'helpdesk' }
};

function routeRequestType(type) {
  const key = String(type || '').trim().toLowerCase();
  return REQUEST_ROUTES[key] || null;
}

/* Ítems del cargo de aseo: cantidad 1..5, precio SIEMPRE del catálogo constante
   (nunca del cliente). Devuelve el mismo shape que consume postOrderExtrasToFolio
   ({ name, unitPrice, quantity }) + subtotal para la notificación. PURO. */
function buildAseoItems(quantity) {
  const qty = Math.max(1, Math.min(5, parseInt(quantity, 10) || 1));
  return [{
    id: ASEO_SERVICE_ID,
    name: ASEO_SERVICE_NAME,
    quantity: qty,
    unitPrice: ASEO_PRICE_COP,
    subtotal: ASEO_PRICE_COP * qty
  }];
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

/* Clave idempotente del cargo de aseo. PURA. Dos modos:
   · explícita: el cliente manda un Idempotency-Key (header/body) → dedup exacta
     por intención, con scope al residente (evita colisión entre usuarios).
   · automática: hash de email+reserva+servicio+cantidad → dedup por ventana corta
     (atrapa reintentos/doble-click sin depender del cliente).
   El prefijo distingue el modo para que la ventana solo aplique al automático. */
function aseoIdemKey({ explicitKey, email, reservationId, quantity }) {
  const scope = normalizeEmail(email);
  const clean = cleanText(explicitKey, 120);
  if (clean) return `k/${shortHash(`${scope}|${clean}`)}`;
  return `a/${shortHash(`${scope}|${String(reservationId || '')}|${ASEO_SERVICE_ID}|${quantity}`)}`;
}

/* Store de idempotencia (Netlify Blobs). Mock-safe: null sin Blobs → el flujo
   sigue sin dedup (nunca lanza). Inyectable en tests vía deps.idemStore. */
function idemStore() {
  if (deps.idemStore) return deps.idemStore();
  try { return getStore({ name: 'portal-resident-idem', consistency: 'strong' }); } catch (e) { return null; }
}

/* Busca un cargo de aseo ya registrado para esta clave. Devuelve el record previo
   (para responder el MISMO eventId sin recargar el folio) o null. Best-effort:
   ante cualquier fallo devuelve null (no bloquea la solicitud). La clave explícita
   siempre es duplicado; la automática solo dentro de ASEO_IDEM_WINDOW_MS. */
async function findDuplicateAseo(key, now) {
  const store = idemStore();
  if (!store || !key) return null;
  try {
    const raw = await store.get(`aseo/${key}`);
    if (!raw) return null;
    let rec = null;
    try { rec = JSON.parse(raw); } catch (e) { return null; }
    if (!rec || !rec.eventId) return null;
    if (key.startsWith('k/')) return rec;
    return (now - (rec.postedAt || 0) < ASEO_IDEM_WINDOW_MS) ? rec : null;
  } catch (e) {
    return null;
  }
}

/* Reclama ATÓMICAMENTE el marcador idempotente del cargo de aseo (mark-before-work),
   con escritura condicional de Netlify Blobs (`onlyIfNew`), igual que _quote-lock.js /
   _discount-store. CIERRA (no solo estrecha) la carrera de dos peticiones concurrentes
   con la MISMA clave: solo UNA gana la clave y postea al folio; la otra se trata como
   duplicado y NUNCA recarga los $50.000. Devuelve:
     · { claimed: true }              → ganamos la clave, proceder a postear al folio.
     · { claimed: false, record }     → otro writer ya la tomó (duplicado concurrente);
                                         `record` es el marcador previo si se pudo leer.
     · { claimed: true, noStore: true}→ sin Blobs no hay dedup posible: fail-open (la
                                         ventana secuencial de findDuplicateAseo sigue
                                         atrapando reintectos no-concurrentes).
   Best-effort: nunca lanza. */
async function claimAseo(key, record, now) {
  const store = idemStore();
  if (!store || !key) return { claimed: true, noStore: true };
  const payload = JSON.stringify({
    eventId: record.eventId,
    bookingCode: record.bookingCode,
    total: record.total,
    folio: null,
    folioStatus: null,
    postedAt: now
  });
  let created;
  try {
    /* `onlyIfNew` resuelve { modified:false } (no lanza) si la clave ya existe;
       un store que lance ante la precondición fallida se mapea a "no reclamado". */
    const res = await store.set(`aseo/${key}`, payload, { onlyIfNew: true });
    created = !res || res.modified !== false;
  } catch (e) {
    created = false;
  }
  if (created) return { claimed: true };
  /* Perdimos la carrera: otro writer ya reclamó la clave. Lee el marcador previo
     para responder el mismo eventId; si no se puede leer, igual es duplicado. */
  let prev = null;
  try { prev = await findDuplicateAseo(key, now); } catch (e) { prev = null; }
  return { claimed: false, record: prev };
}

/* Actualiza el marcador idempotente con el resultado DEFINITIVO del folio (tras
   ganar la reclamación y postear con éxito). Sobrescribe la clave ya reclamada
   (set incondicional: somos el único writer que ganó `claimAseo`). Best-effort:
   nunca lanza. */
async function recordAseo(key, record, folio, now) {
  const store = idemStore();
  if (!store || !key) return;
  try {
    await store.set(`aseo/${key}`, JSON.stringify({
      eventId: record.eventId,
      bookingCode: record.bookingCode,
      total: record.total,
      folio: folio || null,
      folioStatus: record.folioStatus || null,
      postedAt: now
    }));
  } catch (e) { /* best-effort */ }
}

/* Libera el marcador idempotente (borra la clave). Se usa cuando el cargo al folio
   FALLA tras el mark-before-work, para que el residente pueda reintentar en vez de
   quedar bloqueado por un marcador que nunca llegó a cobrar. Best-effort. */
async function releaseAseo(key) {
  const store = idemStore();
  if (!store || !key) return;
  try { await store.delete(`aseo/${key}`); } catch (e) { /* best-effort */ }
}

function corsHeaders() {
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

function parseJsonBody(event, maxBytes = 20000) {
  const body = event.body || '';
  const size = Buffer.byteLength(body, event.isBase64Encoded ? 'base64' : 'utf8');
  if (size > maxBytes) {
    const error = new Error('Payload too large');
    error.statusCode = 413;
    throw error;
  }
  const decoded = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  try {
    return JSON.parse(decoded || '{}');
  } catch (error) {
    const invalid = new Error('Invalid JSON request body');
    invalid.statusCode = 400;
    throw invalid;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function lang(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'es';
}

/* Parseo tolerante de un mapa JSON de env; {} ante cualquier error. */
function parseJsonMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (e) {
    return {};
  }
}

/* id_reservations del folio del residente. Prioriza un claim firmado de la
   sesión (session.reservation / session.bookingCode) y cae a un mapa opcional
   de env email→id_reservations (PORTAL_RESIDENT_RESERVATION_JSON). '' si no se
   conoce — el cargo al folio se marca no-posteado en vez de adivinar. PURO. */
function resolveReservationId(session) {
  const direct = String((session && (session.reservation || session.bookingCode)) || '').trim();
  if (direct) return direct.slice(0, 80);
  const email = normalizeEmail(session && session.sub);
  if (!email) return '';
  const map = parseJsonMap(process.env.PORTAL_RESIDENT_RESERVATION_JSON);
  const mapped = map[email];
  return mapped ? String(mapped).trim().slice(0, 80) : '';
}

/* Identidad del residente desde la sesión: email (clave de partner en Odoo),
   nombre e id de reserva/folio. PURO. */
function resolveResident(session) {
  return {
    email: normalizeEmail(session && session.sub),
    name: cleanText(session && session.name, 120),
    reservationId: resolveReservationId(session),
    odooPartnerKey: session && session.odooPartnerKey,
    lang: lang(session && session.lang)
  };
}

/* Normaliza la solicitud del residente en un record server-authoritative. El
   precio del aseo NUNCA sale del cliente. PURO (no I/O). Lanza Error 400 en tipo
   inválido o falta de datos. */
function buildResidentRequest(type, body, resident) {
  const route = routeRequestType(type);
  if (!route) throw Object.assign(new Error('Tipo de solicitud no válido.'), { statusCode: 400 });

  const eventId = `RES-${Date.now()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
  const base = {
    eventId,
    type: String(type).trim().toLowerCase(),
    action: route.action,
    bookingCode: resident.reservationId,
    guestName: resident.name,
    email: resident.email,
    lang: lang(body && body.lang) || resident.lang,
    createdAt: new Date().toISOString()
  };

  if (route.action === 'folio') {
    const items = buildAseoItems(body && body.quantity);
    return {
      ...base,
      items,
      total: items.reduce((sum, it) => sum + it.subtotal, 0),
      notes: cleanText(body && body.notes, 500),
      deliveryTime: cleanText(body && body.deliveryTime, 60),
      paymentPreference: 'account'
    };
  }

  if (route.action === 'maintenance') {
    const message = cleanText(body && body.message, 1200);
    if (!message) throw Object.assign(new Error('Cuéntanos qué necesita mantenimiento.'), { statusCode: 400 });
    return {
      ...base,
      category: cleanText((body && body.category) || 'mantenimiento', 80),
      location: cleanText(body && body.location, 160),
      message,
      urgency: (body && body.urgency) === 'urgent' ? 'urgent' : 'normal'
    };
  }

  /* helpdesk (PQR) */
  const message = cleanText(body && body.message, 1200);
  if (!message) throw Object.assign(new Error('Cuéntanos tu petición, queja o reclamo.'), { statusCode: 400 });
  return {
    ...base,
    category: cleanText((body && body.category) || 'pqr', 80),
    message
  };
}

/* Correo interno al equipo (patrón notifyOrderTeam de guest-action). Best-effort:
   sendEmail no-op sin RESEND_API_KEY y nunca lanza. Solo español (correo de ops). */
async function notifyResidentTeam(record) {
  const titleByAction = {
    folio: 'Nueva solicitud de aseo extra',
    maintenance: 'Nueva solicitud de mantenimiento',
    helpdesk: 'Nueva PQR (residente)'
  };
  const title = titleByAction[record.action] || 'Nueva solicitud del residente';
  const lines = [];
  if (record.action === 'folio') {
    const cell = 'padding:6px 0;font-family:Arial,sans-serif;font-size:13px;color:#444;border-bottom:1px solid #eee;';
    const rows = (record.items || []).map(it =>
      `<tr><td style="${cell}">${esc(it.name)} × ${it.quantity}</td>` +
      `<td style="${cell}text-align:right;">${formatCOP(it.subtotal)}</td></tr>`
    ).join('');
    let folioLabel = 'Cargar a la cuenta';
    if (record.folioStatus === 'failed') folioLabel = 'Cargar a la cuenta — ⚠️ NO se pudo cargar al folio, cobrar al check-out';
    else if (record.folioStatus === 'posted') folioLabel = 'Cargar a la cuenta — ✓ cargado al folio';
    lines.push(`<table style="width:100%;max-width:480px;border-collapse:collapse;">${rows}
      <tr><td style="padding-top:8px;font-weight:bold;">Total</td>
      <td style="padding-top:8px;font-weight:bold;text-align:right;">${formatCOP(record.total)}</td></tr>
    </table>
    <p style="margin-top:12px;font-size:13px;">Forma de pago: <strong>${folioLabel}</strong></p>`);
    if (record.deliveryTime) lines.push(`<p style="margin:4px 0;font-size:13px;">Cuándo: <strong>${esc(record.deliveryTime)}</strong></p>`);
    if (record.notes) lines.push(`<p style="margin:4px 0;font-size:13px;">Notas: ${esc(record.notes)}</p>`);
  } else {
    if (record.location) lines.push(`<p style="margin:4px 0;font-size:13px;">Ubicación: <strong>${esc(record.location)}</strong></p>`);
    if (record.urgency === 'urgent') lines.push('<p style="margin:4px 0;font-size:13px;color:#B23A2E;"><strong>Marcada como urgente</strong></p>');
    lines.push(`<p style="margin:8px 0;font-size:13px;">${esc(record.message || '')}</p>`);
    if (record.action === 'helpdesk' && record.helpdeskStatus) {
      lines.push(`<p style="margin:4px 0;font-size:12px;color:#888;">Helpdesk: ${esc(record.helpdeskStatus)}</p>`);
    }
  }
  const html = `<!DOCTYPE html><html lang="es"><body style="font-family:Arial,sans-serif;color:#2C2C2C;">
    <h2 style="color:#9A6A2E;">${esc(title)}</h2>
    <p>Residente <strong>${esc(record.guestName || record.email || '')}</strong>${record.bookingCode ? ` · Reserva ${esc(record.bookingCode)}` : ''}</p>
    ${lines.join('')}
    <p style="color:#888;font-size:12px;margin-top:14px;">Solicitud ${esc(record.eventId)}</p>
  </body></html>`;
  return deps.sendEmail({
    to: adminEmail(),
    subject: `${title} — ${record.guestName || record.email || record.eventId}`,
    html
  });
}

/* Abre un ticket de PQR en Odoo Helpdesk (best-effort; mock no-op sin creds). */
async function openHelpdeskTicket(record) {
  let partnerId = null;
  if (record.email) {
    try {
      const partner = await deps.upsertPartner({
        name: record.guestName || record.email,
        email: record.email,
        tags: ['Residente'],
        comment: `Origen: portal residente. ${record.bookingCode ? `Reserva ${record.bookingCode}.` : ''}`.trim()
      });
      if (partner && partner.id) partnerId = partner.id;
    } catch (partnerErr) {
      console.error('[portal-resident] helpdesk partner upsert failed:', partnerErr.message);
    }
  }
  const desc = [
    record.bookingCode ? `Reserva: ${record.bookingCode}` : '',
    record.guestName ? `Residente: ${record.guestName}` : '',
    record.email ? `Correo: ${record.email}` : '',
    `Mensaje: ${record.message || ''}`,
    `Solicitud: ${record.eventId}`
  ].filter(Boolean).join('\n');
  const res = await deps.createHelpdeskTicket({
    name: `PQR residente — ${record.bookingCode || record.email || record.eventId}`,
    description: desc,
    email: record.email || undefined,
    partnerName: record.guestName || undefined,
    partnerId: partnerId || undefined
  });
  return { created: Boolean(res && res.id), id: res && res.id, isMock: res && res.isMock };
}

/* Estado de cuenta del residente: cartera + facturas de Odoo por claim firmado
   de partner (si existe) o email. Cada fuente se envuelve para que un fallo no
   rompa el resto. */
async function loadAccountStatement(resident) {
  const partnerKey = resident.odooPartnerKey != null
    ? resident.odooPartnerKey
    : (resident.email ? { email: resident.email } : null);
  const safe = async (factory, fallback) => {
    try { return await factory(); } catch (e) {
      console.error('[portal-resident] source failed:', e.message);
      return fallback;
    }
  };
  if (!partnerKey) {
    return {
      cartera: { partnerId: null, total: 0, buckets: deps.emptyBuckets(), documentos: [], count: 0 },
      invoices: { partnerId: null, count: 0, invoices: [] }
    };
  }
  const [cartera, invoices] = await Promise.all([
    safe(() => deps.getCartera(partnerKey), null),
    safe(() => deps.getInvoices(partnerKey), null)
  ]);
  return { cartera, invoices };
}

const defaultDeps = {
  postOrderToFolio: _postOrderExtrasToFolio,
  createHelpdeskTicket: _createHelpdeskTicket,
  upsertPartner: _upsertPartner,
  getCartera: _getCartera,
  getInvoices: _getInvoices,
  emptyBuckets: _emptyBuckets,
  sendEmail: _sendEmail
};
const deps = { ...defaultDeps };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (!['GET', 'POST'].includes(event.httpMethod)) return json(405, { error: 'Method not allowed' });

  /* GATE: apagado por defecto. Inerte, sin tocar folio/Odoo/correo. */
  if (!(await flag('PORTAL_ENABLED'))) {
    return json(200, { ok: false, enabled: false });
  }

  const limited = await checkRateLimit(event, {
    name: 'portal-resident',
    limit: 30,
    windowMs: 10 * 60 * 1000
  });
  if (!limited.ok) return rateLimitResponse(corsHeaders(), limited.retryAfter);

  /* Identidad = token de sesión propio del portal (purpose 'session'). */
  let session;
  try {
    session = requirePortalSession(event);
  } catch (e) {
    return json(e.statusCode || 401, { error: 'Sesión del portal inválida o expirada.' });
  }

  /* Este backend es exclusivo del perfil RESIDENTE. */
  if (session.profile !== 'residente') {
    return json(403, { error: 'Este portal es solo para residentes.' });
  }

  const resident = resolveResident(session);

  try {
    /* GET → estado de cuenta (solo-lectura). */
    if (event.httpMethod === 'GET') {
      const statement = await loadAccountStatement(resident);
      return json(200, {
        ok: true,
        profile: { email: resident.email, name: resident.name, reservation: resident.reservationId || null },
        ...statement
      });
    }

    /* POST → solicitud del residente. */
    const body = parseJsonBody(event, 50000);
    const record = buildResidentRequest(body.type, body, resident);

    const response = { ok: true, eventId: record.eventId, type: record.type, status: 'received' };

    /* (a) aseo extra → cargo al folio (gated GUEST_SERVICE_FOLIO_ENABLED). */
    if (record.action === 'folio') {
      response.total = record.total;

      /* IDEMPOTENCIA: un reintento de red o doble-click NO debe cargar dos veces
         los $50.000 al folio. Deduplica por Idempotency-Key del cliente o, en su
         defecto, por hash(email+reserva+servicio+cantidad) dentro de una ventana
         corta. Si ya hay un cargo reciente, responde el MISMO eventId sin recargar. */
      const now = Date.now();
      const headers = event.headers || {};
      const explicitKey = headers['idempotency-key'] || headers['Idempotency-Key'] || (body && body.idempotencyKey);
      const idemKey = aseoIdemKey({
        explicitKey,
        email: resident.email,
        reservationId: record.bookingCode,
        quantity: (record.items[0] && record.items[0].quantity) || 1
      });

      const dup = await findDuplicateAseo(idemKey, now);
      if (dup) {
        return json(200, {
          ok: true,
          eventId: dup.eventId,
          type: record.type,
          status: 'duplicate',
          duplicate: true,
          total: dup.total,
          folio: dup.folio || { posted: false, reason: 'duplicate' }
        });
      }

      /* Mark-before-work ATÓMICO: reclama la clave antes de cualquier efecto
         externo (folio o notificación). Así también se deduplican doble-clicks
         cuando el posteo a folio está apagado. */
      const claim = await claimAseo(idemKey, record, now);
      if (!claim.claimed) {
        const prev = claim.record;
        return json(200, {
          ok: true,
          eventId: (prev && prev.eventId) || record.eventId,
          type: record.type,
          status: 'duplicate',
          duplicate: true,
          total: (prev && prev.total != null) ? prev.total : record.total,
          folio: (prev && prev.folio) || { posted: false, reason: 'duplicate' }
        });
      }

      if (await flag('GUEST_SERVICE_FOLIO_ENABLED')) {
        try {
          response.folio = await deps.postOrderToFolio({
            idReservations: record.bookingCode,
            items: record.items
          });
        } catch (folioErr) {
          console.error('[portal-resident] folio posting failed:', folioErr.message);
          response.folio = { posted: false, error: folioErr.message };
        }
        record.folioStatus = (response.folio && response.folio.posted === true) ? 'posted' : 'failed';
        /* Actualiza el marcador con el resultado del folio (para que un duplicado
           posterior devuelva el mismo estado). Solo persiste el marcador definitivo
           si el cargo quedó posteado; si falló, lo liberamos para permitir reintento. */
        if (record.folioStatus === 'posted') {
          await recordAseo(idemKey, record, response.folio, now);
        } else {
          await releaseAseo(idemKey);
        }
      } else {
        response.folio = { posted: false, reason: 'disabled' };
        record.folioStatus = 'disabled';
        await recordAseo(idemKey, record, response.folio, now);
      }
    }

    /* (c) PQR → Odoo Helpdesk (gated HELPDESK_ENABLED). */
    if (record.action === 'helpdesk' && (await flag('HELPDESK_ENABLED'))) {
      try {
        response.helpdesk = await openHelpdeskTicket(record);
        record.helpdeskStatus = response.helpdesk.created ? 'created' : (response.helpdesk.isMock ? 'mock' : 'skipped');
      } catch (helpdeskErr) {
        console.error('[portal-resident] helpdesk ticket failed:', helpdeskErr.message);
        response.helpdesk = { created: false, error: helpdeskErr.message };
        record.helpdeskStatus = 'error';
      }
    }

    /* Notifica al equipo (best-effort; nunca tumba la solicitud). */
    try {
      await notifyResidentTeam(record);
    } catch (mailErr) {
      console.error('[portal-resident] team notification failed:', mailErr.message);
    }

    return json(201, response);
  } catch (error) {
    console.error('[portal-resident]', error.message);
    return json(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'No fue posible registrar la solicitud.'
    });
  }
};

/* Exportado para pruebas unitarias de la lógica pura (sin red/Blobs/Odoo) y para
   inyección de dependencias en tests de integración ligeros. */
exports._test = {
  setDeps(overrides = {}) { Object.assign(deps, overrides); },
  resetDeps() { Object.assign(deps, defaultDeps); }
};
exports.ASEO_PRICE_COP = ASEO_PRICE_COP;
exports.ASEO_IDEM_WINDOW_MS = ASEO_IDEM_WINDOW_MS;
exports.routeRequestType = routeRequestType;
exports.buildAseoItems = buildAseoItems;
exports.aseoIdemKey = aseoIdemKey;
exports.buildResidentRequest = buildResidentRequest;
exports.resolveReservationId = resolveReservationId;
exports.resolveResident = resolveResident;
exports.parseJsonMap = parseJsonMap;

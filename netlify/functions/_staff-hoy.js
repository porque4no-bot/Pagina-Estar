require('./_env');
const crypto = require('crypto');

/*
 * _staff-hoy.js — Frente "Panel Hoy para recepción" (helpers compartidos).
 *
 * El tablero Hoy (staff-today), la lista de reservas web (staff-web-bookings),
 * el visor de check-ins (staff-checkin-view) y "Reenviar confirmación"
 * (staff-resend-confirmation) cruzan los mismos datos que YA guarda el sistema:
 *   - booking-results  (`direct-<EST-código>`): lo que escribió el webhook de pago
 *     (Wompi o Mercado Pago) — proveedor, método, monto, si quedó "pago sin reserva".
 *   - payment-details  (durable, Wompi): fallback del monto/método por código.
 *   - guest-checkins   (`CHK-<ms>-<hex>`, cifrado): ¿hizo check-in? ¿revisión manual?
 *   - ops-queue        tareas abiertas: pedidos "cargar a la cuenta" sin cargar al
 *     folio y documentos por verificar.
 *
 * SOLO LECTURA (salvo el registro de auditoría `staff-audit`). Nunca llama
 * OTASync ni pasarelas. Todo es best-effort y testeable con deps inyectados
 * (`deps.getStore(name)`, `deps.unprotectRecord`, `deps.getPaymentDetails`).
 */

const WEB_REF_RE = /^EST-[A-Z0-9]{3,20}$/i;
const QUOTE_REF_RE = /^COT-/i;
const CHECKIN_ID_RE = /^CHK-\d{13}-[A-F0-9]{6}$/;
const MAX_CHECKIN_SCAN = 400;      /* tope de check-ins recientes a revisar por consulta */
const MAX_WEB_RESULTS_SCAN = 1000; /* tope de entradas booking-results a leer */
const CONCURRENCY = 16;
const DAY_MS = 86400000;

/* Tareas de la cola que representan un pedido de servicio pendiente de cobro. */
const ORDER_TASK_KINDS = new Set(['folio_post_failed', 'folio_manual_charge']);
const VERIFY_TASK_KIND = 'checkin_manual_review';

function blobStore(name, deps = {}) {
  if (deps.getStore) return deps.getStore(name);
  const { getStore } = require('@netlify/blobs');
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

function safeStore(name, deps = {}) {
  try { return blobStore(name, deps); } catch (e) { return null; }
}

/* Mismo parser que purge-guest-data: el ms va embebido en la clave
   (CHK-<ms>-…, GST-<ms>-…, o "<checkinId>/…"). null si no hay marca. */
function timestampFromKey(key) {
  const s = String(key || '');
  const m = s.match(/^[A-Z]+-(\d{13})/) || s.match(/\/(\d{13})-/);
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/* Promise.all con concurrencia acotada (no saturar Blobs). */
async function mapLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) {
      const idx = i++;
      try { await fn(list[idx], idx); } catch (e) { /* cada ítem es best-effort */ }
    }
  });
  await Promise.all(workers);
}

async function listKeys(store, opts) {
  const res = await store.list(opts);
  return ((res && res.blobs) || []).map(b => b && b.key).filter(Boolean);
}

/* ── Pagos web ─────────────────────────────────────────────────────────── */

function isWebReference(ref) { return WEB_REF_RE.test(String(ref || '').trim()); }
function isQuoteReference(ref) { return QUOTE_REF_RE.test(String(ref || '').trim()); }

/* Une la entrada de booking-results con el snapshot durable de payment-details
   en una vista operativa (sin datos de tarjeta). null si no hay ninguno. */
function paymentFromResult(entry, details) {
  if (!entry && !details) return null;
  const e = entry || {};
  const d = details || {};
  const amountCents = Number(e.amountInCents || e.amountCents || d.amountInCents) || null;
  const pending = e.reservationPending === true;
  /* Marcador resuelto a mano desde el panel (staff-resolve-web-payment): el
     reservationPending se conserva como histórico, pero ya no es una alarma. */
  const resolved = pending && Boolean(e.resolvedAt);
  return {
    provider: e.provider || d.provider || null,
    method: e.paymentMethod || d.method || null,
    amountCents,
    transactionId: e.transactionId || d.transactionId || null,
    status: pending ? (resolved ? 'resuelto' : 'pago_sin_reserva') : 'aprobado',
    reason: pending ? (e.reason || 'pending') : null,
    resolution: resolved
      ? { at: e.resolvedAt, by: e.resolvedBy || null, how: e.resolution || null }
      : null,
    paidAt: e.createdAt || d.paymentDate || d.savedAt || null,
    ratePlan: e.ratePlan || d.ratePlan || null
  };
}

/* Error que distingue "no se pudo leer" de "no existe": quien lo recibe NO debe
   concluir que no hay pago (ver staff-today `enrichment.payments`). */
function storeUnavailable(name, cause) {
  return Object.assign(new Error(`${name} unavailable`), { unavailable: true, cause });
}

/* null = no existe la entrada. LANZA (unavailable) si el store falla: un timeout
   o 5xx de Blobs no es lo mismo que "sin registro de pago". Una entrada corrupta
   (JSON inválido) sí se trata como inexistente. */
/* Si el pago quedó como "pago sin reserva" pero la reserva YA EXISTE en Kunas
   (cruce por la referencia EST- o el id), el marcador está viejo: alguien la creó
   a mano o un reintento la creó. Se muestra como "reserva creada", no en rojo,
   para que nadie la cree otra vez ni devuelva la plata. No muta el original. */
function withReservationMatch(payment, reservation) {
  if (!payment || payment.status !== 'pago_sin_reserva' || !reservation) return payment;
  const st = String(reservation.status || '').toLowerCase();
  if (st === 'canceled' || st === 'cancelled') return payment;
  return { ...payment, status: 'reserva_creada' };
}

async function readBookingResult(webCode, deps = {}) {
  if (!isWebReference(webCode)) return null;
  const store = safeStore('booking-results', deps);
  if (!store) throw storeUnavailable('booking-results');
  let raw;
  try {
    raw = await store.get(`direct-${String(webCode).trim()}`);
  } catch (e) { throw storeUnavailable('booking-results', e); }
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/* Igual que arriba para el snapshot durable payment-details. Con dep inyectado
   se usa tal cual; si no, se lee el store directo para poder distinguir el error
   (getPaymentDetails de _payment-details se lo traga y devuelve null). */
async function readPaymentDetails(code, deps = {}) {
  if (!code) return null;
  if (deps.getPaymentDetails) return (await deps.getPaymentDetails(String(code))) || null;
  let raw;
  try {
    const store = deps.getStore ? deps.getStore('payment-details') : require('./_payment-details').paymentDetailsStore();
    raw = await store.get(String(code));
  } catch (e) { throw storeUnavailable('payment-details', e); }
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/* Pago en línea de una reserva: booking-results por el código web (EST-…) y,
   si falta el monto, payment-details por el id OTASync o el código web.
   LANZA (err.unavailable) si algún store no responde — el llamador decide.
   Solo consulta reservas web/corporativas (las de OTA no pasan por nuestra
   pasarela). */
async function getWebPayment({ reference, bookingCode } = {}, deps = {}) {
  const ref = String(reference || '').trim();
  const web = isWebReference(ref);
  if (!web && !isQuoteReference(ref)) return null;
  const entry = web ? await readBookingResult(ref, deps) : null;
  let details = null;
  if (!entry || !(entry.amountInCents || entry.amountCents)) {
    details = await readPaymentDetails(bookingCode, deps);
    if (!details && web) details = await readPaymentDetails(ref, deps);
  }
  return paymentFromResult(entry, details);
}

/* Etiqueta de canal para recepción: Web (motor propio), Corporativo
   (cotización pagada) o el canal que reporta OTASync (Booking, Airbnb…). */
function channelLabel(r, payment) {
  const ref = String((r && r.reference) || '').trim();
  if (isQuoteReference(ref)) return 'Corporativo';
  if (payment || isWebReference(ref)) return 'Web';
  const ch = String((r && r.channel) || '').trim();
  return ch || 'Directo';
}

/* ── Check-ins ─────────────────────────────────────────────────────────── */

/* Resumen NO sensible de un check-in descifrado (para el tablero). */
function checkinSummary(record, fallbackId) {
  const guests = Array.isArray(record && record.guests) ? record.guests : [];
  const flagged = guests.filter(g => g && g.document && g.document.needsManualReview === true).length;
  return {
    checkinId: (record && record.checkinId) || fallbackId || null,
    createdAt: (record && record.createdAt) || null,
    manualReview: Boolean(record && record.manualReview) || flagged > 0,
    manualReviewGuests: flagged,
    guests: guests.length,
    minors: guests.filter(g => g && g.isMinor).length
  };
}

/* Busca los check-ins de un conjunto de reservas. Las claves llevan el ms de
   creación, así que solo se leen las recientes (>= sinceMs) y como mucho
   MAX_CHECKIN_SCAN. Cada sobre trae `bookingCode` en claro: solo se descifra
   lo que coincide. Devuelve Map bookingCode → [resumen…] (más reciente primero). */
async function findCheckins(bookingCodes, { sinceMs = 0, deps = {}, withRecords = false } = {}) {
  const wanted = new Set((bookingCodes || []).map(c => String(c || '').trim()).filter(Boolean));
  const byBooking = new Map();
  if (!wanted.size) return { byBooking, scanned: 0 };
  const store = safeStore('guest-checkins', deps);
  if (!store) return { byBooking, scanned: 0, unavailable: true };
  let keys;
  try { keys = await listKeys(store); } catch (e) { return { byBooking, scanned: 0, unavailable: true }; }
  keys = keys
    .map(k => ({ k, ts: timestampFromKey(k) }))
    .filter(x => x.ts !== null && x.ts >= sinceMs)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_CHECKIN_SCAN)
    .map(x => x.k);
  const unprotect = deps.unprotectRecord || require('./_guest-app').unprotectRecord;
  await mapLimit(keys, CONCURRENCY, async (key) => {
    let stored;
    try { stored = await store.get(key, { type: 'json' }); } catch (e) { return; }
    if (!stored || typeof stored !== 'object') return;
    const code = String(stored.bookingCode || '').trim();
    if (!wanted.has(code)) return;
    let record = null;
    try { record = unprotect(stored); } catch (e) { record = null; }
    const item = record
      ? checkinSummary(record, key)
      : { checkinId: key, createdAt: stored.createdAt || null, manualReview: null, guests: null, decryptError: true };
    if (withRecords && record) item.record = record;
    if (!byBooking.has(code)) byBooking.set(code, []);
    byBooking.get(code).push(item);
  });
  for (const list of byBooking.values()) {
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  return { byBooking, scanned: keys.length };
}

/* Carga UN check-in por id (descifrado). null si no existe / id inválido. */
async function loadCheckin(checkinId, deps = {}) {
  const id = String(checkinId || '').trim();
  if (!CHECKIN_ID_RE.test(id)) return null;
  const store = safeStore('guest-checkins', deps);
  if (!store) return null;
  let stored;
  try { stored = await store.get(id, { type: 'json' }); } catch (e) { return null; }
  if (!stored || typeof stored !== 'object') return null;
  const unprotect = deps.unprotectRecord || require('./_guest-app').unprotectRecord;
  const record = unprotect(stored); /* lanza si la clave no cuadra → el caller responde 500 */
  return record || null;
}

function isForeignNationality(nat) {
  const n = String(nat || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (!n) return false;
  return !['colombia', 'colombiano', 'colombiana', 'co', 'col'].includes(n);
}

function clean(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/* Proyección de un ocupante para el visor de recepción: lo que pide el registro
   (SIRE/TRA) y nada más — sin correo, teléfono, dirección ni notas. */
function occupantView(entry, index) {
  const g = (entry && entry.guest) || {};
  const doc = (entry && entry.document) || {};
  const foreign = isForeignNationality(g.nationality);
  const view = {
    index,
    isPrimary: Boolean(entry && entry.isPrimary),
    isMinor: Boolean(entry && entry.isMinor),
    firstName: clean(g.firstName, 100),
    lastName: clean(g.lastName, 100),
    documentType: clean(g.documentType, 60),
    documentNumber: clean(g.documentNumber, 80),
    nationality: clean(g.nationality, 80),
    birthDate: clean(g.birthDate, 20),
    sex: clean(g.sex, 30),
    occupation: clean(g.occupation, 120),
    residence: {
      country: clean(g.residenceCountry, 80),
      state: clean(g.residenceState, 120),
      city: clean(g.residenceCity, 120)
    },
    origin: {
      country: clean(g.originCountry, 80),
      state: clean(g.originState, 120),
      city: clean(g.originCity, 120)
    },
    destination: clean(g.destination, 160),
    foreign,
    needsManualReview: doc.needsManualReview === true,
    documentSource: clean(doc.analysisSource, 40),
    ocrAttempts: Number(doc.ocrAttempts) || 0
  };
  if (view.isMinor && entry && entry.minorDocuments) {
    const m = entry.minorDocuments;
    view.minor = {
      parentPresent: Boolean(m.parentPresent),
      fatherName: clean(m.fatherName, 160),
      motherName: clean(m.motherName, 160),
      hasRegistroCivil: Boolean(m.registroCivil),
      hasAuthorization: Boolean(m.authorization)
    };
  }
  return view;
}

function checkinView(record) {
  const r = record || {};
  const guests = Array.isArray(r.guests) ? r.guests : [];
  const res = r.reservation || {};
  return {
    checkinId: r.checkinId || null,
    bookingCode: r.bookingCode || null,
    createdAt: r.createdAt || null,
    status: r.status || null,
    manualReview: Boolean(r.manualReview) || guests.some(g => g && g.document && g.document.needsManualReview === true),
    reservation: {
      checkIn: clean(res.checkIn, 20),
      checkOut: clean(res.checkOut, 20),
      roomNumber: clean(res.roomNumber, 40),
      motive: clean(res.motive, 160)
    },
    guests: guests.map(occupantView)
  };
}

/* Documentos que EXISTEN para un check-in (las imágenes de adultos solo se
   guardan con GUEST_APP_STORE_DOCUMENTS; los del menor siempre). */
const DOC_STORES = { adult: 'guest-documents', minor: 'guest-minor-documents' };

function docKind(store, key) {
  if (store === 'minor') {
    if (/\/registro-civil/.test(key)) return 'registro-civil';
    if (/\/autorizacion/.test(key)) return 'autorizacion';
    return 'menor';
  }
  return 'documento';
}

function docGuestIndex(store, key) {
  const rest = String(key).split('/').slice(1);
  if (store === 'adult') {
    const n = parseInt(String(rest[0] || '').split('-')[0], 10);
    return Number.isFinite(n) ? n - 1 : null; /* "<n>-nombre" con n 1-based */
  }
  const n = parseInt(rest[0], 10);
  return Number.isFinite(n) ? n : null;
}

async function listCheckinDocuments(checkinId, deps = {}) {
  const id = String(checkinId || '').trim();
  if (!CHECKIN_ID_RE.test(id)) return [];
  const out = [];
  for (const [kind, name] of Object.entries(DOC_STORES)) {
    const store = safeStore(name, deps);
    if (!store) continue;
    try {
      const keys = await listKeys(store, { prefix: `${id}/` });
      keys.forEach(key => out.push({ store: kind, key, kind: docKind(kind, key), guestIndex: docGuestIndex(kind, key) }));
    } catch (e) { /* store no disponible → solo lo que se pudo listar */ }
  }
  return out;
}

/* AAD con la que guest-checkin selló cada binario (debe ser idéntica). */
function documentAad(store, key, bookingCode) {
  if (store === 'minor') {
    return /\/autorizacion/.test(key) ? `${bookingCode}|minor-authorization` : `${bookingCode}|minor-rcn`;
  }
  return `${bookingCode}|guest-document`;
}

/* ── Tareas abiertas por reserva ───────────────────────────────────────── */

function tasksByBooking(items) {
  const map = new Map();
  for (const it of (items || [])) {
    const ctx = (it && it.context) || {};
    const code = String(ctx.bookingCode || '').trim();
    if (!code) continue;
    const entry = map.get(code) || { pendingOrders: [], verifyDocument: 0, otherTasks: 0 };
    if (ORDER_TASK_KINDS.has(it.kind)) {
      entry.pendingOrders.push({
        taskId: it.id, kind: it.kind, eventId: ctx.eventId || null,
        total: Number(ctx.total) || 0, items: clean(ctx.items, 300), createdAt: it.createdAt || null
      });
    } else if (it.kind === VERIFY_TASK_KIND) {
      entry.verifyDocument += 1;
    } else {
      entry.otherTasks += 1;
    }
    map.set(code, entry);
  }
  return map;
}

/* ── Reservas web recientes (booking-results) ──────────────────────────── */

/* Lee las entradas `direct-*` de booking-results creadas en los últimos `days`.
   Netlify Blobs no tiene TTL real (el `ttl` que pasan los webhooks se ignora),
   así que se filtra por createdAt. */
async function listRecentWebResults({ days = 30, now = Date.now(), deps = {} } = {}) {
  const store = safeStore('booking-results', deps);
  if (!store) return { items: [], scanned: 0, unavailable: true };
  let keys;
  try { keys = await listKeys(store, { prefix: 'direct-' }); } catch (e) { return { items: [], scanned: 0, unavailable: true }; }
  keys = keys.slice(0, MAX_WEB_RESULTS_SCAN);
  const cutoff = now - days * DAY_MS;
  const items = [];
  let readErrors = 0;
  await mapLimit(keys, CONCURRENCY, async (key) => {
    let raw;
    try { raw = await store.get(key); } catch (e) { readErrors += 1; return; }
    if (!raw) return;
    let entry;
    try { entry = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    const ts = Date.parse((entry && entry.createdAt) || '');
    if (!Number.isFinite(ts) || ts < cutoff) return;
    items.push({ webCode: key.slice('direct-'.length), entry, ts });
  });
  items.sort((a, b) => b.ts - a.ts);
  /* partial: alguna entrada no se pudo leer — una reserva de Kunas sin cruce NO
     significa "sin registro de pago" en ese caso. */
  return { items, scanned: keys.length, partial: readErrors > 0, readErrors };
}

/* ── Auditoría de accesos del staff ────────────────────────────────────── */

/* Append-only en el store `staff-audit` (quién vio/hizo qué y cuándo). Sin PII
   del huésped: solo códigos, ids y el correo del miembro del staff. */
async function appendStaffAudit(entry, deps = {}) {
  const store = safeStore('staff-audit', deps);
  if (!store) return { ok: false, reason: 'no-store' };
  const nowMs = (deps.now || Date.now)();
  const at = new Date(nowMs).toISOString();
  const action = String((entry && entry.action) || 'unknown').replace(/[^a-z0-9._-]/gi, '_');
  const key = `${action}/${at.slice(0, 10)}/${nowMs}-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await store.set(key, JSON.stringify({ ...entry, at }));
    return { ok: true, key };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

function clientIp(event) {
  const h = (event && event.headers) || {};
  const raw = h['x-nf-client-connection-ip'] || h['client-ip'] || h['x-forwarded-for'] || '';
  return String(raw).split(',')[0].trim().slice(0, 64) || null;
}

module.exports = {
  WEB_REF_RE, CHECKIN_ID_RE, DOC_STORES, ORDER_TASK_KINDS, VERIFY_TASK_KIND, MAX_CHECKIN_SCAN, DAY_MS,
  blobStore, safeStore, timestampFromKey, mapLimit,
  isWebReference, isQuoteReference, paymentFromResult, withReservationMatch, readBookingResult, readPaymentDetails, getWebPayment, channelLabel,
  checkinSummary, findCheckins, loadCheckin, checkinView, occupantView, isForeignNationality,
  listCheckinDocuments, documentAad, docKind,
  tasksByBooking, listRecentWebResults, appendStaffAudit, clientIp
};

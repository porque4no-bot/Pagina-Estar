/* Refund tracking store + routing.
 *
 * Every guest cancellation request (web, WhatsApp bot or guest app) creates a
 * refund record here (status NEEDS_REVIEW); an admin can also open a "caso
 * especial" (KIND.SPECIAL). An admin then approves/denies from the panel and
 * refund-admin-action executes (Frente cancel), each rail behind its flag:
 *   - GATEWAY_AUTO    → Mercado Pago refund API (REFUND_GATEWAY_AUTO_ENABLED)
 *   - GATEWAY_ASSISTED→ Wompi tarjeta: sin API → tarea (dashboard / soporte)
 *   - MANUAL_BANK     → transferencia (formulario bancario cifrado + tarea)
 *
 * Design: human gate (only an admin moves a record to APPROVED), idempotency
 * (one record per bookingCode via onlyIfNew), append-only auditLog, bank
 * details encrypted at rest (_crypto-vault).
 */

const crypto = require('crypto');

const STATUS = {
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  DENIED: 'DENIED',
  APPROVED: 'APPROVED',
  NEEDS_BANK_DETAILS: 'NEEDS_BANK_DETAILS',
  BANK_DETAILS_READY: 'BANK_DETAILS_READY',
  PROCESSING: 'PROCESSING',
  PENDING_PROVIDER: 'PENDING_PROVIDER',
  DONE: 'DONE',
  FAILED: 'FAILED'
};

const ROUTE = {
  GATEWAY_AUTO: 'GATEWAY_AUTO',
  GATEWAY_ASSISTED: 'GATEWAY_ASSISTED',
  MANUAL_BANK: 'MANUAL_BANK'
};

/* Tipo de solicitud (Frente cancel):
   - CANCELLATION: el huésped cancela; el monto sale de la POLÍTICA de la tarifa
     (sugerido por policySuggestion, el admin lo confirma/ajusta) y al cerrar la
     decisión se cancela la reserva en Kunas.
   - SPECIAL: "caso especial" (cobro duplicado, compensación, overbooking…): el
     admin fija el monto libremente y decide si además se cancela la reserva. */
const KIND = {
  CANCELLATION: 'cancellation',
  SPECIAL: 'special'
};

/* Plazo máximo comunicado al huésped para tramitar un reembolso — TODOS los
   medios (hoy todo es manual). Fuente única para correos y panel admin. */
const REFUND_SLA_BUSINESS_DAYS = 15;

/* Pure routing decision. Mercado Pago is the only provider with a refund API;
   its card/account-money payments are auto-refundable. Wompi has NO refund API
   in this account, so Wompi card = assisted support ticket and the rest
   (PSE/Nequi/Bancolombia) = manual transfer. Unknown/cash/datáfono = manual. */
function refundRoute(provider, paymentMethod) {
  const p = String(provider || '').toLowerCase();
  const m = String(paymentMethod || '').toLowerCase();
  if (p === 'mercadopago') {
    /* Método DESCONOCIDO (p. ej. el pago se recuperó de la nota de Kunas, que trae
       el id pero no el método): Mercado Pago reembolsa por id de pago, así que va
       por la pasarela. Si fuera PSE/efectivo, MP rechaza el reembolso → FAILED +
       alerta, y el admin puede corregir el medio desde el panel. */
    if (!m) return ROUTE.GATEWAY_AUTO;
    if (/credit|debit|account_money|visa|master|amex|diners/.test(m)) return ROUTE.GATEWAY_AUTO;
    return ROUTE.MANUAL_BANK; // pse, ticket, efecty, etc.
  }
  if (p === 'wompi') {
    if (m === 'card' || m === 'tarjeta') return ROUTE.GATEWAY_ASSISTED; // ticket, no API
    return ROUTE.MANUAL_BANK; // nequi, pse, bancolombia_transfer
  }
  return ROUTE.MANUAL_BANK; // unknown / cash / datáfono
}

function getRefundStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: 'refunds', consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}

/* Extrae proveedor + id de transacción de la NOTA que el webhook escribe en la
   reserva de OTASync ("… Creado por Webhook mercadopago. ID Transaccion: 123").
   Último recurso cuando booking-results ya venció (7 días) y no hay
   payment-details (reservas MP anteriores a la captura durable). Puro. */
function parsePaymentFromPmsNote(note) {
  const text = String(note || '');
  const out = {};
  const prov = /Webhook\s+(mercadopago|wompi)/i.exec(text);
  if (prov) out.paymentProvider = prov[1].toLowerCase();
  const tx = /ID\s+Transacci(?:o|ó)n:\s*([A-Za-z0-9_-]{3,80})/i.exec(text);
  if (tx) out.transactionId = tx[1];
  return out;
}

/* Recupera los datos del pago original para un reembolso.
   Frente cancel: Mercado Pago guarda booking-results con la clave del CÓDIGO EST
   (direct-EST-…), pero la solicitud de cancelación llega con el id de OTASync, así
   que antes el reembolso de MP nunca encontraba su pago. Ahora se busca por el id
   de OTASync Y por el código EST (opts.reference, que es la `reference` de la
   reserva en OTASync), primero en booking-results (7 días) y luego en
   payment-details (durable ~13 meses). Como último recurso se lee el id de la
   transacción de la nota de la reserva (opts.note). Nunca lanza. */
/* ¿El registro de pago encontrado por `key` es de ESTA reserva? Por el id de
   OTASync siempre lo es. Por el código EST (reference) solo si el registro apunta
   a esta misma reserva de OTASync: Mercado Pago duplicó reservas con la misma
   reference (p. ej. 3273560 y 3273564) y un solo cobro; sin este cruce las dos
   solicitudes tomaban el mismo pago como tope. Si el registro no dice a qué
   reserva pertenece, se acepta. Devuelve { ok, otherId }. */
function paymentBelongsTo(target, key, rec) {
  if (!rec || key === target) return { ok: true };
  const ids = [];
  if (rec.otasyncId) ids.push(String(rec.otasyncId));
  if (rec.bookingCode && String(rec.bookingCode) !== String(key)) ids.push(String(rec.bookingCode));
  if (!ids.length) return { ok: true };
  if (ids.includes(String(target))) return { ok: true };
  return { ok: false, otherId: ids[0] };
}

async function recoverPaymentInfo(bookingCode, opts = {}) {
  const out = {};
  const target = String(bookingCode || '').trim();
  const keys = [];
  for (const k of [bookingCode, opts.reference]) {
    const v = String(k || '').trim();
    if (v && !keys.includes(v)) keys.push(v);
  }
  const matchedBy = [];
  /* booking-results (7-day TTL): provider / method / txId / amount. */
  try {
    const { getStore } = require('@netlify/blobs');
    const storeOpts = { name: 'booking-results', consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      storeOpts.siteID = siteID;
      storeOpts.token = token;
    }
    const store = getStore(storeOpts);
    for (const key of keys) {
      if (out.transactionId) break;
      let raw = null;
      try { raw = await store.get(`direct-${key}`); } catch (e) { raw = null; }
      if (!raw) continue;
      const r = JSON.parse(raw);
      const own = paymentBelongsTo(target, key, r);
      if (!own.ok) {
        out.paymentOtherReservation = out.paymentOtherReservation || own.otherId;
        matchedBy.push(`booking-results:${key}:otra-reserva`);
        continue;
      }
      out.paymentProvider = out.paymentProvider || r.provider || null;
      out.paymentMethod = out.paymentMethod || r.paymentMethod || null;
      out.transactionId = out.transactionId || r.transactionId || null;
      out.originalAmountCents = out.originalAmountCents || r.amountInCents || r.amountCents || null;
      out.ratePlan = out.ratePlan || r.ratePlan || null;
      matchedBy.push(`booking-results:${key}`);
    }
  } catch (e) { /* ignore — fall through to durable capture */ }
  /* payment-details (durable, ~13 mo): the fields a refund/ticket actually needs
     — auth code, payment date, card last-4 & brand — captured at payment time.
     Fills gaps left by the short-lived booking-results blob. */
  try {
    const { getPaymentDetails } = require('./_payment-details');
    for (const key of keys) {
      const d = await getPaymentDetails(key);
      if (!d) continue;
      const own = paymentBelongsTo(target, key, d);
      if (!own.ok) {
        out.paymentOtherReservation = out.paymentOtherReservation || own.otherId;
        matchedBy.push(`payment-details:${key}:otra-reserva`);
        continue;
      }
      out.paymentProvider = out.paymentProvider || d.provider || null;
      out.paymentMethod = out.paymentMethod || d.method || null;
      out.transactionId = out.transactionId || d.transactionId || null;
      out.originalAmountCents = out.originalAmountCents || d.amountInCents || null;
      out.cardBrand = out.cardBrand || d.cardBrand || null;
      out.cardLast4 = out.cardLast4 || d.cardLast4 || null;
      out.authCode = out.authCode || d.authCode || null;
      out.paymentDate = out.paymentDate || d.paymentDate || null;
      out.ratePlan = out.ratePlan || d.ratePlan || null;
      matchedBy.push(`payment-details:${key}`);
      break;
    }
  } catch (e) { /* ignore — durable capture optional */ }
  if (out.transactionId) out.transactionIdSource = 'payment';
  /* Último recurso: la nota de la reserva en OTASync (id de la transacción). La
     escribió NUESTRO webhook, así que también se considera confiable. */
  if (!out.transactionId && opts.note) {
    const fromNote = parsePaymentFromPmsNote(opts.note);
    if (fromNote.transactionId) {
      out.transactionId = fromNote.transactionId;
      out.transactionIdSource = 'pms-note';
      out.paymentProvider = out.paymentProvider || fromNote.paymentProvider || null;
      matchedBy.push('pms-note');
    }
  }
  if (out.originalAmountCents) out.originalAmountSource = 'payment';
  if (matchedBy.length) out.paymentLookup = matchedBy;
  return out;
}

function nowIso() { return new Date().toISOString(); }

/* Creates the refund record for a booking the first time it's requested.
   Idempotent by bookingCode (onlyIfNew). Returns { created, refund }.
   Never throws on a missing Blobs backend (dev) — returns { created:false }. */
async function createRefundRequest({ booking, paymentInfo, clientIp, source, reason, kind, cancelReservation, actor }) {
  const bookingCode = booking && booking.bookingCode;
  if (!bookingCode) return { created: false, refund: null };

  let store;
  try { store = getRefundStore(); } catch (e) { return { created: false, refund: null }; }

  const pay = paymentInfo || {};
  const route = refundRoute(pay.paymentProvider, pay.paymentMethod);
  const recordKind = kind === KIND.SPECIAL ? KIND.SPECIAL : KIND.CANCELLATION;
  /* Una cancelación SIEMPRE cancela la reserva en Kunas al decidir; un caso
     especial solo si el admin lo marca. */
  const shouldCancel = recordKind === KIND.CANCELLATION ? true : cancelReservation === true;
  const pmsTotalCents = booking.totalAmount ? Math.round(booking.totalAmount * 100) : null;
  const record = {
    refundId: `REF-${bookingCode}`,
    bookingCode,
    kind: recordKind,
    cancelReservation: shouldCancel,
    /* Código EST del motor (reference de la reserva en OTASync): segunda llave
       para encontrar el pago de Mercado Pago. */
    reference: booking.reference || null,
    guestName: booking.guestName || null,
    guestEmail: booking.guestEmail || null,
    lang: booking.lang === 'en' ? 'en' : 'es',
    roomName: booking.roomName || null,
    checkIn: booking.checkIn || null,
    checkOut: booking.checkOut || null,
    nights: Number.isFinite(Number(booking.nights)) && Number(booking.nights) > 0 ? Number(booking.nights) : null,
    paymentProvider: pay.paymentProvider || null,
    paymentMethod: pay.paymentMethod || null,
    transactionId: pay.transactionId || null,
    /* 'payment' | 'pms-note' (confiables) | 'admin' (digitado: sin auto-reembolso). */
    transactionIdSource: pay.transactionId ? (pay.transactionIdSource || 'payment') : null,
    /* Refund/ticket data captured at payment time (Wompi card refunds are filed
       by support ticket; these are the fields they ask for). */
    cardBrand: pay.cardBrand || null,
    cardLast4: pay.cardLast4 || null,
    authCode: pay.authCode || null,
    paymentDate: pay.paymentDate || null,
    /* Plan tarifario (flexible=100% hasta 24 h / best=Estricta 100% hasta 7 días) para
       que el panel muestre la política aplicable al fijar el monto. */
    ratePlan: pay.ratePlan || null,
    route,
    originalAmountCents: pay.originalAmountCents != null ? pay.originalAmountCents : pmsTotalCents,
    /* De dónde sale el monto pagado: 'payment' (pasarela, confiable) | 'pms_total'
       (total de la reserva en Kunas, aproximado) | 'admin' (lo ingresó el admin).
       Solo con 'payment' se pide a Mercado Pago un reembolso TOTAL sin monto. */
    originalAmountSource: pay.originalAmountCents != null ? (pay.originalAmountSource || 'payment')
      : (pmsTotalCents ? 'pms_total' : null),
    paymentLookup: Array.isArray(pay.paymentLookup) ? pay.paymentLookup : null,
    /* El pago con este código EST pertenece a OTRA reserva de OTASync (reserva
       duplicada por MP): no se usa como tope ni como medio de reembolso. */
    paymentOtherReservation: pay.paymentOtherReservation || null,
    refundAmountCents: null,
    refundReason: reason || null,
    status: STATUS.NEEDS_REVIEW,
    createdAt: nowIso(),
    createdBy: actor || source || 'web',
    source: source || 'web',
    clientIp: clientIp || 'unknown',
    auditLog: [{
      ts: nowIso(), oldStatus: null, newStatus: STATUS.NEEDS_REVIEW, actor: actor || source || 'web',
      notes: recordKind === KIND.SPECIAL ? `Caso especial creado${reason ? `: ${reason}` : ''}` : 'Solicitud de cancelación recibida'
    }]
  };

  try {
    const res = await store.set(bookingCode, JSON.stringify(record), { onlyIfNew: true });
    if (res && res.modified === false) {
      const existing = await store.get(bookingCode);
      return { created: false, refund: existing ? JSON.parse(existing) : null };
    }
    return { created: true, refund: record };
  } catch (e) {
    if (process.env.DEBUG) console.warn('[refunds-store] create failed:', e.message);
    return { created: false, refund: null };
  }
}

/* Otras solicitudes (aprobadas, en trámite o reembolsadas) que usan el mismo
   pago. Un pago se devuelve una sola vez. */
const COMMITTED_STATUSES = ['APPROVED', 'NEEDS_BANK_DETAILS', 'BANK_DETAILS_READY', 'PROCESSING', 'PENDING_PROVIDER', 'DONE'];
async function findRefundsByTransaction(transactionId, exceptBookingCode) {
  if (!transactionId) return [];
  const all = await listRefunds(null);
  return all.filter(r => r && r.transactionId && String(r.transactionId) === String(transactionId)
    && String(r.bookingCode) !== String(exceptBookingCode || '')
    && COMMITTED_STATUSES.includes(r.status));
}

async function getRefund(bookingCode) {
  const store = getRefundStore();
  const raw = await store.get(String(bookingCode));
  return raw ? JSON.parse(raw) : null;
}

async function listRefunds(statusFilter) {
  const store = getRefundStore();
  const out = [];
  const listing = await store.list();
  for (const entry of (listing.blobs || [])) {
    try {
      const raw = await store.get(entry.key);
      if (!raw) continue;
      const r = JSON.parse(raw);
      if (!statusFilter || r.status === statusFilter) out.push(r);
    } catch (e) { /* skip unreadable */ }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

/* Applies a status transition with an append-only audit entry. `patch` carries
   extra fields to merge (refundAmountCents, approvedBy, deniedReason, etc.).
   - newStatus null/undefined: escritura AUXILIAR (marca de Kunas, correos
     enviados, monto…) que NO cambia el estado: se conserva el estado ACTUAL
     leído aquí mismo, nunca uno leído al comienzo de la petición (si no, una
     escritura lenta revertía un "Reembolsado" hecho en paralelo).
   - patch puede ser una función (registroFresco) => objeto, para construir el
     cambio sobre lo que hay ahora (p. ej. agregar a guestNotices sin pisar).
   - opts.expectStatus: compare-and-set. Solo escribe si el estado actual es el
     esperado; si otro cambio se cuela entre la lectura y la escritura (etag),
     devuelve status_changed. Evita dos aprobaciones → dos reembolsos.
   Sin expectStatus, un choque de etag se reintenta sobre el registro fresco. */
async function transitionStatus(bookingCode, newStatus, actor, notes, patch, opts) {
  const store = getRefundStore();
  const key = String(bookingCode);
  const expect = opts && opts.expectStatus;
  const canCas = typeof store.getWithMetadata === 'function';
  const maxTries = expect ? 1 : 4;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    let raw;
    let etag = null;
    if (canCas) {
      const cur = await store.getWithMetadata(key, { type: 'text' });
      raw = cur ? cur.data : null;
      etag = cur ? cur.etag || null : null;
    } else {
      raw = await store.get(key);
    }
    if (!raw) return { ok: false, reason: 'not_found' };
    const refund = JSON.parse(raw);
    const oldStatus = refund.status;
    if (expect) {
      const allowed = Array.isArray(expect) ? expect : [expect];
      if (!allowed.includes(oldStatus)) return { ok: false, reason: 'status_changed', refund };
    }
    const target = newStatus == null ? oldStatus : newStatus;
    const extra = typeof patch === 'function' ? patch(refund) : patch;
    Object.assign(refund, extra || {});
    refund.status = target;
    refund.updatedAt = nowIso();
    refund.auditLog = Array.isArray(refund.auditLog) ? refund.auditLog : [];
    refund.auditLog.push({ ts: nowIso(), oldStatus, newStatus: target, actor: actor || 'system', notes: notes || '' });
    /* Frente cancel: registros viejos con datos bancarios EN CLARO se cifran en la
       siguiente escritura (migración perezosa). Sin clave, se dejan como están. */
    migrateLegacyBankDetails(refund);
    if (etag) {
      const res = await store.set(key, JSON.stringify(refund), { onlyIfMatch: etag });
      if (res && res.modified === false) {
        if (expect) return { ok: false, reason: 'status_changed' };
        continue; /* alguien escribió en medio: reintentar sobre lo fresco */
      }
    } else {
      await store.set(key, JSON.stringify(refund));
    }
    return { ok: true, refund };
  }
  return { ok: false, reason: 'conflict' };
}

/* ── A9: bank-details capture for manual refunds ───────────────────────────
   Signed link (HMAC) so a guest can submit the account to receive a manual
   refund. PII (Frente cancel): los datos bancarios (cuenta / documento) se
   guardan CIFRADOS con _crypto-vault (AES-256-GCM, AAD = `refund-bank|<código>`
   para que el sobre no pueda moverse a otro reembolso). En el registro solo queda
   en claro un RESUMEN enmascarado (banco, tipo, últimos 4). Se descifran
   únicamente para quien tiene el permiso refunds.mark_done (get-pending-refunds).
   Nunca van a logs y el enlace público es un token firmado no enumerable. */
function bankAad(bookingCode) { return `refund-bank|${String(bookingCode || '')}`; }

function maskTail(value, keep = 4) {
  const v = String(value || '');
  if (!v) return '';
  return v.length <= keep ? v : `••••${v.slice(-keep)}`;
}

/* Resumen NO sensible que el panel puede mostrar a cualquiera con refunds.view. */
function bankDetailsSummary(details) {
  const d = details || {};
  return {
    bankName: d.bankName || '',
    accountType: d.accountType || '',
    accountLast4: String(d.accountNumber || '').slice(-4),
    docType: d.docType || '',
    submittedAt: d.submittedAt || null
  };
}

/* Copia enmascarada (para correos internos): números con solo los últimos 4. */
function maskBankDetails(details) {
  const d = details || {};
  return { ...d, accountNumber: maskTail(d.accountNumber), docNumber: maskTail(d.docNumber, 3) };
}

/* Guardar en claro solo es aceptable en desarrollo local (sin clave). */
function plainBankStorageAllowed() {
  return process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production';
}

/* Devuelve los campos a persistir para unos datos bancarios: sobre cifrado +
   resumen. Sin clave en producción FALLA CERRADO (no se guardan en claro). */
function sealBankDetailsFields(bookingCode, details) {
  const vault = require('./_crypto-vault');
  const summary = bankDetailsSummary(details);
  if (vault.isConfigured()) {
    return {
      bankDetailsSealed: vault.sealJSON(details, bankAad(bookingCode)),
      bankDetailsSummary: summary,
      bankDetailsEncrypted: true
    };
  }
  if (plainBankStorageAllowed()) {
    return { bankDetails: details, bankDetailsSummary: summary, bankDetailsEncrypted: false };
  }
  const error = new Error('GUEST_APP_DATA_ENCRYPTION_KEY is not configured (bank details)');
  error.statusCode = 503;
  throw error;
}

/* Inverso: datos bancarios completos del registro (sobre cifrado o legado en
   claro). null si no hay o si no se pueden descifrar. Nunca lanza. */
function openBankDetails(refund) {
  if (!refund) return null;
  if (refund.bankDetailsSealed) {
    try {
      return require('./_crypto-vault').openJSON(refund.bankDetailsSealed, bankAad(refund.bookingCode));
    } catch (e) {
      console.error('[refunds-store] bank details could not be decrypted for', refund.bookingCode);
      return null;
    }
  }
  return refund.bankDetails || null;
}

/* Cifra in situ un registro legado con bankDetails en claro (si hay clave). */
function migrateLegacyBankDetails(refund) {
  if (!refund || !refund.bankDetails || refund.bankDetailsSealed) return refund;
  try {
    const vault = require('./_crypto-vault');
    if (!vault.isConfigured()) return refund;
    refund.bankDetailsSealed = vault.sealJSON(refund.bankDetails, bankAad(refund.bookingCode));
    refund.bankDetailsSummary = bankDetailsSummary(refund.bankDetails);
    refund.bankDetailsEncrypted = true;
    delete refund.bankDetails;
  } catch (e) { /* si falla, se deja como estaba (se reintenta en la próxima escritura) */ }
  return refund;
}

/* Vista del registro para el panel / respuestas HTTP. NUNCA expone el sobre
   cifrado. Los datos bancarios completos solo con canSeeBank (refunds.mark_done);
   el resto ve el resumen enmascarado. */
function redactRefund(refund, { canSeeBank = false } = {}) {
  if (!refund) return refund;
  const out = { ...refund };
  const full = (canSeeBank && (refund.bankDetailsSealed || refund.bankDetails)) ? openBankDetails(refund) : null;
  delete out.bankDetailsSealed;
  delete out.bankDetails;
  if (!out.bankDetailsSummary && refund.bankDetails) out.bankDetailsSummary = bankDetailsSummary(refund.bankDetails);
  if (full) out.bankDetails = full;
  out.bankDetailsVisible = !!full;
  return out;
}
function bankFormTokenSecret() {
  const configured = process.env.REFUND_LINK_SECRET || process.env.GUEST_APP_TOKEN_SECRET || '';
  if (configured) return configured;
  if (process.env.NETLIFY !== 'true' && process.env.NODE_ENV !== 'production') return 'estar-refund-bank-local-dev-secret';
  const error = new Error('REFUND_LINK_SECRET is not configured');
  error.statusCode = 503;
  throw error;
}

function signBankDetailsToken(bookingCode, ttlSeconds = 7 * 24 * 60 * 60) {
  const payload = { sub: bookingCode, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', bankFormTokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyBankDetailsToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let expected;
  try { expected = crypto.createHmac('sha256', bankFormTokenSecret()).update(encoded).digest('base64url'); }
  catch (e) { return null; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!p.sub || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch (e) { return null; }
}

function sanitizeBankDetails(input) {
  input = input || {};
  const clean = (v, max) => String(v == null ? '' : v).replace(/[<>\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  const accountType = ['ahorros', 'corriente'].includes(String(input.accountType)) ? String(input.accountType) : '';
  const docType = ['CC', 'CE', 'NIT', 'PAS'].includes(String(input.docType)) ? String(input.docType) : '';
  const accountNumber = String(input.accountNumber || '').replace(/\D/g, '').slice(0, 30);
  const docNumber = String(input.docNumber || '').replace(/[^0-9A-Za-z-]/g, '').slice(0, 30);
  const bankName = clean(input.bankName, 60);
  const holderName = clean(input.holderName, 100);
  const valid = !!(bankName && accountType && accountNumber && holderName && docType && docNumber);
  return { valid, details: { bankName, accountType, accountNumber, holderName, docType, docNumber } };
}

/* Stores the guest's bank details and moves the refund to BANK_DETAILS_READY.
   Requires the record to be a MANUAL_BANK refund currently awaiting details. */
async function saveBankDetails(bookingCode, details, actor) {
  let refund;
  try { refund = await getRefund(bookingCode); } catch (e) { return { ok: false, reason: 'store_unavailable' }; }
  if (!refund) return { ok: false, reason: 'not_found' };
  if (refund.route !== ROUTE.MANUAL_BANK) return { ok: false, reason: 'not_manual_bank' };
  if (refund.status === STATUS.BANK_DETAILS_READY) return { ok: false, reason: 'already' };
  if (refund.status !== STATUS.NEEDS_BANK_DETAILS) return { ok: false, reason: 'wrong_status' };
  /* Cifrado ANTES de construir el patch: el texto en claro nunca llega al store. */
  const fields = sealBankDetailsFields(bookingCode, { ...details, submittedAt: nowIso() });
  return transitionStatus(bookingCode, STATUS.BANK_DETAILS_READY, actor || 'guest', 'Datos bancarios recibidos del huésped (cifrados)', fields);
}

/* ── Frente cancel: monto sugerido por la POLÍTICA de la tarifa ─────────────
   cancelacion.html: Estricta (ratePlan 'best') 100% hasta 7 días antes del
   check-in · Flexible 100% hasta 24 h antes · fuera de plazo se cobra la 1ª noche
   + 3,5% del total (costos de procesamiento) y se reembolsa el resto · no-show
   (24 h después de la hora de check-in sin cancelar) = sin reembolso.
   El check-in es a las 3:00 p. m. hora Colombia (UTC-5) = 20:00 UTC.
   Es una SUGERENCIA: el admin la confirma o ajusta (la decisión es humana). El
   pago web NO incluye el IVA (se cobra en el hotel), por eso la 1ª noche se toma
   del valor efectivamente pagado. Puro (sin red). */
const CHECKIN_HOUR_UTC = 20;
const PROCESSING_FEE_RATE = 0.035;
const POLICY_LIMIT_HOURS = { flexible: 24, strict: 7 * 24 };

function checkInMoment(checkIn) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(checkIn || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), CHECKIN_HOUR_UTC, 0, 0);
}

function normalizePlan(ratePlan) {
  const p = String(ratePlan || '').toLowerCase();
  if (p === 'flexible') return 'flexible';
  if (p === 'best' || p === 'estricta' || p === 'strict') return 'strict';
  return null;
}

/* Redondea centavos a pesos enteros hacia abajo (nunca sugerir de más). */
function floorPesos(cents) { return Math.max(0, Math.floor(cents / 100) * 100); }

function lateRefund(paidCents, nights) {
  const n = Math.max(1, parseInt(nights, 10) || 1);
  const firstNight = Math.round(paidCents / n);
  const fee = Math.round(paidCents * PROCESSING_FEE_RATE);
  return { amountCents: floorPesos(paidCents - firstNight - fee), firstNightCents: firstNight, feeCents: fee };
}

function policySuggestion({ ratePlan, checkIn, nights, requestedAt, originalAmountCents, originalAmountSource }, nowMs) {
  const paid = parseInt(originalAmountCents, 10);
  if (!Number.isFinite(paid) || paid <= 0) {
    return { amountCents: null, rule: 'unknown_amount', text: 'Falta el monto pagado: ingrésalo para calcular la política.' };
  }
  /* El total de la reserva en Kunas no es un pago recibido por la web (puede ser
     de una OTA, pagarse en el hotel o incluir el IVA que no se cobró en línea):
     no se sugiere ningún monto. */
  if (originalAmountSource === 'pms_total') {
    return {
      amountCents: null, rule: 'unverified_amount',
      text: 'No hay pago web registrado para esta reserva: el valor mostrado es el total de Kunas. Verifica cuánto pagó el huésped y por qué canal (si fue por una OTA, la devolución la hace la OTA).'
    };
  }
  const ci = checkInMoment(checkIn);
  if (ci == null) {
    return { amountCents: null, rule: 'unknown_dates', text: 'Sin fecha de check-in: no se puede aplicar la política automáticamente.' };
  }
  const reqMs = Date.parse(requestedAt || '') || (nowMs != null ? nowMs : Date.now());
  const hoursBefore = Math.round(((ci - reqMs) / 3.6e6) * 10) / 10;
  if (hoursBefore <= -24) {
    return { amountCents: 0, rule: 'no_show', hoursBefore, text: 'No-show: pasaron más de 24 h desde la hora de check-in sin cancelar. No aplica reembolso.' };
  }
  const plan = normalizePlan(ratePlan);
  const late = lateRefund(paid, nights);
  if (!plan) {
    /* Plan desconocido (p. ej. pagos de Mercado Pago, que no lo registran): se
       muestran ambas lecturas para que el admin elija con la nota de Kunas. */
    const asStrict = hoursBefore >= POLICY_LIMIT_HOURS.strict ? paid : late.amountCents;
    const asFlexible = hoursBefore >= POLICY_LIMIT_HOURS.flexible ? paid : late.amountCents;
    return {
      amountCents: null, rule: 'unknown_plan', hoursBefore,
      alternatives: { strict: asStrict, flexible: asFlexible },
      text: 'Plan tarifario desconocido: revisa la nota de la reserva en Kunas y elige.'
    };
  }
  const limit = POLICY_LIMIT_HOURS[plan];
  const planLabel = plan === 'flexible' ? 'Flexible (100% hasta 24 h antes)' : 'Estricta (100% hasta 7 días antes)';
  if (hoursBefore >= limit) {
    return { amountCents: paid, rule: 'full', plan, hoursBefore, text: `${planLabel}: canceló a tiempo → reembolso del 100%.` };
  }
  return {
    amountCents: late.amountCents, rule: 'late', plan, hoursBefore,
    firstNightCents: late.firstNightCents, feeCents: late.feeCents,
    text: `${planLabel}: canceló fuera de plazo → se retiene la 1ª noche + 3,5% del total y se reembolsa el resto.`
  };
}

module.exports = {
  STATUS, ROUTE, KIND, REFUND_SLA_BUSINESS_DAYS, refundRoute,
  getRefundStore, recoverPaymentInfo, parsePaymentFromPmsNote,
  createRefundRequest, getRefund, listRefunds, transitionStatus,
  policySuggestion, checkInMoment, paymentBelongsTo, findRefundsByTransaction,
  bankDetailsSummary, maskBankDetails, sealBankDetailsFields, openBankDetails, redactRefund, migrateLegacyBankDetails,
  signBankDetailsToken, verifyBankDetailsToken, sanitizeBankDetails, saveBankDetails, bankFormTokenSecret
};

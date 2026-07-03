/* Refund tracking store + routing (Fase 1 — captura + gate, SIN mover dinero).
 *
 * Every guest cancellation request creates a refund record here (status
 * NEEDS_REVIEW). An admin then approves/denies and sets the amount from the
 * panel; nothing moves money in this phase. Later phases execute:
 *   - GATEWAY_AUTO    → Mercado Pago refund API (única pasarela con API)
 *   - GATEWAY_ASSISTED→ Wompi tarjeta: ticket a soporte (Wompi no tiene API)
 *   - MANUAL_BANK     → transferencia (formulario bancario + CSV del banco)
 *
 * Design: human gate (only an admin moves a record to APPROVED), idempotency
 * (one record per bookingCode via onlyIfNew), append-only auditLog.
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

/* Best-effort recovery of the original payment from the direct-booking result
   blob. The blob is keyed by the client code (direct-<EST-code>); when the
   caller only has the OTASync id this returns {} and the record falls back to
   MANUAL_BANK with method unknown (the admin sets it in the panel). */
async function recoverPaymentInfo(bookingCode) {
  const out = {};
  /* booking-results (7-day TTL): provider / method / txId / amount. */
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: 'booking-results', consistency: 'strong' };
    const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
    if (siteID && token) {
      opts.siteID = siteID;
      opts.token = token;
    }
    const raw = await getStore(opts).get(`direct-${bookingCode}`);
    if (raw) {
      const r = JSON.parse(raw);
      out.paymentProvider = r.provider || null;
      out.paymentMethod = r.paymentMethod || null;
      out.transactionId = r.transactionId || null;
      out.originalAmountCents = r.amountInCents || null;
      out.ratePlan = r.ratePlan || null;
    }
  } catch (e) { /* ignore — fall through to durable capture */ }
  /* payment-details (durable, ~13 mo): the fields a refund/ticket actually needs
     — auth code, payment date, card last-4 & brand — captured at payment time.
     Fills gaps left by the short-lived booking-results blob. */
  try {
    const { getPaymentDetails } = require('./_payment-details');
    const d = await getPaymentDetails(bookingCode);
    if (d) {
      out.paymentProvider = out.paymentProvider || d.provider || null;
      out.paymentMethod = out.paymentMethod || d.method || null;
      out.transactionId = out.transactionId || d.transactionId || null;
      out.originalAmountCents = out.originalAmountCents || d.amountInCents || null;
      out.cardBrand = d.cardBrand || null;
      out.cardLast4 = d.cardLast4 || null;
      out.authCode = d.authCode || null;
      out.paymentDate = d.paymentDate || null;
      out.ratePlan = out.ratePlan || d.ratePlan || null;
    }
  } catch (e) { /* ignore — durable capture optional */ }
  return out;
}

function nowIso() { return new Date().toISOString(); }

/* Creates the refund record for a booking the first time it's requested.
   Idempotent by bookingCode (onlyIfNew). Returns { created, refund }.
   Never throws on a missing Blobs backend (dev) — returns { created:false }. */
async function createRefundRequest({ booking, paymentInfo, clientIp, source, reason }) {
  const bookingCode = booking && booking.bookingCode;
  if (!bookingCode) return { created: false, refund: null };

  let store;
  try { store = getRefundStore(); } catch (e) { return { created: false, refund: null }; }

  const pay = paymentInfo || {};
  const route = refundRoute(pay.paymentProvider, pay.paymentMethod);
  const record = {
    refundId: `REF-${bookingCode}`,
    bookingCode,
    guestName: booking.guestName || null,
    guestEmail: booking.guestEmail || null,
    roomName: booking.roomName || null,
    checkIn: booking.checkIn || null,
    checkOut: booking.checkOut || null,
    paymentProvider: pay.paymentProvider || null,
    paymentMethod: pay.paymentMethod || null,
    transactionId: pay.transactionId || null,
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
    originalAmountCents: pay.originalAmountCents != null ? pay.originalAmountCents
      : (booking.totalAmount ? Math.round(booking.totalAmount * 100) : null),
    refundAmountCents: null,
    refundReason: reason || null,
    status: STATUS.NEEDS_REVIEW,
    createdAt: nowIso(),
    createdBy: source || 'web',
    clientIp: clientIp || 'unknown',
    auditLog: [{ ts: nowIso(), oldStatus: null, newStatus: STATUS.NEEDS_REVIEW, actor: source || 'web', notes: 'Solicitud de cancelación recibida' }]
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
   extra fields to merge (refundAmountCents, approvedBy, deniedReason, etc.). */
async function transitionStatus(bookingCode, newStatus, actor, notes, patch) {
  const store = getRefundStore();
  const raw = await store.get(String(bookingCode));
  if (!raw) return { ok: false, reason: 'not_found' };
  const refund = JSON.parse(raw);
  const oldStatus = refund.status;
  Object.assign(refund, patch || {});
  refund.status = newStatus;
  refund.updatedAt = nowIso();
  refund.auditLog = Array.isArray(refund.auditLog) ? refund.auditLog : [];
  refund.auditLog.push({ ts: nowIso(), oldStatus, newStatus, actor: actor || 'system', notes: notes || '' });
  await store.set(String(bookingCode), JSON.stringify(refund));
  return { ok: true, refund };
}

/* ── A9: bank-details capture for manual refunds ───────────────────────────
   Signed link (HMAC) so a guest can submit the account to receive a manual
   refund. PII NOTE: bankDetails (account/doc numbers) are stored in the refund
   record in the `refunds` Blobs store, which is NOT encrypted at rest (the admin
   needs to read them to wire the transfer). They never appear in logs and the
   public link is a non-enumerable signed token. */
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
  return transitionStatus(bookingCode, STATUS.BANK_DETAILS_READY, actor || 'guest', 'Datos bancarios recibidos del huésped', { bankDetails: { ...details, submittedAt: nowIso() } });
}

module.exports = {
  STATUS, ROUTE, REFUND_SLA_BUSINESS_DAYS, refundRoute,
  getRefundStore, recoverPaymentInfo,
  createRefundRequest, getRefund, listRefunds, transitionStatus,
  signBankDetailsToken, verifyBankDetailsToken, sanitizeBankDetails, saveBankDetails, bankFormTokenSecret
};

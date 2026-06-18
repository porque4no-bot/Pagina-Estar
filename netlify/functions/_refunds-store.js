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
  if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
    opts.token = process.env.BLOBS_TOKEN;
    opts.siteID = process.env.NETLIFY_SITE_ID;
  }
  return getStore(opts);
}

/* Best-effort recovery of the original payment from the direct-booking result
   blob. The blob is keyed by the client code (direct-<EST-code>); when the
   caller only has the OTASync id this returns {} and the record falls back to
   MANUAL_BANK with method unknown (the admin sets it in the panel). */
async function recoverPaymentInfo(bookingCode) {
  try {
    const { getStore } = require('@netlify/blobs');
    const opts = { name: 'booking-results', consistency: 'strong' };
    if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
      opts.token = process.env.BLOBS_TOKEN;
      opts.siteID = process.env.NETLIFY_SITE_ID;
    }
    const store = getStore(opts);
    const raw = await store.get(`direct-${bookingCode}`);
    if (!raw) return {};
    const r = JSON.parse(raw);
    return {
      paymentProvider: r.provider || null,
      paymentMethod: r.paymentMethod || null,
      transactionId: r.transactionId || null,
      originalAmountCents: r.amountInCents || null
    };
  } catch (e) {
    return {};
  }
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

module.exports = {
  STATUS, ROUTE, refundRoute,
  getRefundStore, recoverPaymentInfo,
  createRefundRequest, getRefund, listRefunds, transitionStatus
};

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const {
  getQuoteStore, loadQuote, saveQuote, effectiveStatus, computeQuoteTotal
} = require('./_quotes-store');
const {
  hasOtasyncCreds, getAvailabilityByType, findUnavailable,
  releaseHold, createConfirmedReservation, insertReservation
} = require('./_otasync');
const { sendEmail, adminEmail, paymentConfirmationHtml } = require('./_email');
const { acquireQuoteLock, releaseQuoteLock } = require('./_quote-lock');
const { trackPurchase } = require('./_analytics');

/* Ruta DIRECTA de Mercado Pago resiliente (igual que Wompi): lock single-writer
   por reserva + idempotencia POR ESTADÍA + insertReservation (reintentos/backoff/
   alerta) + mark-before-work + recordPending SIEMPRE ante fallo de inserción.

   Producción oct-2026: hoy TODOS los pagos web entran por Mercado Pago, y con la
   ruta resiliente apagada las re-entregas del webhook crearon reservas duplicadas
   días/semanas después. Por eso pasa a ser el DEFAULT: sin definir ⇒ ENCENDIDA;
   solo un 'false' explícito (Netlify o panel /admin) la apaga. Se lee vía
   _settings.get para que el toggle del panel funcione (antes se leía solo
   process.env y el panel se ignoraba). */
async function mpDirectResilient(deps = {}) {
  try {
    const get = deps.settingsGet || require('./_settings').get;
    return String(await get('MP_DIRECT_RESILIENT_ENABLED', 'true')).toLowerCase() !== 'false';
  } catch (e) {
    return true;
  }
}
/* Expiry por EDAD del registro de idempotencia por estadía (Blobs no tiene TTL en
   get). Igual que Wompi (7 días) para un SEGUNDO pago (otro tx) de la misma
   estadía. La re-entrega del MISMO tx es duplicado sin importar la edad. */
const STAY_IDEM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/* Las alertas de dinero se deduplican por incidente (tx) durante una semana: una
   re-entrega del mismo aviso no vuelve a mandar correo ni a abrir otra tarea. */
const MONEY_ALERT_TTL_SEC = 7 * 24 * 3600;

const QUOTE_ID_RE = /^COT-\d{4}-[A-Z0-9]{5}$/;
const DIRECT_REF_RE = /^MPDIR-[A-Za-z0-9_-]+$/;
const CURRENCY = 'COP';

/* Netlify Blobs: el store se crea en el MOMENTO de usarlo (no al cargar el
   módulo) y con credenciales explícitas cuando existen. Antes 'processed-
   transactions' se creaba al cargar el módulo; si el contexto de Blobs aún no
   estaba disponible, quedaba en null para siempre en esa instancia y la
   deduplicación por tx caía a la memoria (una re-entrega días después, en otra
   instancia, creaba otra reserva). */
function blobStore(name) {
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token = token;
  }
  return getStore(opts);
}
function tryStore(name, deps = {}) {
  try { return (deps.getStore || blobStore)(name); } catch (e) { return null; }
}

const processedTransactionIds = new Set();
function rememberProcessed(id) {
  if (processedTransactionIds.size >= 500) {
    processedTransactionIds.delete(processedTransactionIds.values().next().value);
  }
  processedTransactionIds.add(id);
}

function normalizeStatus(provider, status) {
  const s = String(status || '').toLowerCase();
  if (provider === 'mercadopago') {
    if (s === 'approved') return 'approved';
    if (s === 'pending' || s === 'in_process' || s === 'authorized') return 'pending';
    if (s === 'rejected' || s === 'cancelled') return 'rejected';
    return 'failed';
  }
  if (s === 'approved') return 'approved';
  if (s === 'pending') return 'pending';
  if (s === 'declined' || s === 'voided') return 'rejected';
  return 'failed';
}

function normalizeTransaction(provider, raw) {
  if (provider === 'mercadopago') {
    const status = normalizeStatus(provider, raw.status);
    const amount = Number(raw.transaction_amount || raw.total_paid_amount || 0);
    const card = raw.card || {};
    return {
      id: String(raw.id || ''),
      provider,
      status,
      rawStatus: raw.status,
      reference: String(raw.external_reference || ''),
      amountCents: Math.round(amount * 100),
      amount: amount,
      currency: raw.currency_id || CURRENCY,
      paymentMethod: raw.payment_method_id || raw.payment_type_id || 'mercadopago',
      /* Campos que un reembolso necesita (snapshot en _payment-details). */
      paymentType: raw.payment_type_id || null,
      cardBrand: (card.last_four_digits && raw.payment_method_id) ? raw.payment_method_id : null,
      cardLast4: card.last_four_digits || null,
      authorizationCode: raw.authorization_code || null,
      installments: raw.installments != null ? Number(raw.installments) : null,
      paymentDate: raw.date_approved || raw.date_created || null,
      approved: status === 'approved'
    };
  }
  return {
    id: String(raw.id || ''),
    provider,
    status: normalizeStatus(provider, raw.status),
    rawStatus: raw.status,
    reference: String(raw.reference || ''),
    amountCents: Number(raw.amount_in_cents || 0),
    amount: Number(raw.amount_in_cents || 0) / 100,
    currency: raw.currency || CURRENCY,
    paymentMethod: raw.payment_method_type || 'card',
    approved: String(raw.status || '').toUpperCase() === 'APPROVED'
  };
}

/* Deduplicación por transacción. Durable: Netlify Blobs no aplica TTL, así que
   la marca persiste (una re-entrega semanas después sigue siendo duplicado). */
async function alreadyProcessed(transactionId, deps = {}) {
  if (!transactionId) return false;
  if (processedTransactionIds.has(transactionId)) return true;
  const store = tryStore('processed-transactions', deps);
  if (!store) return false;
  try {
    return !!(await store.get(String(transactionId)));
  } catch (e) {
    return false;
  }
}

async function markProcessed(transactionId, deps = {}) {
  if (!transactionId) return;
  rememberProcessed(transactionId);
  const store = tryStore('processed-transactions', deps);
  if (store) {
    try { await store.set(String(transactionId), '1'); } catch (e) { /* non-fatal */ }
  }
}

function toUrlSafeBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromUrlSafeBase64(str) {
  let base64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function cleanPart(value, max) {
  return String(value || '').replace(/\|/g, ' ').trim().slice(0, max || 200);
}

/* Referencia MPDIR-: la arma el SERVIDOR (create-mercadopago-preference) tras
   verificar el precio, y viaja como external_reference de la preferencia (el
   pagador no la puede alterar). Posición 14 (opcional, nueva): plan tarifario
   'F' (Flexible) / 'B' (Estricta). Las referencias viejas tienen 14 partes y
   siguen decodificando igual. */
function createDirectReference(payload) {
  const parts = [
    '2',
    cleanPart(payload.checkin, 10),
    cleanPart(payload.checkout, 10),
    Math.max(1, parseInt(payload.guestsCount, 10) || 1),
    cleanPart(payload.roomTypeId, 20),
    cleanPart(payload.firstName, 80),
    cleanPart(payload.lastName, 80),
    cleanPart(payload.email, 254),
    cleanPart(payload.phone, 50),
    cleanPart(payload.extrasMask, 20),
    cleanPart(payload.bookingCode, 40),
    payload.isColombian ? '1' : '0',
    payload.isBusiness ? '1' : '0',
    Math.max(0, parseInt(payload.amountCents, 10) || 0)
  ];
  const plan = String(payload.ratePlan || '').toLowerCase();
  if (plan === 'flexible' || plan === 'f') parts.push('F');
  else if (plan === 'best' || plan === 'b' || plan === 'estricta') parts.push('B');
  return `MPDIR-${toUrlSafeBase64(parts.join('|'))}`;
}

function decodeDirectReference(ref) {
  if (!DIRECT_REF_RE.test(String(ref || ''))) return null;
  try {
    const decoded = fromUrlSafeBase64(String(ref).slice('MPDIR-'.length));
    const parts = decoded.split('|');
    if (parts[0] !== '2' || parts.length < 14) return null;
    const out = {
      checkin: parts[1],
      checkout: parts[2],
      guestsCount: parseInt(parts[3], 10) || 1,
      roomTypeId: parts[4],
      firstName: parts[5],
      lastName: parts[6],
      email: parts[7],
      phone: parts[8],
      extrasMask: parts[9] || '',
      bookingCode: parts[10],
      isColombian: parts[11] === '1',
      isBusiness: parts[12] === '1',
      amountCents: parseInt(parts[13], 10) || 0
    };
    if (parts[14]) out.ratePlan = parts[14] === 'F' ? 'flexible' : 'best';
    return out;
  } catch (e) {
    return null;
  }
}

function sanitizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/[^\d+\s]/g, '').trim().substring(0, 20);
}

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeParse(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

/* Dependencias inyectables (tests) con defaults perezosos: los módulos pesados
   (correo de confirmación, Odoo, descuentos) solo se cargan si se usan. */
function paymentDeps(overrides = {}) {
  return {
    hasOtasyncCreds,
    getAvailabilityByType,
    insertReservation,
    acquireQuoteLock,
    releaseQuoteLock,
    trackPurchase,
    otasyncCreds: () => require('./_otasync').otasyncCreds(),
    getSessionKey: () => require('./_otasync').getSessionKey(),
    legacyInsert: (payload) => legacyInsert(payload),
    findReservationByReference: async (...a) => {
      const f = require('./_otasync').findReservationByReference;
      return typeof f === 'function' ? f(...a) : null;
    },
    verifyDirectBookingAmount: (...a) => require('./_direct-pricing').verifyDirectBookingAmount(...a),
    sendConfirmationEmail: (...a) => require('./send-confirmation').sendConfirmationEmail(...a),
    savePaymentDetails: (...a) => require('./_payment-details').savePaymentDetails(...a),
    consumeDiscountUse: (...a) => require('./_discount-store').consumeDiscountUse(...a),
    upsertPartner: (...a) => require('./_odoo').upsertPartner(...a),
    addToMailingList: (...a) => require('./_odoo').addToMailingList(...a),
    reportAlert: (...a) => require('./_alert').reportAlert(...a),
    settingsGet: (...a) => require('./_settings').get(...a),
    flag: (...a) => require('./_settings').flag(...a),
    getStore: blobStore,
    now: Date.now,
    ...overrides
  };
}

/* Alertas de dinero ("pago sin reserva", "doble pago", "monto incorrecto"):
   van por _alert.reportAlert → log + correo al equipo (deduplicado) + TAREA en
   la cola del panel (ops-queue). Antes eran sendEmail sueltos: si el correo se
   perdía, nadie se enteraba. dedupeKey por incidente (tx). Nunca lanza. */
async function moneyAlert(deps, { kind, message, context, dedupeKey }) {
  try {
    await deps.reportAlert({
      kind, severity: 'critical', message, context: context || {}, dedupeKey, ttlSec: MONEY_ALERT_TTL_SEC
    });
  } catch (e) {
    console.error(`[payments] money alert ${kind} failed:`, e && e.message);
  }
}

/* booking-results: lo que lee booking-status (polling del motor), reconcile-
   payments y el flujo de reembolsos. REGLA: un registro CONFIRMADO jamás se pisa
   — ni con un pendiente (sold_out/insert_failed) ni con otra reserva (en
   producción una re-entrega dejó booking-results apuntando a la reserva
   duplicada, ya cancelada). */
async function readBookingResult(store, bookingCode) {
  if (!store || !bookingCode) return null;
  try { return safeParse(await store.get(`direct-${bookingCode}`)); } catch (e) { return null; }
}

async function writeBookingResult(store, bookingCode, record) {
  if (!store || !bookingCode) return { written: false, reason: 'no-store' };
  const key = `direct-${bookingCode}`;
  try {
    const prev = safeParse(await store.get(key));
    if (prev && !prev.reservationPending) return { written: false, reason: 'confirmed_exists', existing: prev };
    await store.set(key, JSON.stringify(record));
    return { written: true };
  } catch (e) {
    console.warn('[payments] booking-results write failed (non-fatal):', e.message);
    return { written: false, reason: 'error' };
  }
}

async function processQuotePayment(transaction, corsHeaders, deps) {
  const quoteId = transaction.reference;
  let store, quote;
  try {
    store = getQuoteStore();
    quote = await loadQuote(store, quoteId);
  } catch (e) {
    console.error('[payments] quote store unavailable:', e.message);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote store unavailable; logged for manual follow-up' }) };
  }

  if (!quote) {
    console.error(`[payments] quote ${quoteId} not found for transaction ${transaction.id}`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote not found' }) };
  }

  if (quote.status === 'aceptada') {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true }) };
  }

  const status = effectiveStatus(quote);
  if (status === 'cancelada' || status === 'vencida') {
    console.error(`[payments] paid transaction ${transaction.id} for ${status} quote ${quoteId}. Manual follow-up required.`);
    await moneyAlert(deps, {
      kind: 'payment_without_reservation',
      message: `Pago ${transaction.provider} aprobado para la cotización ${quoteId}, que está ${status}. No se creó reserva: reembolsar o reactivar a mano.`,
      context: { quoteId, transactionId: transaction.id, provider: transaction.provider, amountCents: transaction.amountCents, quoteStatus: status },
      dedupeKey: `pay-quote-${status}-${transaction.id}`
    });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: `Quote is ${status}; logged for manual follow-up` }) };
  }

  const { totalCents } = computeQuoteTotal(quote);
  if (Math.abs(transaction.amountCents - totalCents) > 100) {
    console.error(`[payments] amount mismatch for quote ${quoteId}: paid=${transaction.amountCents} expected=${totalCents}, tx=${transaction.id}. Reservation NOT created.`);
    await moneyAlert(deps, {
      kind: 'payment_amount_mismatch',
      message: `Pago ${transaction.provider} con monto incorrecto para la cotización ${quoteId}. La reserva NO se creó.`,
      context: { quoteId, transactionId: transaction.id, paidCents: transaction.amountCents, expectedCents: totalCents },
      dedupeKey: `pay-amount-${transaction.id}`
    });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Amount mismatch; logged for manual follow-up' }) };
  }

  /* Single-writer lock per quoteId. Two webhook deliveries for the same quote
     (different transactions both APPROVED against the same reference, or
     duplicates that slip past per-tx dedup) would otherwise both reach
     createConfirmedReservation and double-book in OTASync. The Wompi handler
     uses the same lock. */
  const lock = await deps.acquireQuoteLock(quoteId, transaction.id);
  if (!lock.acquired) {
    if (String(lock.ownerTx) === String(transaction.id)) {
      /* Re-entrega del MISMO pago mientras la primera sigue en curso: no es doble pago. */
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true, inProgress: true }) };
    }
    console.error(`[payments] quote ${quoteId} is already being processed by tx ${lock.ownerTx} (started ${lock.startedAt}). Refusing tx ${transaction.id}.`);
    await moneyAlert(deps, {
      kind: 'payment_double_charge',
      message: `Doble pago detectado en la cotización ${quoteId}: llegó un segundo pago aprobado mientras se procesaba el primero. Reembolsar el duplicado.`,
      context: { quoteId, firstTransaction: lock.ownerTx, secondTransaction: transaction.id, provider: transaction.provider },
      dedupeKey: `pay-double-${transaction.id}`
    });
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Quote already being processed by another transaction', ownerTx: lock.ownerTx }) };
  }

  try {

  const now = new Date().toISOString();
  const paidAmount = transaction.amountCents / 100;
  /* Persist the payment method (already extracted in normalizeTransaction) so the
     refund flow can later route gateway-auto (MP card) vs manual transfer
     (PSE/Nequi/cash). Set once here; every save path below includes it. */
  quote.paymentMethod = transaction.paymentMethod;

  if (!hasOtasyncCreds()) {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.paymentProvider = transaction.provider;
    quote.bookingCodes = [];
    quote.updatedAt = now;
    try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, mock: true, quoteId }) };
  }

  const hasHold = Array.isArray(quote.holdReservationIds) && quote.holdReservationIds.length > 0;
  if (hasHold) {
    for (const holdId of quote.holdReservationIds) {
      try { await releaseHold(holdId); } catch (e) { console.error('[payments] releaseHold failed for', quoteId, holdId, e.message); }
    }
    quote.holdReservationIds = [];
  }

  if (!hasHold && quote.checkin && quote.checkout) {
    try {
      const { availByType, isMock } = await getAvailabilityByType(quote.checkin, quote.checkout);
      if (!isMock) {
        const shortfalls = findUnavailable(quote.items, availByType);
        if (shortfalls.length > 0) {
          console.error(`[payments] PAID but UNAVAILABLE for quote ${quoteId}, tx ${transaction.id}: ${JSON.stringify(shortfalls)}.`);
          quote.status = 'aceptada';
          quote.paidAt = now;
          quote.transactionId = transaction.id;
          quote.paymentProvider = transaction.provider;
          quote.bookingCodes = [];
          quote.reservationPending = true;
          quote.availabilityOk = false;
          quote.unavailable = shortfalls;
          quote.updatedAt = now;
          try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
          await moneyAlert(deps, {
            kind: 'payment_without_reservation',
            message: `Pago sin reserva — cotización ${quoteId}: ya no hay disponibilidad. Crear a mano en OTASync o reembolsar.`,
            context: { quoteId, empresa: quote.empresa || '', transactionId: transaction.id, provider: transaction.provider, shortfalls },
            dedupeKey: `pay-noreservation-${transaction.id}`
          });
          return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
        }
      }
    } catch (e) {
      console.error('[payments] availability re-check failed (continuing to book):', e.message);
    }
  }

  const recordPending = async (reason) => {
    quote.status = 'aceptada';
    quote.paidAt = now;
    quote.transactionId = transaction.id;
    quote.paymentProvider = transaction.provider;
    quote.bookingCodes = [];
    quote.reservationPending = true;
    quote.updatedAt = now;
    try { await saveQuote(store, quote); } catch (e) { /* non-fatal */ }
    await moneyAlert(deps, {
      kind: 'payment_without_reservation',
      message: `Pago sin reserva — cotización ${quoteId}: la reserva no se pudo crear en OTASync. Reintentar desde el panel o crear a mano.`,
      context: { quoteId, empresa: quote.empresa || '', transactionId: transaction.id, provider: transaction.provider, reason },
      dedupeKey: `pay-noreservation-${transaction.id}`
    });
    console.error(`[payments] reservation ${reason} for quote ${quoteId}, tx ${transaction.id}; marked reservationPending.`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, reservationPending: true }) };
  };

  let bookingCode;
  try {
    bookingCode = await createConfirmedReservation(quote, {
      paidAmount,
      transactionId: transaction.id,
      paymentProvider: transaction.provider
    });
  } catch (e) {
    return await recordPending('failed: ' + e.message);
  }

  quote.status = 'aceptada';
  quote.paidAt = now;
  quote.transactionId = transaction.id;
  quote.paymentProvider = transaction.provider;
  quote.bookingCodes = [bookingCode];
  quote.reservationPending = false;
  quote.updatedAt = now;
  try { await saveQuote(store, quote); } catch (e) { console.error('[payments] failed to mark quote accepted:', e.message); }

  try {
    if (quote.email) {
      await sendEmail({
        to: quote.email,
        cc: adminEmail(),
        subject: `Reserva confirmada ${bookingCode} - Hotel Estar`,
        html: paymentConfirmationHtml({ quote, bookingCode, total: paidAmount })
      });
    }
  } catch (e) { console.error('[payments] confirmation email failed:', e.message); }

  /* Snapshot de los datos del pago para un reembolso futuro (best-effort). */
  try { await deps.savePaymentDetails(bookingCode, transaction); } catch (e) { /* best-effort */ }

  /* A-6: server-side conversion for corporate quote payments. */
  try {
    await deps.trackPurchase({ transactionId: String(bookingCode), value: paidAmount });
  } catch (e) { /* analytics never blocks */ }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, quoteId, bookingCode }) };

  } finally {
    /* Quote saved as 'aceptada' before release, so a concurrent webhook
       retrying after release falls through the duplicate check. */
    if (!lock.blobsUnavailable) await deps.releaseQuoteLock(quoteId);
  }
}

/* Datos laterales de la reserva persistidos al crear la preferencia (mismos
   stores y claves que la ruta Wompi): código de descuento aplicado, nota del
   huésped y opt-in de marketing. Best-effort: sin blob = sin dato. */
async function loadDirectSideData(bookingCode, deps) {
  const out = { discount: null, notes: '', marketingOptIn: null };
  if (!bookingCode) return out;
  const disc = tryStore('booking-discounts', deps);
  if (disc) {
    try {
      const d = safeParse(await disc.get(`disc-${bookingCode}`));
      if (d && d.code) out.discount = d;
    } catch (e) { /* best-effort */ }
  }
  let notesOn = false;
  try { notesOn = await deps.flag('GUEST_NOTES_TO_PMS_ENABLED'); } catch (e) { notesOn = false; }
  if (notesOn) {
    const ns = tryStore('booking-notes', deps);
    if (ns) {
      try {
        const n = safeParse(await ns.get(`note-${bookingCode}`));
        if (n && n.notes) out.notes = escapeHtml(String(n.notes)).substring(0, 500);
      } catch (e) { /* best-effort */ }
    }
  }
  const mk = tryStore('booking-marketing', deps);
  if (mk) {
    try {
      const m = safeParse(await mk.get(`mkt-${bookingCode}`));
      if (m && m.accepted === true) out.marketingOptIn = m;
    } catch (e) { /* best-effort */ }
  }
  return out;
}

/* Plan tarifario AUTORITATIVO (igual que Wompi): se deriva del MONTO pagado
   (Estricta vs Flexible recomputados desde OTASync, con el descuento si lo hubo),
   no del campo que viene del cliente. Si no se puede recomputar (mock/error/
   código ya vencido), cae al plan codificado en la referencia. */
async function deriveRatePlan(decoded, paidCents, discount, deps) {
  try {
    const opts = (discount && discount.code) ? { discountCode: discount.code, email: discount.email || decoded.email || '' } : {};
    const v = await deps.verifyDirectBookingAmount(decoded, paidCents, opts);
    if (v && v.matchedPlan) return v.matchedPlan;
  } catch (e) { /* best-effort */ }
  return decoded.ratePlan || null;
}

function ratePlanLabel(ratePlan) {
  if (ratePlan === 'flexible') return 'Flexible (reembolso 100% hasta 24 h antes)';
  if (ratePlan === 'best') return 'Estricta (reembolso 100% hasta 7 días antes)';
  return 'N/D';
}

/* Construye el payload de insert/reservation para una reserva directa MP.
   Pura (testeable). La lógica de IVA/precio NO cambia (folio M7: no tocar la
   contabilidad hasta validar con una reserva real).

   FOLIO DOBLE (producción 3083706 / 3273564): el pago iba DOS veces — en
   rooms[0].payments Y en payments del nivel superior. OTASync registra ambos, así
   que el folio mostraba el pago duplicado. Wompi y las cotizaciones lo mandan
   solo en el nivel superior (rooms[].payments vacío) y no tienen el problema. */
function buildDirectReservationPayload({ decoded, transaction, pkey, creds, roomDetails, ratePlan, guestNote, todayIso }) {
  const { token, propertyId, channelId, channelName } = creds || {};
  const checkinDate = new Date(decoded.checkin);
  const checkoutDate = new Date(decoded.checkout);
  const nights = Math.max(1, Math.ceil((checkoutDate - checkinDate) / 86400000));
  const paidAmount = transaction.amountCents / 100;
  const mustPayIva = decoded.isColombian || decoded.isBusiness;
  const roomPrice = mustPayIva ? Math.round(paidAmount * 1.19) : paidAmount;
  const avgPrice = Math.round(roomPrice / nights);
  const matchedRoom = (roomDetails || {})[decoded.roomTypeId];
  const roomName = matchedRoom ? matchedRoom.name : 'Clasica';

  const nightsArray = [];
  const nightsDates = [];
  for (let i = 0; i < nights; i++) {
    const d = new Date(checkinDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    nightsDates.push(dateStr);
    nightsArray.push({ night_date: dateStr, price: avgPrice, original_price: avgPrice, breakfast: 0, lunch: 0, dinner: 0 });
  }

  const paymentInfo = [{
    amount: paidAmount,
    payment_date: todayIso || new Date().toISOString().split('T')[0],
    payment_method: 'card',
    note: `${transaction.provider} ID: ${transaction.id}, Ref: ${decoded.bookingCode}, Status: APPROVED`
  }];

  const extrasList = [];
  // orden = _pricing.js EXTRAS_KEYS: desayuno, parqueadero, late, early, traslado, tour, mascota
  const extraNames = ['Desayuno', 'Parqueadero', 'Late check-out (hasta 2pm)', 'Early check-in (desde 6am)', 'Traslado Aeropuerto', 'Tour Manizales', 'Mascota'];
  for (let i = 0; i < extraNames.length; i++) {
    if (String(decoded.extrasMask || '')[i] === '1') extrasList.push(extraNames[i]);
  }
  const extrasText = extrasList.length > 0 ? extrasList.join(', ') : 'Ninguno';
  const phone = sanitizePhone(decoded.phone);
  const email = String(decoded.email || '').trim();

  const payload = {
    key: pkey,
    id_properties: propertyId,
    token,
    status: 'confirmed',
    rooms: [{
      id_room_types: parseInt(decoded.roomTypeId, 10),
      id_rooms: 0,
      room_type: roomName,
      room_number: '',
      avg_price: avgPrice,
      total_price: roomPrice,
      children_1: 0, children_2: 0, children_3: 0,
      adults: decoded.guestsCount || 1,
      seniors: 0,
      extras: [],
      payments: [], /* el pago va SOLO en el nivel superior (ver arriba) */
      overbooking: 0,
      nights: nightsArray
    }],
    /* Email y teléfono del huésped EN la reserva: get-booking y
       request-cancellation verifican el segundo factor contra estos campos; sin
       ellos nunca encontraban las reservas pagadas por Mercado Pago. */
    guests: [{
      first_name: decoded.firstName,
      last_name: decoded.lastName,
      email,
      phone,
      id_guests: 0,
      guest_type: 'adults'
    }],
    extras: [],
    payments: paymentInfo,
    children_1: 0, children_2: 0, children_3: 0,
    adults: decoded.guestsCount || 1,
    seniors: 0,
    total_guests: decoded.guestsCount || 1,
    discount_type: 'percent',
    discount_amount: 0,
    discount_note: '',
    rooms_price: roomPrice,
    rooms_discounted: roomPrice,
    extras_price: 0,
    board_price: 0,
    city_tax_price: 0,
    insurance_price: 0,
    total_price: roomPrice,
    id_boards: '',
    id_reservations: 0,
    nights,
    nights_dates: nightsDates,
    reservation_type: 'web',
    active_id_room_types: String(decoded.roomTypeId),
    preselected_id_rooms: 0,
    reference: decoded.bookingCode || 'Hotel Estar Custom Booking Engine',
    id_contigents: 0,
    date_arrival: decoded.checkin,
    date_departure: decoded.checkout,
    guest_email: email,
    ...(channelId ? { id_channels: channelId, channel: channelName } : {}),
    note: `${guestNote ? 'Nota del huésped: ' + guestNote + '. ' : ''}Plan: ${ratePlanLabel(ratePlan)}. Telefono del huesped: ${phone}. Extras: ${escapeHtml(extrasText)}. IVA (19%): ${mustPayIva ? 'POR COBRAR EN HOTEL (' + Math.round(paidAmount * 0.19) + ')' : 'EXENTO'}. Creado por Webhook ${transaction.provider}. ID Transaccion: ${transaction.id}`
  };
  return { payload, nights, paidAmount, roomPrice, avgPrice, roomName };
}

/* Inserción "legacy" (MP_DIRECT_RESILIENT_ENABLED='false'): un único fetch sin
   reintentos. Se conserva solo como rollback. */
async function legacyInsert(payload) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  let response;
  try {
    response = await fetch('https://app.otasync.me/api/reservation/insert/reservation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    throw err.name === 'AbortError' ? new Error('Request timeout during reservation insert') : err;
  }
  if (!response.ok) throw new Error(`insert/reservation returned status ${response.status}`);
  return response.json();
}

async function processDirectPayment(transaction, corsHeaders, deps, resilient) {
  const reply = (obj) => ({ statusCode: 200, headers: corsHeaders, body: JSON.stringify(obj) });
  const decoded = decodeDirectReference(transaction.reference);
  if (!decoded) {
    return reply({ message: 'Reference was not an encoded direct reservation payload' });
  }
  const code = decoded.bookingCode;

  if (decoded.amountCents && Math.abs(transaction.amountCents - decoded.amountCents) > 100) {
    console.error(`[payments] amount mismatch for direct booking ${code}: paid=${transaction.amountCents} expected=${decoded.amountCents}, tx=${transaction.id}.`);
    await moneyAlert(deps, {
      kind: 'payment_amount_mismatch',
      message: `Pago ${transaction.provider} con monto incorrecto — reserva directa ${code}. La reserva NO se creó: revisar y reembolsar o crear a mano.`,
      context: { bookingCode: code, transactionId: transaction.id, paidCents: transaction.amountCents, expectedCents: decoded.amountCents, roomTypeId: decoded.roomTypeId, checkin: decoded.checkin, checkout: decoded.checkout },
      dedupeKey: `pay-amount-${transaction.id}`
    });
    return reply({ message: 'Amount mismatch; logged for manual follow-up' });
  }

  if (!deps.hasOtasyncCreds()) {
    return reply({ success: true, mock: true, bookingCode: code });
  }

  /* Lock single-writer por reserva (solo ruta resiliente). */
  let lock = { acquired: true, blobsUnavailable: true };
  if (resilient) {
    lock = await deps.acquireQuoteLock(code, transaction.id);
    if (!lock.acquired && String(lock.ownerTx) === String(transaction.id)) {
      /* Mercado Pago reenvía la notificación del MISMO pago mientras la primera
         sigue en curso (visto en producción, oct-2026). No es doble pago: se
         ignora en silencio — la entrega original crea la reserva. */
      console.log(`[payments] duplicate delivery of tx ${transaction.id} for ${code} while in progress; ignoring.`);
      return reply({ success: true, bookingCode: code, duplicate: true, inProgress: true });
    }
    if (!lock.acquired) {
      console.error(`[payments] direct booking ${code} already being processed by tx ${lock.ownerTx}. Refusing tx ${transaction.id}.`);
      await moneyAlert(deps, {
        kind: 'payment_double_charge',
        message: `Doble pago detectado — reserva directa ${code}: llegó un segundo pago aprobado mientras se procesaba el primero. Reembolsar el duplicado.`,
        context: { bookingCode: code, firstTransaction: lock.ownerTx, secondTransaction: transaction.id, provider: transaction.provider },
        dedupeKey: `pay-double-${transaction.id}`
      });
      return reply({ success: true, bookingCode: code, duplicate: true, ownerTx: lock.ownerTx });
    }
  }

  try {
    const resultsStore = tryStore('booking-results', deps);

    /* (1) Idempotencia por reserva: si booking-results ya tiene un resultado para
       este código (reserva creada, o pendiente ya alertado), NO se vuelve a crear.
       Si otro tx pagó el mismo código → doble pago (una preferencia de MP admite
       más de un pago). */
    const existing = await readBookingResult(resultsStore, code);
    if (existing) {
      const sameTx = !existing.transactionId || String(existing.transactionId) === String(transaction.id);
      if (!sameTx) {
        await moneyAlert(deps, {
          kind: 'payment_double_charge',
          message: `Doble pago — reserva directa ${code}: llegó otro pago aprobado para una reserva que ya ${existing.reservationPending ? 'estaba registrada como pendiente' : 'existe'}. No se creó otra reserva; reembolsar el duplicado.`,
          context: { bookingCode: code, existingBooking: existing.bookingCode, existingTransaction: existing.transactionId, newTransaction: transaction.id, provider: transaction.provider },
          dedupeKey: `pay-double-${transaction.id}`
        });
      }
      return reply({ success: true, bookingCode: existing.bookingCode || code, duplicate: true, ...(existing.reservationPending ? { reservationPending: true } : {}) });
    }

    /* (2) Idempotencia POR ESTADÍA (A-4): atrapa el doble pago de la misma estadía
       con códigos/tx distintos. La re-entrega del MISMO tx es duplicado aunque
       hayan pasado semanas. Fail-open si Blobs no está. */
    const stayIdemKey = `booking_${decoded.roomTypeId}_${decoded.checkin}_${decoded.checkout}_${String(decoded.email || '').toLowerCase().trim()}`;
    let stayIdemStore = null;
    if (resilient) {
      stayIdemStore = tryStore('booking-idempotency', deps);
      if (stayIdemStore) {
        try {
          const prev = safeParse(await stayIdemStore.get(stayIdemKey));
          if (prev) {
            if (String(prev.transactionId) === String(transaction.id)) {
              return reply({ success: true, bookingCode: prev.bookingCode || code, duplicate: true });
            }
            if ((deps.now() - (prev.createdAt || 0)) < STAY_IDEM_MAX_AGE_MS) {
              console.error(`[payments] DUPLICATE STAY for ${code}: prev tx ${prev.transactionId}, new tx ${transaction.id}. NOT creating a second reservation.`);
              await moneyAlert(deps, {
                kind: 'payment_double_charge',
                message: `Doble pago de la misma estadía — ${code}: ya hay una reserva para esas fechas, habitación y correo. No se creó otra; reembolsar el cargo duplicado.`,
                context: { bookingCode: code, existingBooking: prev.bookingCode, existingTransaction: prev.transactionId, newTransaction: transaction.id, roomTypeId: decoded.roomTypeId, checkin: decoded.checkin, checkout: decoded.checkout },
                dedupeKey: `pay-double-${transaction.id}`
              });
              return reply({ success: true, bookingCode: prev.bookingCode, duplicate: true });
            }
          }
        } catch (e) {
          stayIdemStore = null; /* fail-open: apoyo en lock + dedup por-tx */
        }
      }
    }

    /* (3) Última línea de defensa, independiente de Blobs: si OTASync ya tiene
       una reserva con esta reference (el código EST-…), NO se inserta otra. Así
       una re-entrega días después jamás duplica aunque se pierdan los registros
       de Blobs. Si la consulta falla, se sigue (fail-open: un pago nuevo no puede
       quedar bloqueado por una caída de la consulta). */
    let found = null;
    try { found = await deps.findReservationByReference(code, decoded.checkin); } catch (e) { found = null; }
    if (found && found.idReservations) {
      console.warn(`[payments] reservation for reference ${code} already exists in OTASync (${found.idReservations}); tx ${transaction.id} will not create another.`);
      await writeBookingResult(resultsStore, code, {
        bookingCode: found.idReservations, otasyncId: found.idReservations,
        provider: transaction.provider, paymentMethod: transaction.paymentMethod,
        transactionId: transaction.id, amountInCents: transaction.amountCents,
        recoveredFrom: 'otasync_reference', createdAt: new Date(deps.now()).toISOString()
      });
      return reply({ success: true, bookingCode: found.idReservations, duplicate: true });
    }

    /* (4) Disponibilidad (C-2). El pago ya se capturó: si se agotó, NO se hace
       overbooking — queda pendiente + alerta. Va DESPUÉS de los chequeos de
       idempotencia: antes, una re-entrega veía la habitación "agotada" por su
       PROPIA reserva y escribía un falso sold_out encima del resultado bueno. */
    if (decoded.checkin && decoded.checkout) {
      try {
        const { availByType, isMock } = await deps.getAvailabilityByType(decoded.checkin, decoded.checkout);
        if (!isMock && (availByType[String(decoded.roomTypeId)] || 0) <= 0) {
          console.error(`[payments] direct booking PAID but SOLD OUT: roomType=${decoded.roomTypeId}, bookingCode=${code}, tx=${transaction.id}. Reservation NOT created.`);
          await writeBookingResult(resultsStore, code, {
            bookingCode: code, reservationPending: true, reason: 'sold_out',
            provider: transaction.provider, paymentMethod: transaction.paymentMethod, transactionId: transaction.id,
            amountInCents: transaction.amountCents, createdAt: new Date(deps.now()).toISOString()
          });
          await moneyAlert(deps, {
            kind: 'payment_without_reservation',
            message: `Pago sin reserva — ${code}: pago ${transaction.provider} aprobado pero la habitación ya no tiene disponibilidad. Crear a mano en OTASync o reembolsar.`,
            context: { bookingCode: code, transactionId: transaction.id, roomTypeId: decoded.roomTypeId, checkin: decoded.checkin, checkout: decoded.checkout, guest: `${decoded.firstName} ${decoded.lastName}`.trim(), email: decoded.email },
            dedupeKey: `pay-noreservation-${transaction.id}`
          });
          return reply({ success: true, bookingCode: code, reservationPending: true });
        }
      } catch (e) {
        console.error('[payments] direct availability check failed (continuing to book):', e.message);
      }
    }

    const side = await loadDirectSideData(code, deps);
    const ratePlan = await deriveRatePlan(decoded, transaction.amountCents, side.discount, deps);

    const creds = deps.otasyncCreds();
    const pkey = await deps.getSessionKey();

    let roomDetails = {};
    try {
      const fs = require('fs');
      const path = require('path');
      const dbPath = path.join(__dirname, '../../rooms_db.json');
      if (fs.existsSync(dbPath)) roomDetails = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) { /* fall back to default name */ }

    const built = buildDirectReservationPayload({
      decoded, transaction, pkey, creds, roomDetails, ratePlan, guestNote: side.notes
    });
    const { payload, nights, paidAmount, roomPrice, avgPrice, roomName } = built;

    let data;
    if (resilient) {
      /* C5 — insertReservation trae reintentos+backoff+alerta crítica A3. Si aun así
         falla, recordPending SIEMPRE (booking-results, reason:'insert_failed') + alerta
         y 200 (para que MP no reintente infinito). El reconciliador trata
         reservationPending:true como NO reconciliado, así el pago no se pierde. */
      try {
        data = await deps.insertReservation(payload);
      } catch (insertErr) {
        console.error(`[payments] direct insert failed for ${code} (tx ${transaction.id}): ${insertErr.message}`);
        await writeBookingResult(resultsStore, code, {
          bookingCode: code, reservationPending: true, reason: 'insert_failed',
          provider: transaction.provider, paymentMethod: transaction.paymentMethod,
          transactionId: transaction.id, amountInCents: transaction.amountCents, ratePlan: ratePlan || null,
          createdAt: new Date(deps.now()).toISOString()
        });
        await moneyAlert(deps, {
          kind: 'payment_without_reservation',
          message: `Pago sin reserva — ${code}: pago ${transaction.provider} aprobado pero la reserva NO se pudo crear en OTASync tras reintentos. Crear a mano o reembolsar (queda PENDIENTE; la reconciliación la ve).`,
          context: { bookingCode: code, transactionId: transaction.id, error: String(insertErr.message || '').slice(0, 200), guest: `${decoded.firstName} ${decoded.lastName}`.trim(), email: decoded.email, checkin: decoded.checkin, checkout: decoded.checkout },
          dedupeKey: `pay-noreservation-${transaction.id}`
        });
        return reply({ success: true, bookingCode: code, reservationPending: true });
      }
    } else {
      data = await deps.legacyInsert(payload);
    }
    const finalBookingCode = (data && data.id_reservations) || code;
    const nowIso = new Date(deps.now()).toISOString();

    /* Resultado visible para el polling del motor (/api/booking-status), la
       reconciliación y los reembolsos. Nunca pisa un confirmado previo. */
    await writeBookingResult(resultsStore, code, {
      bookingCode: finalBookingCode,
      otasyncId: (data && data.id_reservations) || null,
      provider: transaction.provider,
      paymentMethod: transaction.paymentMethod,
      transactionId: transaction.id,
      amountInCents: transaction.amountCents,
      ratePlan: ratePlan || null,
      createdAt: nowIso
    });

    /* Idempotencia por estadía: registrar SOLO tras inserción exitosa. */
    if (resilient && stayIdemStore) {
      try {
        await stayIdemStore.set(stayIdemKey, JSON.stringify({ bookingCode: finalBookingCode, transactionId: transaction.id, createdAt: deps.now() }));
      } catch (e) { /* non-fatal */ }
    }

    /* Correo de confirmación desde el SERVIDOR (como Wompi): llega aunque el
       huésped cierre la pestaña en Mercado Pago o no vuelva al sitio. Idempotente
       con el envío del navegador (dedupe por código de reserva). Nunca lanza. */
    try {
      if (decoded.email) {
        const { EXTRAS_KEYS } = require('./_pricing');
        const bIdx = EXTRAS_KEYS.indexOf('desayuno');
        await deps.sendConfirmationEmail({
          guestEmail: decoded.email,
          guestName: `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim() || decoded.email,
          bookingCode: String(finalBookingCode),
          roomName,
          checkIn: decoded.checkin,
          checkOut: decoded.checkout,
          nights,
          totalAmount: roomPrice,
          paidAmount,
          phone: sanitizePhone(decoded.phone),
          breakfast: bIdx >= 0 && String(decoded.extrasMask || '')[bIdx] === '1',
          via: 'webhook-mercadopago'
        });
      }
    } catch (e) {
      console.error(`[payments] confirmation email failed (non-fatal): ${e.message}. bookingCode=${finalBookingCode}`);
    }

    /* Snapshot durable de los datos del pago (id MP, método, últimos 4, fecha,
       valor, plan) para el reembolso: booking-results no los guarda todos. */
    try {
      await deps.savePaymentDetails(finalBookingCode, transaction, { ratePlan: ratePlan || null });
      if (code && String(code) !== String(finalBookingCode)) {
        await deps.savePaymentDetails(code, transaction, { ratePlan: ratePlan || null });
      }
    } catch (e) { /* best-effort */ }

    /* Descuento: consumir el uso SOLO con la reserva creada, idempotente por el
       código de reserva (una re-entrega no recuenta). El monto con descuento ya
       se verificó en el servidor al crear la preferencia (va en la referencia). */
    if (side.discount && side.discount.code) {
      try {
        await deps.consumeDiscountUse(side.discount.code, {
          email: side.discount.email || decoded.email || '',
          bookingCode: code
        });
      } catch (e) {
        console.error(`[payments] discount usage increment failed (non-fatal): ${e.message}. bookingCode=${code}`);
      }
    }

    /* Maestro de clientes (Odoo): el huésped queda como partner; con opt-in de
       marketing (Ley 1581) se etiqueta y entra a la lista de Email Marketing.
       Sin opt-in → solo el partner. No fatal. */
    try {
      const optIn = Boolean(side.marketingOptIn && side.marketingOptIn.accepted === true);
      const guestName = `${decoded.firstName || ''} ${decoded.lastName || ''}`.trim() || decoded.email;
      const tags = ['Huésped directo'];
      if (optIn) tags.push('Opt-in marketing');
      await deps.upsertPartner({
        name: guestName,
        email: decoded.email,
        phone: sanitizePhone(decoded.phone),
        isCompany: false,
        tags,
        comment: `Huésped de reserva directa ${finalBookingCode} (Mercado Pago).${optIn ? ' Opt-in de marketing (motor de reserva directa).' : ''}`
      });
      if (optIn && decoded.email) {
        await deps.addToMailingList({ email: decoded.email, name: guestName, listName: 'Newsletter' });
      }
    } catch (e) {
      console.error('[payments] Odoo upsert (huésped MP) no fatal:', e.message);
    }

    /* A-6: server-side conversion (Measurement Protocol). */
    try {
      await deps.trackPurchase({
        transactionId: String(finalBookingCode),
        value: paidAmount,
        items: [{ item_id: String(decoded.roomTypeId), item_name: roomName, price: avgPrice, quantity: nights }]
      });
    } catch (e) { /* analytics never blocks */ }

    return reply({ success: true, bookingCode: finalBookingCode });

  } finally {
    /* Liberar el lock single-writer (solo si se adquirió de verdad, no en fail-open). */
    if (resilient && !lock.blobsUnavailable) await deps.releaseQuoteLock(code);
  }
}

async function processApprovedPayment(transaction, corsHeaders, overrides = {}) {
  const deps = paymentDeps(overrides);
  if (transaction.currency !== CURRENCY) {
    console.error(`[payments] invalid currency ${transaction.currency} for tx ${transaction.id}`);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Invalid currency; logged for manual follow-up' }) };
  }
  if (await alreadyProcessed(transaction.id, deps)) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ received: true, duplicate: true }) };
  }
  const isQuote = QUOTE_ID_RE.test(transaction.reference || '');
  if (!isQuote && !decodeDirectReference(transaction.reference)) {
    /* Ni cotización ni reserva directa MPDIR- (p. ej. un pedido GST- con el modo
       de pago en línea apagado): no se marca el tx como procesado, para no
       "quemarlo" si luego se activa la ruta que sí lo maneja. */
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Reference was not an encoded direct reservation payload' }) };
  }
  if (!isQuote) {
    /* C4 — mark-before-work en la ruta DIRECTA resiliente: una re-entrega del
       MISMO tx es no-op aunque el insert falle después (la red de seguridad es
       el pendiente en booking-results, que el reconciliador cruza aunque el tx
       esté marcado). */
    const resilient = await mpDirectResilient(deps);
    if (resilient) {
      await markProcessed(transaction.id, deps);
      return await processDirectPayment(transaction, corsHeaders, deps, true);
    }
    const legacy = await processDirectPayment(transaction, corsHeaders, deps, false);
    if (legacy && legacy.statusCode >= 200 && legacy.statusCode < 300) await markProcessed(transaction.id, deps);
    return legacy;
  }
  const result = await processQuotePayment(transaction, corsHeaders, deps);
  if (result && result.statusCode >= 200 && result.statusCode < 300) {
    await markProcessed(transaction.id, deps);
  }
  return result;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

module.exports = {
  QUOTE_ID_RE,
  CURRENCY,
  normalizeStatus,
  normalizeTransaction,
  createDirectReference,
  decodeDirectReference,
  processApprovedPayment,
  alreadyProcessed,
  markProcessed,
  timingSafeEqualString,
  mpDirectResilient
};
module.exports._test = {
  buildDirectReservationPayload, writeBookingResult, readBookingResult, loadDirectSideData,
  deriveRatePlan, moneyAlert, paymentDeps, STAY_IDEM_MAX_AGE_MS
};

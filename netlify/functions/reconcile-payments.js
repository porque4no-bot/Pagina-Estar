/* Scheduled reconciliation of orphaned Wompi payments.
 *
 * The Wompi webhook is the source of truth for creating reservations after a
 * successful payment. If a webhook never arrives (Wompi exhausts retries, our
 * function 500s, signature verification rolls), the guest paid in Wompi but
 * we never created the reservation in OTASync. This cron job catches those
 * gaps and alerts the admin so we can recover manually before the guest
 * notices.
 *
 * For safety this is alert-only — auto-processing requires careful
 * idempotency and is reserved for a follow-up iteration. */

const { getStore } = require('@netlify/blobs');
const { getQuoteStore, loadQuote, effectiveStatus } = require('./_quotes-store');
/* Las referencias directas tienen formato distinto por proveedor: Wompi codifica
   "1|..." (decoder en _direct-pricing); Mercado Pago usa "MPDIR-..." (decoder en
   _payments). Probamos ambos al cruzar. */
const { decodeDirectReference: decodeWompiDirect } = require('./_direct-pricing');
const { decodeDirectReference: decodeMpDirect } = require('./_payments');

function getBookingResultsStore() {
  try {
    return getStore({ name: 'booking-results', consistency: 'strong' });
  } catch (e) {
    return null;
  }
}

/* A direct booking is reconciled when the webhook wrote its booking-results
   entry (`direct-<bookingCode>`). Missing entry => the webhook never created
   the reservation for a paid transaction. */
async function directBookingReconciled(resultsStore, bookingCode) {
  if (!resultsStore || !bookingCode) return false;
  try {
    const raw = await resultsStore.get(`direct-${bookingCode}`);
    if (!raw) return false;
    /* A pending entry (sold_out / failed insert) is NOT reconciled — it still
       needs manual handling, so we want it reported. */
    /* Blob corrupto → fail-safe: tratar como NO reconciliado para que el huérfano
       se reporte y se revise a mano, en vez de darlo por bueno en silencio. */
    try { return !JSON.parse(raw).reservationPending; } catch (e) { return false; }
  } catch (e) {
    return false;
  }
}

const WOMPI_API = process.env.WOMPI_SANDBOX === 'true'
  ? 'https://sandbox.wompi.co/v1'
  : 'https://production.wompi.co/v1';

/* Ventana de 48 h (antes 6 h): un pago cuyo webhook falló un viernes en la noche
   sigue apareciendo el fin de semana. Para no repetir la MISMA alerta cada 30 min
   durante 48 h, cada huérfano se alerta UNA sola vez (marca por tx en el store
   'reconcile-notified'); la tarea queda abierta en el panel hasta resolverla. */
const LOOKBACK_HOURS = 48;
/* Gracia para el webhook: un pago aprobado hace segundos puede estar todavía
   creando su reserva. Sin esto, una corrida que coincide con ese instante
   alertaba un falso "pago sin reserva" (y ahora, con la alerta UNA vez por tx,
   esa tarea falsa quedaría abierta). */
const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_TRANSACTIONS = 100;    /* hard cap to avoid runaway pagination       */

function getProcessedStore() {
  try {
    return getStore({ name: 'processed-transactions', consistency: 'strong' });
  } catch (e) {
    return null;
  }
}

async function isProcessed(txStore, transactionId) {
  if (!txStore) return false;
  try {
    const v = await txStore.get(transactionId);
    return Boolean(v);
  } catch (e) { return false; }
}

/* Fetch APPROVED transactions in the lookback window. The Wompi merchant
   transactions endpoint requires the private key. We use pagination cursor
   semantics: stop once we go past the lookback window or hit the hard cap. */
async function fetchRecentApproved() {
  const privateKey = process.env.WOMPI_PRIVATE_KEY;
  if (!privateKey) {
    return { transactions: [], reason: 'WOMPI_PRIVATE_KEY not configured' };
  }
  const cutoff = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const all = [];
  /* Wompi exige from_date, until_date, page y page_size en la búsqueda de
     transacciones: sin ellos responde 422 (visto en producción cada 30 min →
     la detección de pagos huérfanos de Wompi estaba ciega). Ventana en días
     (formato YYYY-MM-DD, until_date = mañana para no perder lo de hoy en UTC). */
  const ymd = ms => new Date(ms).toISOString().slice(0, 10);
  const PAGE_SIZE = 50;
  const pageUrl = page => `${WOMPI_API}/transactions?status=APPROVED`
    + `&from_date=${ymd(cutoff)}&until_date=${ymd(Date.now() + 24 * 3600 * 1000)}`
    + `&page=${page}&page_size=${PAGE_SIZE}&order_by=created_at&order=DESC`;
  let page = 1;
  let next = pageUrl(page);

  while (next && all.length < MAX_TRANSACTIONS) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    let res;
    try {
      res = await fetch(next, {
        headers: { 'Authorization': `Bearer ${privateKey}` },
        signal: ctrl.signal
      });
      clearTimeout(tid);
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Wompi transactions timeout') : err;
    }
    if (!res.ok) throw new Error(`Wompi transactions returned ${res.status}`);
    const data = await res.json();
    const batch = Array.isArray(data.data) ? data.data : [];
    let crossedCutoff = false;
    for (const tx of batch) {
      const created = tx.created_at ? new Date(tx.created_at).getTime() : 0;
      if (created && created < cutoff) { crossedCutoff = true; break; }
      all.push(tx);
    }
    if (crossedCutoff) break;
    if (data.meta && data.meta.next_page) {
      next = data.meta.next_page;
    } else if (batch.length === PAGE_SIZE) {
      page += 1;
      next = pageUrl(page);
    } else {
      next = null;
    }
  }
  return { transactions: all };
}

/* Mercado Pago (ruta de rollback). Lista pagos approved recientes vía la Search
   API. Paginación por offset/paging.total (semántica distinta a Wompi). Skip
   limpio si no hay token. Devuelve los `payment` crudos de MP. */
async function fetchRecentApprovedMP() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return { transactions: [], reason: 'MERCADOPAGO_ACCESS_TOKEN not configured' };
  const cutoff = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const beginDate = new Date(cutoff).toISOString();
  const endDate = new Date().toISOString();
  const PAGE = 50;
  const all = [];
  let offset = 0;
  while (all.length < MAX_TRANSACTIONS) {
    const url = `https://api.mercadopago.com/v1/payments/search?status=approved&sort=date_created&criteria=desc&range=date_created&begin_date=${encodeURIComponent(beginDate)}&end_date=${encodeURIComponent(endDate)}&limit=${PAGE}&offset=${offset}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
      res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }, signal: ctrl.signal });
      clearTimeout(tid);
    } catch (err) {
      clearTimeout(tid);
      throw err.name === 'AbortError' ? new Error('Mercado Pago search timeout') : err;
    }
    if (!res.ok) throw new Error(`Mercado Pago search returned ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    for (const p of results) all.push(p);
    const total = (data.paging && Number(data.paging.total)) || 0;
    offset += PAGE;
    if (!results.length || offset >= total) break;
  }
  return { transactions: all.slice(0, MAX_TRANSACTIONS) };
}

function getNotifiedStore() {
  try {
    return getStore({ name: 'reconcile-notified', consistency: 'strong' });
  } catch (e) {
    return null;
  }
}

function notifiedKey(o) {
  return `${o.provider || 'unknown'}:${o.transactionId}`;
}

async function wasNotified(store, o) {
  if (!store) return false;
  try { return Boolean(await store.get(notifiedKey(o))); } catch (e) { return false; }
}

async function markNotified(store, o, now) {
  if (!store) return;
  try {
    await store.set(notifiedKey(o), JSON.stringify({ at: new Date(now).toISOString(), reference: o.reference || null, reason: o.reason }));
  } catch (e) { /* best-effort: en el peor caso se repite la alerta (dedupe de _alert) */ }
}

/* Alerta de dinero por huérfano → _alert.reportAlert: correo al equipo + TAREA
   en el panel (ops-queue). La dedupeKey es la MISMA que usa el webhook para
   "pago sin reserva" de ese tx, así el webhook y la reconciliación comparten una
   sola tarea por incidente. */
async function alertOrphan(o, deps = {}) {
  const report = deps.reportAlert || require('./_alert').reportAlert;
  const amount = o.amountCents != null ? Math.round(o.amountCents / 100).toLocaleString('es-CO') : '?';
  return report({
    kind: 'payment_without_reservation',
    severity: 'critical',
    message: `Reconciliación: pago ${o.provider || '?'} aprobado sin reserva en OTASync — ${o.reference || o.quoteId || o.transactionId} ($${amount}). Verificar en el proveedor y crear la reserva o reembolsar.`,
    context: {
      provider: o.provider, transactionId: o.transactionId, reference: o.reference || null,
      quoteId: o.quoteId || null, amountCents: o.amountCents, createdAt: o.createdAt || null, reason: o.reason
    },
    dedupeKey: `pay-noreservation-${o.transactionId}`,
    ttlSec: 7 * 24 * 3600
  });
}

exports.handler = async (event, context, overrides = {}) => {
  const deps = { now: Date.now, ...overrides };
  if (event && event.blobs) {
    try {
      const blobs = require('@netlify/blobs');
      if (typeof blobs.connectLambda === 'function') blobs.connectLambda(event);
    } catch (e) { /* best-effort */ }
  }
  const txStore = getProcessedStore();

  /* Wompi (activo) y Mercado Pago (rollback) se consultan por SEPARADO con
     try/catch independiente: un fallo en uno no debe enmascarar huérfanos del otro. */
  let wompiRaw = [], mpRaw = [], wompiReason = null, mpReason = null;
  try {
    const r = await fetchRecentApproved();
    wompiRaw = r.transactions || [];
    wompiReason = r.reason || null;
  } catch (e) {
    console.error('[reconcile-payments] wompi fetch failed:', e.message);
    wompiReason = 'wompi fetch error: ' + e.message;
  }
  /* MP solo si es el proveedor activo o si hay token (evita pegarle a la API de MP
     en cada corrida cuando se cobra con Wompi y no hay token MP). */
  if (process.env.PAYMENT_PROVIDER === 'mercadopago' || process.env.MERCADOPAGO_ACCESS_TOKEN) {
    try {
      const r = await fetchRecentApprovedMP();
      mpRaw = r.transactions || [];
      mpReason = r.reason || null;
    } catch (e) {
      console.error('[reconcile-payments] mercadopago fetch failed:', e.message);
      mpReason = 'mp fetch error: ' + e.message;
    }
  }

  /* Si el fetch de un proveedor falló, la detección de huérfanos quedó CIEGA para
     ese proveedor esa corrida. Un 200 silencioso haría que un fallo persistente
     (token vencido, API caída) apague la red de seguridad sin que nadie se entere.
     Alerta deduplicada (best-effort; nunca tumba la corrida). */
  const fetchFailed = [wompiReason, mpReason].filter(r => r && /fetch error/i.test(r));
  if (fetchFailed.length) {
    try {
      await require('./_alert').reportAlert({
        kind: 'reconcile-fetch-failed',
        severity: 'error',
        message: 'reconcile-payments no pudo consultar un proveedor; detección de pagos huérfanos degradada esta corrida',
        context: { reasons: fetchFailed },
        dedupeKey: 'reconcile-fetch-failed'
      });
    } catch (e) { /* best-effort */ }
  }

  /* Forma uniforme para el loop de cruce (agnóstica al proveedor). */
  const transactions = [];
  for (const tx of wompiRaw) {
    transactions.push({ id: String(tx.id), reference: String(tx.reference || ''), amountCents: tx.amount_in_cents, createdAt: tx.created_at, provider: 'wompi' });
  }
  for (const p of mpRaw) {
    transactions.push({ id: String(p.id), reference: String(p.external_reference || ''), amountCents: Math.round(Number(p.transaction_amount || 0) * 100), createdAt: p.date_created, provider: 'mercadopago' });
  }

  if (!transactions.length) {
    const reason = [wompiReason, mpReason].filter(Boolean).join('; ') || 'no recent approved transactions';
    console.log('[reconcile-payments] nothing to check:', reason);
    return { statusCode: 200, body: 'skipped/empty: ' + reason };
  }

  const orphans = [];
  let quoteStore;
  try { quoteStore = getQuoteStore(); } catch (e) { quoteStore = null; }
  const resultsStore = getBookingResultsStore();

  for (const tx of transactions) {
    const ref = String(tx.reference || '');
    const isQuote = /^COT-\d{4}-[A-Z0-9]{5}$/.test(ref);

    const createdMs = tx.createdAt ? new Date(tx.createdAt).getTime() : 0;
    if (createdMs && deps.now() - createdMs < MIN_AGE_MS) continue; /* el webhook aún puede estar trabajando */

    if (isQuote) {
      /* ── Corporate quote path ── su lock/estado la protege: si ya está
         procesada se omite. */
      if (await isProcessed(txStore, tx.id)) continue;
      let quoteState = null;
      if (quoteStore) {
        try {
          const q = await loadQuote(quoteStore, ref);
          if (q) {
            /* If the quote already records this tx id and is aceptada, the webhook
               succeeded but the processed-transactions blob lost the entry — treat
               as already reconciled. */
            if (q.transactionId === tx.id && effectiveStatus(q) === 'aceptada') continue;
            quoteState = effectiveStatus(q);
          }
        } catch (e) { /* fall through to alert with limited info */ }
      }

      orphans.push({
        quoteId: ref,
        provider: tx.provider,
        transactionId: tx.id,
        reference: ref,
        amountCents: tx.amountCents,
        createdAt: tx.createdAt,
        reason: quoteState ? `quote status: ${quoteState}` : 'quote not found / store unavailable'
      });
      continue;
    }

    /* ── Direct booking path ── IMPORTANTE (Mesa Redonda C5): NO se omite por
       estar 'processed'. Con mark-before-work un insert fallido queda marcado
       processed pero deja reservationPending:true en booking-results; la señal
       autoritativa es booking-results (directBookingReconciled trata pending como
       NO reconciliado). Decodifica con el formato del proveedor (Wompi 1|… o MP
       MPDIR-…). */
    const decoded = decodeWompiDirect(ref) || decodeMpDirect(ref);
    if (!decoded || !decoded.bookingCode) continue; /* not a recognizable direct ref */

    const reconciled = await directBookingReconciled(resultsStore, decoded.bookingCode);
    if (reconciled) continue;

    orphans.push({
      quoteId: null,
      provider: tx.provider,
      transactionId: tx.id,
      reference: decoded.bookingCode,
      amountCents: tx.amountCents,
      createdAt: tx.createdAt,
      reason: 'direct booking paid but no reservation (missing or pending in booking-results)'
    });
  }

  if (!orphans.length) {
    console.log(`[reconcile-payments] checked ${transactions.length} APPROVED tx, no orphans.`);
    return { statusCode: 200, body: `ok: ${transactions.length} tx, no orphans` };
  }

  console.error(`[reconcile-payments] ${orphans.length} orphan(s) detected`);
  /* Una alerta (correo + tarea) por huérfano, UNA sola vez por tx: las corridas
     siguientes (cada 30 min durante la ventana de 48 h) no la repiten. */
  const notifiedStore = getNotifiedStore();
  let alerted = 0;
  for (const o of orphans) {
    if (await wasNotified(notifiedStore, o)) continue;
    try {
      await alertOrphan(o, deps);
      alerted++;
    } catch (e) {
      console.error('[reconcile-payments] orphan alert failed:', e.message);
      continue;
    }
    await markNotified(notifiedStore, o, deps.now());
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ orphans: orphans.length, alerted, checked: transactions.length })
  };
};

/* Exportado para tests (mock de fetch/blobs). */
exports._test = { fetchRecentApprovedMP, fetchRecentApproved, directBookingReconciled, alertOrphan, LOOKBACK_HOURS, MIN_AGE_MS };

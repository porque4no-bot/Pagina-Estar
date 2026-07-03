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
const { sendEmail, adminEmail } = require('./_email');
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
    try { return !JSON.parse(raw).reservationPending; } catch (e) { return true; }
  } catch (e) {
    return false;
  }
}

const WOMPI_API = process.env.WOMPI_SANDBOX === 'true'
  ? 'https://sandbox.wompi.co/v1'
  : 'https://production.wompi.co/v1';

const LOOKBACK_HOURS = 6;        /* slightly longer than the cron interval     */
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
  let next = `${WOMPI_API}/transactions?status=APPROVED`;

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
    next = data.meta && data.meta.next_page ? data.meta.next_page : null;
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

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function orphanAlertHtml(orphans) {
  const rows = orphans.map(o => `
    <tr>
      <td>${esc(o.provider || '?')}</td>
      <td>${esc(o.quoteId || '(none)')}</td>
      <td>${esc(o.transactionId)}</td>
      <td>${esc(o.reference || '(none)')}</td>
      <td>${o.amountCents != null ? (o.amountCents / 100).toLocaleString('es-CO') : '?'}</td>
      <td>${esc(o.createdAt || '?')}</td>
      <td>${esc(o.reason)}</td>
    </tr>`).join('');
  return `
    <h2>Pagos sin reserva en OTASync</h2>
    <p>Encontramos ${orphans.length} transacción(es) APPROVED en las últimas
    ${LOOKBACK_HOURS} horas que no aparecen procesadas por el webhook. Cada una
    necesita verificación manual: confirmar en el proveedor, decidir si crear la
    reserva en OTASync o reembolsar al huésped.</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Proveedor</th><th>Quote ID</th><th>Tx</th><th>Reference</th><th>Monto (COP)</th><th>Creada</th><th>Razón</th></tr>
      ${rows}
    </table>
  `;
}

exports.handler = async () => {
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
  try {
    await sendEmail({
      to: adminEmail(),
      subject: `Reconciliación de pagos — ${orphans.length} pago(s) sin reserva`,
      html: orphanAlertHtml(orphans)
    });
  } catch (e) {
    console.error('[reconcile-payments] alert email failed:', e.message);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ orphans: orphans.length, checked: transactions.length })
  };
};

/* Exportado para tests (mock de fetch/blobs). */
exports._test = { fetchRecentApprovedMP, fetchRecentApproved, directBookingReconciled };

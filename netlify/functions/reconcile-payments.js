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
const { decodeDirectReference } = require('./_direct-pricing');

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

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function orphanAlertHtml(orphans) {
  const rows = orphans.map(o => `
    <tr>
      <td>${esc(o.quoteId || '(none)')}</td>
      <td>${esc(o.transactionId)}</td>
      <td>${esc(o.reference || '(none)')}</td>
      <td>${o.amountCents != null ? (o.amountCents / 100).toLocaleString('es-CO') : '?'}</td>
      <td>${esc(o.createdAt || '?')}</td>
      <td>${esc(o.reason)}</td>
    </tr>`).join('');
  return `
    <h2>Pagos Wompi sin reserva en OTASync</h2>
    <p>Encontramos ${orphans.length} transacción(es) APPROVED en las últimas
    ${LOOKBACK_HOURS} horas que no aparecen procesadas por el webhook. Cada una
    necesita verificación manual: confirmar en Wompi, decidir si crear la
    reserva en OTASync o reembolsar al huésped.</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <tr><th>Quote ID</th><th>Wompi tx</th><th>Reference</th><th>Monto (COP)</th><th>Creada</th><th>Razón</th></tr>
      ${rows}
    </table>
  `;
}

exports.handler = async () => {
  const txStore = getProcessedStore();
  let transactions, fetchReason;
  try {
    const result = await fetchRecentApproved();
    transactions = result.transactions;
    fetchReason = result.reason;
  } catch (e) {
    console.error('[reconcile-payments] fetch failed:', e.message);
    return { statusCode: 503, body: 'wompi fetch failed: ' + e.message };
  }

  if (fetchReason) {
    console.log('[reconcile-payments] skipped:', fetchReason);
    return { statusCode: 200, body: 'skipped: ' + fetchReason };
  }

  const orphans = [];
  let quoteStore;
  try { quoteStore = getQuoteStore(); } catch (e) { quoteStore = null; }
  const resultsStore = getBookingResultsStore();

  for (const tx of transactions) {
    const ref = String(tx.reference || '');
    const processed = await isProcessed(txStore, tx.id);
    if (processed) continue;

    const isQuote = /^COT-\d{4}-[A-Z0-9]{5}$/.test(ref);

    if (isQuote) {
      /* ── Corporate quote path ── */
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
        transactionId: tx.id,
        reference: ref,
        amountCents: tx.amount_in_cents,
        createdAt: tx.created_at,
        reason: quoteState ? `quote status: ${quoteState}` : 'quote not found / store unavailable'
      });
      continue;
    }

    /* ── Direct booking path (C-3) ── the main consumer flow. The Wompi
       reference is base64url-encoded (1|...). If we can decode it and the
       webhook never wrote its booking-results entry, the guest paid but has
       no reservation: report it for manual recovery. */
    const decoded = decodeDirectReference(ref);
    if (!decoded || !decoded.bookingCode) continue; /* not a recognizable direct ref */

    const reconciled = await directBookingReconciled(resultsStore, decoded.bookingCode);
    if (reconciled) continue;

    orphans.push({
      quoteId: null,
      transactionId: tx.id,
      reference: decoded.bookingCode,
      amountCents: tx.amount_in_cents,
      createdAt: tx.created_at,
      reason: 'direct booking paid but no reservation in booking-results'
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
      subject: `Reconciliación Wompi — ${orphans.length} pago(s) sin reserva`,
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

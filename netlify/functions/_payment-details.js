/* Payment details capture — store the fields a refund needs AT PAYMENT TIME.
 *
 * Wompi has no refund API on this account: a card refund is filed as a support
 * ticket and Wompi support asks for 4 data points (código de autorización,
 * fecha, últimos dígitos, valor). Those live in the Wompi transaction object the
 * webhook already receives — but `booking-results` (the blob the refund flow
 * reads) only keeps provider/method/txId and expires in 7 days. So weeks later,
 * when a refund is processed, the team digs them out of the Wompi panel by hand.
 *
 * This module snapshots those fields into a DURABLE store (keyed by booking
 * code) the moment a payment is confirmed, so `_refunds-store.recoverPaymentInfo`
 * can hand the team everything they need. Capture is the irreversible part: the
 * card last-4 / brand can only be read off the original transaction.
 *
 * Best-effort everywhere: a failure here never affects payment processing.
 */

const STORE = 'payment-details';
const TTL_SEC = 86400 * 400; /* ~13 months — covers any realistic refund window */

function paymentDetailsStore() {
  const { getStore } = require('@netlify/blobs');
  const opts = { name: STORE, consistency: 'strong' };
  if (process.env.BLOBS_TOKEN && process.env.NETLIFY_SITE_ID) {
    opts.token = process.env.BLOBS_TOKEN;
    opts.siteID = process.env.NETLIFY_SITE_ID;
  }
  return getStore(opts);
}

/* Pull refund-relevant fields out of a raw Wompi transaction. Tolerates missing
   shapes (PSE/Nequi have no card extra). `authCode` is best-guess across the
   fields Wompi exposes — the transaction id is always the reliable key. */
function extractWompiPaymentDetails(transaction) {
  const t = transaction || {};
  const pm = t.payment_method || {};
  const x = pm.extra || {};
  return {
    provider: 'wompi',
    transactionId: t.id != null ? String(t.id) : null,
    reference: t.reference || null,
    method: t.payment_method_type || pm.type || null, /* CARD | PSE | NEQUI | BANCOLOMBIA_TRANSFER */
    amountInCents: t.amount_in_cents != null ? Number(t.amount_in_cents) : null,
    currency: t.currency || null,
    cardBrand: x.brand || null,
    cardLast4: x.last_four || null,
    authCode: x.authorization_code || x.processor_response_code || x.external_identifier || null,
    paymentDate: t.finalized_at || t.created_at || null
  };
}

/* Snapshot the payment details for a booking. Never throws. `extra` carries
   refund-relevant context not present on the raw transaction (e.g. the rate
   plan, which lives in the booking reference) so it survives just as long. */
async function savePaymentDetails(bookingCode, transaction, extra) {
  if (!bookingCode) return { saved: false };
  try {
    const details = extractWompiPaymentDetails(transaction);
    if (extra && typeof extra === 'object') Object.assign(details, extra);
    details.bookingCode = String(bookingCode);
    details.savedAt = new Date().toISOString();
    await paymentDetailsStore().set(String(bookingCode), JSON.stringify(details), { ttl: TTL_SEC });
    return { saved: true, details };
  } catch (e) {
    if (process.env.DEBUG) console.warn('[payment-details] save failed (non-fatal):', e.message);
    return { saved: false };
  }
}

async function getPaymentDetails(bookingCode) {
  if (!bookingCode) return null;
  try {
    const raw = await paymentDetailsStore().get(String(bookingCode));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  extractWompiPaymentDetails, savePaymentDetails, getPaymentDetails, paymentDetailsStore
};

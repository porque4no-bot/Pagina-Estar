/* Server-side GA4 conversion tracking via the Measurement Protocol (A-6).
 *
 * The browser fires `purchase` from motor-app.jsx, but ad blockers and bounced
 * sessions drop a meaningful share of those. Firing the same purchase from the
 * payment webhook (server-side) recovers them; GA4 dedupes on transaction_id,
 * so the conversion is counted once.
 *
 * Fully env-gated and fire-and-forget: if GA4_MEASUREMENT_ID / GA4_API_SECRET
 * are not configured, or the call fails, the booking flow is never affected. */

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

function isConfigured() {
  return Boolean(process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET);
}

/* Track a purchase. `opts`:
   { transactionId, value (COP, online subtotal), items?:[{item_id,item_name,price,quantity}],
     clientId? } — clientId defaults to a value derived from the transaction so
   the event is accepted even though we don't have the browser GA client id. */
async function trackPurchase(opts = {}) {
  if (!isConfigured()) return { sent: false, reason: 'not-configured' };
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  const transactionId = String(opts.transactionId || '').slice(0, 120);
  if (!transactionId) return { sent: false, reason: 'no-transaction-id' };

  const clientId = String(opts.clientId || `srv.${transactionId}`);
  const payload = {
    client_id: clientId,
    non_personalized_ads: true,
    events: [{
      name: 'purchase',
      params: {
        transaction_id: transactionId,
        currency: String(opts.currency || 'COP'),
        value: Number(opts.value || 0),
        items: Array.isArray(opts.items) ? opts.items.slice(0, 20) : [],
        engagement_time_msec: 1
      }
    }]
  };

  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    clearTimeout(tid);
    return { sent: res.ok, status: res.status };
  } catch (e) {
    clearTimeout(tid);
    if (process.env.DEBUG) console.warn('[_analytics] purchase track failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { trackPurchase, isConfigured };

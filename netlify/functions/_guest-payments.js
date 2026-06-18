/* Online payment for guest-app service orders (Phase B).
 *
 * When a guest pays a service order online, the flow is:
 *   1. guest-action builds a SIGNED Wompi Web Checkout URL (amount is the
 *      server-computed order total — the guest can't tamper with it) and stores
 *      a lightweight payment intent here, keyed by the order reference.
 *   2. The guest pays on Wompi.
 *   3. wompi-webhook (handleGuestServicePayment) loads the intent, posts the
 *      charge + payment onto the reservation folio in OTASync/Kunas, and marks
 *      the intent paid (idempotent).
 *
 * The intent is intentionally minimal (no PII beyond the booking code) so the
 * webhook can read it without the guest-app encryption key. The full order, with
 * any PII, lives encrypted in the `guest-events` store.
 *
 * Everything here is inert until GUEST_SERVICE_PAYMENT_MODE=wompi + Wompi keys
 * are configured. Reference format = the order eventId (GST-...). */

const crypto = require('crypto');
const { guestStore } = require('./_guest-app');

const STORE = 'guest-service-payments';
const WOMPI_CHECKOUT_URL = 'https://checkout.wompi.co/p/';
/* The online-order reference is the order eventId, e.g. GST-1718700000000-AB12CD. */
const GUEST_ORDER_REF_RE = /^GST-[0-9]+-[A-Z0-9]+$/;

function store() {
  return guestStore(STORE);
}

async function saveIntent(intent) {
  await store().setJSON(intent.reference, intent);
  return intent;
}

async function loadIntent(reference) {
  return store().get(reference, { type: 'json' });
}

async function markIntentStatus(reference, status, extra = {}) {
  const intent = await loadIntent(reference);
  if (!intent) return null;
  const updated = { ...intent, status, ...extra, updatedAt: new Date().toISOString() };
  await store().setJSON(reference, updated);
  return updated;
}

/* Wompi integrity signature: SHA-256 of reference + amountInCents + currency +
   secret (same construction as create-wompi-signature.js). */
function signIntegrity(reference, amountInCents, currency, secret) {
  return crypto.createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${secret}`)
    .digest('hex');
}

/* Builds a signed Wompi Web Checkout redirect URL for a guest-service order and
   persists the payment intent the webhook will settle. The amount is server
   authoritative (the order total computed in guest-action via the catalogue).
   Throws if Wompi isn't configured. Returns the checkout URL. */
async function createGuestWompiCheckout({ record, bookingCode, redirectBase }, opts = {}) {
  const env = opts.env || process.env;
  const persist = opts.saveIntent || saveIntent;
  const publicKey = String(env.WOMPI_PUBLIC_KEY || '').trim();
  const secret = String(env.WOMPI_INTEGRITY_SECRET || '').trim();
  if (!publicKey || !secret) throw new Error('Wompi no está configurado para cobros en línea.');

  const currency = 'COP';
  const amountInCents = Math.round(Number(record.total) * 100);
  if (!(amountInCents > 0)) throw new Error('Monto inválido para el cobro en línea.');

  const reference = record.eventId;
  await persist({
    reference,
    eventId: record.eventId,
    bookingCode,
    items: (record.items || []).map(i => ({
      id: i.id, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity
    })),
    amountInCents,
    currency,
    status: 'pending',
    createdAt: new Date().toISOString()
  });

  const signature = signIntegrity(reference, amountInCents, currency, secret);
  /* Built by hand because the param name contains a colon (`signature:integrity`)
     that URLSearchParams would percent-encode, which Wompi rejects. */
  let url = `${WOMPI_CHECKOUT_URL}?public-key=${encodeURIComponent(publicKey)}` +
    `&currency=${currency}&amount-in-cents=${amountInCents}` +
    `&reference=${encodeURIComponent(reference)}&signature:integrity=${signature}`;
  const base = redirectBase || env.GUEST_APP_BASE_URL || env.URL || '';
  if (base) {
    url += `&redirect-url=${encodeURIComponent(`${base.replace(/\/$/, '')}/guest.html?order=${reference}`)}`;
  }
  return url;
}

module.exports = {
  STORE,
  GUEST_ORDER_REF_RE,
  saveIntent,
  loadIntent,
  markIntentStatus,
  signIntegrity,
  createGuestWompiCheckout
};

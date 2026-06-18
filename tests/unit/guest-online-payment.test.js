/* Phase B — online payment for guest-app service orders.
 * Covers the signed Wompi checkout builder (_guest-payments) and the webhook
 * settlement handler (wompi-webhook.handleGuestServicePayment), both with mocks
 * so no live Wompi/OTASync is touched. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const gp = require('../../netlify/functions/_guest-payments');
const { handleGuestServicePayment } = require('../../netlify/functions/wompi-webhook')._test;

const REF = 'GST-1718700000000-AB12CD';

test('_guest-payments: reference regex matches order ids only', () => {
  assert.ok(gp.GUEST_ORDER_REF_RE.test(REF));
  assert.ok(!gp.GUEST_ORDER_REF_RE.test('COT-2026-AB12C'));
  assert.ok(!gp.GUEST_ORDER_REF_RE.test('not-a-ref'));
});

test('createGuestWompiCheckout signs the SERVER amount and persists the intent', async () => {
  const saved = [];
  const env = { WOMPI_PUBLIC_KEY: 'pub_test_abc', WOMPI_INTEGRITY_SECRET: 'test_integrity_xyz', URL: 'https://estar.test' };
  const record = {
    eventId: REF,
    total: 68000,
    items: [
      { id: 'breakfast', name: 'Desayuno', unitPrice: 20000, quantity: 1 },
      { id: 'late_checkout', name: 'Late check-out', unitPrice: 48000, quantity: 1 }
    ]
  };
  const url = await gp.createGuestWompiCheckout(
    { record, bookingCode: 'EST-1' },
    { env, saveIntent: async (i) => { saved.push(i); } }
  );

  const expectedSig = crypto.createHash('sha256')
    .update(`${REF}6800000COPtest_integrity_xyz`).digest('hex');
  assert.match(url, /^https:\/\/checkout\.wompi\.co\/p\//);
  assert.ok(url.includes('amount-in-cents=6800000'), 'amount = total × 100');
  assert.ok(url.includes('public-key=pub_test_abc'));
  assert.ok(url.includes(`reference=${REF}`));
  assert.ok(url.includes(`signature:integrity=${expectedSig}`), 'integrity signed with server amount');
  assert.ok(url.includes('redirect-url='), 'redirect-url derived from env.URL');

  assert.equal(saved.length, 1);
  assert.equal(saved[0].amountInCents, 6800000);
  assert.equal(saved[0].status, 'pending');
  assert.equal(saved[0].bookingCode, 'EST-1');
  assert.equal(saved[0].items.length, 2);
});

test('createGuestWompiCheckout refuses when Wompi is not configured', async () => {
  await assert.rejects(
    gp.createGuestWompiCheckout(
      { record: { eventId: REF, total: 1000, items: [] }, bookingCode: 'X' },
      { env: {}, saveIntent: async () => {} }
    ),
    /no está configurado/i
  );
});

function tx(over = {}) {
  return { id: 'tx_1', reference: REF, amount_in_cents: 6800000, status: 'APPROVED', ...over };
}

test('handleGuestServicePayment posts folio + payment and marks the intent paid', async () => {
  const folioCalls = [];
  const marks = [];
  const res = await handleGuestServicePayment(tx(), {}, {
    loadIntent: async () => ({ reference: REF, bookingCode: 'EST-1', amountInCents: 6800000, status: 'pending',
      items: [{ name: 'Desayuno', unitPrice: 20000, quantity: 1 }] }),
    markIntentStatus: async (ref, status, extra) => { marks.push({ status, extra }); },
    postOrderToFolio: async (arg) => { folioCalls.push(arg); return { posted: true, paymentPosted: true }; }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(folioCalls.length, 1);
  assert.equal(folioCalls[0].idReservations, 'EST-1');
  assert.equal(folioCalls[0].payment.amount, 68000, 'payment amount = cents / 100');
  assert.equal(marks[marks.length - 1].status, 'paid');
});

test('handleGuestServicePayment is idempotent for an already-paid intent', async () => {
  let folio = 0;
  const res = await handleGuestServicePayment(tx(), {}, {
    loadIntent: async () => ({ status: 'paid', amountInCents: 6800000 }),
    markIntentStatus: async () => {},
    postOrderToFolio: async () => { folio++; return {}; }
  });
  assert.equal(folio, 0, 'no folio post when already paid');
  assert.equal(JSON.parse(res.body).duplicate, true);
});

test('handleGuestServicePayment refuses an amount mismatch (defense in depth)', async () => {
  let folio = 0;
  const marks = [];
  await handleGuestServicePayment(tx({ amount_in_cents: 9999999 }), {}, {
    loadIntent: async () => ({ status: 'pending', amountInCents: 6800000, bookingCode: 'EST-1', items: [] }),
    markIntentStatus: async (ref, status) => { marks.push(status); },
    postOrderToFolio: async () => { folio++; return {}; }
  });
  assert.equal(folio, 0, 'no folio post on amount mismatch');
  assert.ok(marks.includes('amount_mismatch'));
});

test('handleGuestServicePayment flags a folio failure for manual follow-up (no auto-retry)', async () => {
  const marks = [];
  await handleGuestServicePayment(tx(), {}, {
    loadIntent: async () => ({ status: 'pending', amountInCents: 6800000, bookingCode: 'EST-1',
      items: [{ name: 'X', unitPrice: 68000, quantity: 1 }] }),
    markIntentStatus: async (ref, status) => { marks.push(status); },
    postOrderToFolio: async () => { throw new Error('OTASync down'); }
  });
  assert.ok(marks.includes('paid_folio_failed'));
});

test('handleGuestServicePayment skips silently when the intent is missing', async () => {
  let folio = 0;
  const res = await handleGuestServicePayment(tx(), {}, {
    loadIntent: async () => null,
    markIntentStatus: async () => {},
    postOrderToFolio: async () => { folio++; return {}; }
  });
  assert.equal(folio, 0);
  assert.equal(res.statusCode, 200);
});

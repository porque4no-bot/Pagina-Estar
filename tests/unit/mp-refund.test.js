/* Tema 5 — Mercado Pago refund executor. Mercado Pago is the only provider with
 * a refund API, so an approved GATEWAY_AUTO refund can be sent automatically.
 * fetch is injected so these run with no network and no real money. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { refundMercadoPago } = require('../../netlify/functions/_mp-refund');

/* A fake fetch that records the request and returns a canned MP response. */
function fakeFetch(response, capture) {
  return async (url, opts) => {
    if (capture) { capture.url = url; capture.opts = opts; }
    return {
      ok: response.ok !== false,
      status: response.status || 201,
      json: async () => response.body
    };
  };
}

test('full refund omits the body so MP refunds the whole payment', async () => {
  const cap = {};
  const r = await refundMercadoPago({
    paymentId: '123456', amountCents: 50000, originalAmountCents: 50000,
    accessToken: 'TEST', fetchImpl: fakeFetch({ body: { id: 9, status: 'approved', amount: 500 } }, cap)
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'approved');
  assert.equal(r.refundId, '9');
  assert.equal(cap.opts.body, undefined); // full refund → no body
  assert.equal(cap.url, 'https://api.mercadopago.com/v1/payments/123456/refunds');
  assert.ok(cap.opts.headers['X-Idempotency-Key']);
  assert.match(cap.opts.headers.Authorization, /^Bearer TEST$/);
});

test('partial refund sends the amount in pesos (not cents)', async () => {
  const cap = {};
  const r = await refundMercadoPago({
    paymentId: '123456', amountCents: 30000, originalAmountCents: 50000,
    accessToken: 'TEST', fetchImpl: fakeFetch({ body: { id: 10, status: 'in_process', amount: 300 } }, cap)
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'in_process');
  assert.deepEqual(JSON.parse(cap.opts.body), { amount: 300 });
});

test('an MP HTTP error is reported, not thrown', async () => {
  const r = await refundMercadoPago({
    paymentId: '123456', amountCents: 50000, accessToken: 'TEST',
    fetchImpl: fakeFetch({ ok: false, status: 400, body: { message: 'already refunded' } })
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'mp_error_400');
  assert.equal(r.detail, 'already refunded');
});

test('a rejected refund is not ok', async () => {
  const r = await refundMercadoPago({
    paymentId: '123456', amountCents: 50000, accessToken: 'TEST',
    fetchImpl: fakeFetch({ body: { id: 11, status: 'rejected' } })
  });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'rejected');
});

test('missing token or payment id fails closed without a network call', async () => {
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.equal((await refundMercadoPago({ paymentId: '1', amountCents: 100, fetchImpl: spy })).error, 'missing_access_token');
  assert.equal((await refundMercadoPago({ amountCents: 100, accessToken: 'T', fetchImpl: spy })).error, 'missing_payment_id');
  assert.equal((await refundMercadoPago({ paymentId: '1', amountCents: 0, accessToken: 'T', fetchImpl: spy })).error, 'invalid_amount');
  assert.equal(called, false);
});

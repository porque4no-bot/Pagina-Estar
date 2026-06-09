/* Unit tests for /api/booking-status — the polling endpoint the cliente uses
 * to learn when the payment webhook has finished creating the reservation. */

const test = require('node:test');
const assert = require('node:assert/strict');

function load(stubs) {
  const blobsPath = require.resolve('@netlify/blobs');
  const rateLimitPath = require.resolve('../../netlify/functions/_rate-limit');
  const fnPath = require.resolve('../../netlify/functions/booking-status');

  const originalBlobs = require.cache[blobsPath];
  const originalRate = require.cache[rateLimitPath];

  require.cache[blobsPath] = {
    id: blobsPath, filename: blobsPath, loaded: true,
    exports: { getStore: () => stubs.store }
  };
  require.cache[rateLimitPath] = {
    id: rateLimitPath, filename: rateLimitPath, loaded: true,
    exports: {
      checkRateLimit: async () => stubs.rateLimit || { ok: true },
      rateLimitResponse: (h, retry) => ({
        statusCode: 429, headers: h,
        body: JSON.stringify({ error: 'rate limited', retryAfter: retry })
      })
    }
  };
  delete require.cache[fnPath];
  const fn = require('../../netlify/functions/booking-status');

  if (originalBlobs) require.cache[blobsPath] = originalBlobs; else delete require.cache[blobsPath];
  if (originalRate) require.cache[rateLimitPath] = originalRate; else delete require.cache[rateLimitPath];
  delete require.cache[fnPath];
  return fn;
}

function event(ref) {
  return {
    httpMethod: 'GET',
    queryStringParameters: ref ? { ref } : {},
    headers: { 'x-forwarded-for': '1.2.3.4' }
  };
}

test('returns 400 for missing ref', async () => {
  const fn = load({ store: { get: async () => null } });
  const res = await fn.handler(event());
  assert.equal(res.statusCode, 400);
});

test('returns 400 for invalid ref characters', async () => {
  const fn = load({ store: { get: async () => null } });
  const res = await fn.handler(event('not safe!'));
  assert.equal(res.statusCode, 400);
});

test('returns pending when the booking-results entry is missing', async () => {
  const fn = load({ store: { get: async () => null } });
  const res = await fn.handler(event('EST-ABC12'));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'pending');
  assert.equal(body.ref, 'EST-ABC12');
});

test('returns confirmed when the webhook has written the booking', async () => {
  const persisted = {
    bookingCode: 2918797,
    otasyncId: 2918797,
    provider: 'wompi',
    transactionId: 'tx-1',
    createdAt: '2026-06-09T03:00:00.000Z'
  };
  const fn = load({ store: { get: async () => JSON.stringify(persisted) } });
  const res = await fn.handler(event('EST-ABC12'));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'confirmed');
  assert.equal(body.bookingCode, 2918797);
  assert.equal(body.otasyncId, 2918797);
  assert.equal(body.reservationPending, false);
});

test('returns confirmed + reservationPending when webhook flagged manual follow-up', async () => {
  const persisted = {
    bookingCode: 'EST-XYZ99',
    reservationPending: true,
    reason: 'availability_check_failed'
  };
  const fn = load({ store: { get: async () => JSON.stringify(persisted) } });
  const res = await fn.handler(event('EST-XYZ99'));
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'confirmed');
  assert.equal(body.reservationPending, true);
  assert.equal(body.reason, 'availability_check_failed');
});

test('honors the rate-limiter', async () => {
  const fn = load({ store: { get: async () => null }, rateLimit: { ok: false, retryAfter: 42 } });
  const res = await fn.handler(event('EST-ABC12'));
  assert.equal(res.statusCode, 429);
});

test('rejects non-GET methods', async () => {
  const fn = load({ store: { get: async () => null } });
  const res = await fn.handler({ httpMethod: 'POST', queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 405);
});

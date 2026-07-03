/* Frente A — discount integration in _direct-pricing. Verifies that a
 * server-validated discount lowers the expected (signed) amount and that the
 * full price is rejected once a discount applies. OTASync is mocked via fetch;
 * the discount store is an injected in-memory fake (opts.deps), so no real
 * Blobs nor network. */

const test = require('node:test');
const assert = require('node:assert/strict');
const dstore = require('../../netlify/functions/_discount-store');

/* In-memory blobs fake (mirrors discount-store.test.js). */
function makeBlobs() {
  const buckets = new Map();
  function bucketFor(name) { if (!buckets.has(name)) buckets.set(name, new Map()); return buckets.get(name); }
  let etagSeq = 1;
  function getStore(opts) {
    const b = bucketFor(opts.name);
    return {
      async get(key) { const v = b.get(key); return v ? v.data : null; },
      async getWithMetadata(key) { const v = b.get(key); return v ? { data: v.data, etag: v.etag } : null; },
      async set(key, data, options) {
        const cur = b.get(key);
        if (options && options.onlyIfMatch && (!cur || cur.etag !== options.onlyIfMatch)) return { modified: false };
        if (options && options.onlyIfNew && cur) return { modified: false };
        b.set(key, { data, etag: 'e' + (etagSeq++) });
        return { modified: true };
      },
      async delete(key) { b.delete(key); },
      async list() { return { blobs: [...b.keys()].map(k => ({ key: k })) }; }
    };
  }
  return { getStore };
}

function withMockedFetch(roomsResponse, run) {
  const originalFetch = global.fetch;
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN, OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD, OTASYNC_PROPERTY_ID: process.env.OTASYNC_PROPERTY_ID
  };
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';
  process.env.OTASYNC_PROPERTY_ID = '9889';

  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];

  global.fetch = async (url) => {
    if (url.endsWith('/api/user/auth/login')) {
      return new Response(JSON.stringify({ pkey: 'test-pkey' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/engine/data/getRooms')) {
      return new Response(JSON.stringify(roomsResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected fetch in mock: ' + url);
  };

  return Promise.resolve(run()).finally(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  });
}

/* 200k/night, 1 guest, 2 nights, no extras -> best subtotal = 400000 (40000000 cents). */
const OTA_200K = {
  rooms: [{
    id_room_types: 31348, avail: 3, price: 0,
    pricing_plans: [{ prices: [{ prices: { '2026-07-01': 200000, '2026-07-02': 200000 } }] }]
  }]
};
const DECODED = { checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 1, roomTypeId: '31348', extrasMask: '000000', email: 'guest@x.co' };

test('no discount code: finalSubtotals == expectedSubtotals', async () => {
  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED);
    assert.deepEqual(totals.finalSubtotals, totals.expectedSubtotals);
    assert.equal(totals.discount.applied, false);
  });
});

test('valid 10% code lowers the expected amount; full price is rejected, discounted price accepted', async () => {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore };
  await dstore.saveCode(dstore.buildDefinition({ code: 'TEN', type: 'percent', value: 10, active: true }).def, deps);

  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals, verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED, { discountCode: 'TEN', deps });
    assert.equal(totals.discount.applied, true);
    /* best 400000 -10% = 360000 */
    assert.equal(totals.finalSubtotals[0], 360000);

    /* Full price (40000000 cents) must be REJECTED once a discount applies. */
    const full = await verifyDirectBookingAmount(DECODED, 40000000, { discountCode: 'TEN', deps });
    assert.equal(full.ok, false);
    assert.equal(full.reason, 'price_mismatch');

    /* Discounted price (36000000 cents) is accepted. */
    const ok = await verifyDirectBookingAmount(DECODED, 36000000, { discountCode: 'TEN', deps });
    assert.equal(ok.ok, true);
    assert.equal(ok.discount.applied, true);
  });
});

test('fixed-amount code subtracts a flat value', async () => {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore };
  /* $50.000 off */
  await dstore.saveCode(dstore.buildDefinition({ code: 'FLAT50', type: 'fixed', value: 50000, active: true }).def, deps);

  await withMockedFetch(OTA_200K, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    /* best 400000 - 50000 = 350000 -> 35000000 cents */
    const ok = await verifyDirectBookingAmount(DECODED, 35000000, { discountCode: 'FLAT50', deps });
    assert.equal(ok.ok, true);
  });
});

test('invalid/unknown code does not discount and full price still passes', async () => {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore }; /* nothing saved */

  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals, verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED, { discountCode: 'GHOST', deps });
    assert.equal(totals.discount.applied, false);
    assert.equal(totals.discount.reason, 'not_found');
    /* finalSubtotals fall back to full price -> a correct full-price payment is accepted */
    const ok = await verifyDirectBookingAmount(DECODED, 40000000, { discountCode: 'GHOST', deps });
    assert.equal(ok.ok, true);
  });
});

test('expired code is not applied (reason surfaced in discount.reason)', async () => {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore };
  await dstore.saveCode(dstore.buildDefinition({ code: 'OLD', type: 'percent', value: 10, active: true, validTo: '2020-01-01' }).def, deps);

  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED, { discountCode: 'OLD', deps });
    assert.equal(totals.discount.applied, false);
    assert.equal(totals.discount.reason, 'expired');
  });
});

test('blackout dates block the discount for an overlapping stay', async () => {
  const blobs = makeBlobs();
  const deps = { getStore: blobs.getStore };
  await dstore.saveCode(dstore.buildDefinition({
    code: 'FERIA', type: 'percent', value: 20, active: true,
    blackoutDates: [{ from: '2026-07-01', to: '2026-07-05' }]
  }).def, deps);

  await withMockedFetch(OTA_200K, async () => {
    const { computeDirectBookingTotals } = require('../../netlify/functions/_direct-pricing');
    const totals = await computeDirectBookingTotals(DECODED, { discountCode: 'FERIA', deps });
    assert.equal(totals.discount.applied, false);
    assert.equal(totals.discount.reason, 'blackout');
  });
});

/* Seguridad (hallazgo de la validación): el plan tarifario se deriva del MONTO
   pagado en el servidor, no de la referencia del cliente. best 400000 (Estricta)
   vs flexible round(200000*1.10)*2 = 440000. */
test('matchedPlan: pagar Estricta → best; pagar Flexible → flexible', async () => {
  await withMockedFetch(OTA_200K, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const best = await verifyDirectBookingAmount(DECODED, 40000000); // precio Estricta
    assert.equal(best.ok, true);
    assert.equal(best.matchedPlan, 'best');
    const flex = await verifyDirectBookingAmount(DECODED, 44000000); // precio Flexible (+10%)
    assert.equal(flex.ok, true);
    assert.equal(flex.matchedPlan, 'flexible');
  });
});

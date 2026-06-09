/* Unit tests for the server-side pricing helper getDynamicPricing in _otasync.
 * Validates that the cliente cannot supply an arbitrary paidAmount and have
 * it become the reservation total — the OTASync API response is the truth. */

const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');
const Module = require('node:module');

function withMockedOtasyncFetch(roomsResponse, run) {
  const originalFetch = global.fetch;
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD,
    OTASYNC_PROPERTY_ID: process.env.OTASYNC_PROPERTY_ID
  };
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';
  process.env.OTASYNC_PROPERTY_ID = '9889';

  /* Drop the cached module so the fresh fetch mock is picked up. */
  const resolved = require.resolve('../../netlify/functions/_otasync');
  delete require.cache[resolved];

  global.fetch = async (url) => {
    if (url.endsWith('/api/user/auth/login')) {
      return new Response(JSON.stringify({ pkey: 'test-pkey' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.endsWith('/api/engine/data/getRooms')) {
      return new Response(JSON.stringify(roomsResponse), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error('Unexpected fetch in mock: ' + url);
  };

  return Promise.resolve(run()).finally(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[resolved];
  });
}

test('getDynamicPricing returns isMock when OTASync credentials are missing', async () => {
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD
  };
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
  const resolved = require.resolve('../../netlify/functions/_otasync');
  delete require.cache[resolved];

  try {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    const result = await getDynamicPricing('2026-07-01', '2026-07-03', 2);
    assert.equal(result.isMock, true);
    assert.deepEqual(result.byRoomType, {});
    assert.equal(result.nights, 2);
  } finally {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[resolved];
  }
});

test('getDynamicPricing computes avgPrice from pricing_plans daily prices and adds extra guest surcharge', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{
        prices: [{
          prices: {
            '2026-07-01': 200000,
            '2026-07-02': 250000
          }
        }]
      }]
    }]
  };

  await withMockedOtasyncFetch(otaResponse, async () => {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    const result = await getDynamicPricing('2026-07-01', '2026-07-03', 3);

    assert.equal(result.isMock, false);
    assert.equal(result.nights, 2);
    const room = result.byRoomType['31348'];
    assert.ok(room);
    /* Daily average = (200000 + 250000) / 2 = 225000.
       Plus 2 extra guests beyond first = 2 * 31000 = 62000.
       avgPrice = 287000, total = 287000 * 2 nights = 574000. */
    assert.equal(room.avgPrice, 287000);
    assert.equal(room.totalPrice, 574000);
    assert.equal(room.available, true);
    assert.equal(room.nights, 2);
  });
});

test('getDynamicPricing falls back to flat room.price when pricing_plans missing', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31349,
      avail: 1,
      price: 180000
    }]
  };

  await withMockedOtasyncFetch(otaResponse, async () => {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    const result = await getDynamicPricing('2026-07-01', '2026-07-04', 1);
    const room = result.byRoomType['31349'];
    /* 180000 + 0 surcharge (1 guest), 3 nights. */
    assert.equal(room.avgPrice, 180000);
    assert.equal(room.totalPrice, 540000);
  });
});

test('getDynamicPricing falls back to PRICE_FALLBACK when both pricing sources are absent', async () => {
  const otaResponse = { rooms: [{ id_room_types: 31350, avail: 1 }] };

  await withMockedOtasyncFetch(otaResponse, async () => {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    const result = await getDynamicPricing('2026-07-01', '2026-07-02', 2);
    const room = result.byRoomType['31350'];
    /* 195000 fallback + 31000 (1 extra guest) = 226000 * 1 night. */
    assert.equal(room.avgPrice, 226000);
    assert.equal(room.totalPrice, 226000);
  });
});

test('getDynamicPricing marks rooms with zero availability as not available', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31352,
      avail: 0,
      price: 250000
    }]
  };

  await withMockedOtasyncFetch(otaResponse, async () => {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    const result = await getDynamicPricing('2026-07-01', '2026-07-02', 1);
    assert.equal(result.byRoomType['31352'].available, false);
    /* Pricing is still computed so the cliente knows the rate even when unbookable. */
    assert.equal(result.byRoomType['31352'].avgPrice, 250000);
  });
});

test('getDynamicPricing throws when OTASync responds with a non-2xx status', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD
  };
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';

  const resolved = require.resolve('../../netlify/functions/_otasync');
  delete require.cache[resolved];

  global.fetch = async (url) => {
    if (url.endsWith('/api/user/auth/login')) {
      return new Response(JSON.stringify({ pkey: 'test-pkey' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('boom', { status: 500 });
  };

  try {
    const { getDynamicPricing } = require('../../netlify/functions/_otasync');
    await assert.rejects(
      () => getDynamicPricing('2026-07-01', '2026-07-02', 1),
      /getRooms .*returned status 500/
    );
  } finally {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[resolved];
  }
});

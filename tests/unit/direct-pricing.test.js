/* Unit tests for _direct-pricing: server-side recompute that guards against
 * client-side price tampering on direct (non-quote) Wompi bookings. */

const test = require('node:test');
const assert = require('node:assert/strict');

function encodeRef(parts) {
  /* Mirror the front-end URL-safe base64 used in motor-app.jsx. */
  return Buffer.from(parts.join('|'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function withMockedFetch(roomsResponse, run) {
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

  /* Force re-evaluation so the mocked fetch is picked up. */
  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];

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
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  });
}

test('decodeDirectReference round-trips a frontend-encoded payload', () => {
  const { decodeDirectReference } = require('../../netlify/functions/_direct-pricing');
  const ref = encodeRef(['1', '260701', '260703', '2', '31348', 'Ana', 'Lopez', 'a@b.co', '+57 300 000 0000', '100000', 'EST-ABCDE', '1', '0']);
  const decoded = decodeDirectReference(ref);
  assert.equal(decoded.checkin, '2026-07-01');
  assert.equal(decoded.checkout, '2026-07-03');
  assert.equal(decoded.guestsCount, 2);
  assert.equal(decoded.roomTypeId, '31348');
  assert.equal(decoded.extrasMask, '100000');
  assert.equal(decoded.bookingCode, 'EST-ABCDE');
  assert.equal(decoded.isColombian, true);
  assert.equal(decoded.isBusiness, false);
});

test('decodeDirectReference rejects non-base64 garbage', () => {
  const { decodeDirectReference } = require('../../netlify/functions/_direct-pricing');
  assert.equal(decodeDirectReference('not!base64'), null);
  assert.equal(decodeDirectReference(''), null);
  assert.equal(decodeDirectReference(null), null);
});

test('computeExtrasTotal: breakfast/parking fixed, late (15%) and early (35%) as % of base nightly', () => {
  const { computeExtrasTotal } = require('../../netlify/functions/_direct-pricing');
  /* mask = desayuno+parqueadero+late+early, guests=2, nights=3, base 200k */
  const total = computeExtrasTotal('1111000', 2, 3, 200000);
  // desayuno: 20000 * 2 * 3 = 120000
  // parqueadero: 25000 * 3 = 75000
  // late: 15% of 200000 = 30000
  // early: 35% of 200000 = 70000
  assert.equal(total, 120000 + 75000 + 30000 + 70000);
});

test('computeExtrasTotal: mascota is a flat $200k charge regardless of nights', () => {
  const { computeExtrasTotal } = require('../../netlify/functions/_direct-pricing');
  assert.equal(computeExtrasTotal('0000001', 1, 5, 300000), 200000);
});

test('computeExtrasTotal is zero when mask is all zeros or missing', () => {
  const { computeExtrasTotal } = require('../../netlify/functions/_direct-pricing');
  assert.equal(computeExtrasTotal('0000000', 2, 3, 200000), 0);
  assert.equal(computeExtrasTotal('', 2, 3, 200000), 0);
});

test('verifyDirectBookingAmount accepts the Best Price (avgPrice) total', async () => {
  /* Mock OTASync returning 220k/night for room 31348. With 2 guests, the
     extra-guest surcharge adds 31k/night -> 251k/night. 2 nights, no extras
     -> expected best subtotal = 251000 * 2 = 502000 (50200000 cents). */
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 220000, '2026-07-02': 220000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2,
      roomTypeId: '31348', extrasMask: '000000'
    };
    const verdict = await verifyDirectBookingAmount(decoded, 50200000);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.reason, 'match');
  });
});

test('verifyDirectBookingAmount accepts the Flexible rate (best * 1.10)', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 220000, '2026-07-02': 220000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2,
      roomTypeId: '31348', extrasMask: '000000'
    };
    /* Flexible nightly = round(251000 * 1.10) = 276100. Subtotal 2 nights = 552200. */
    const flexibleCents = 276100 * 2 * 100;
    const verdict = await verifyDirectBookingAmount(decoded, flexibleCents);
    assert.equal(verdict.ok, true);
  });
});

test('verifyDirectBookingAmount rejects a tampered low amount', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 220000, '2026-07-02': 220000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2,
      roomTypeId: '31348', extrasMask: '000000'
    };
    /* Attacker tries to pay 100 pesos for a 502k room. */
    const verdict = await verifyDirectBookingAmount(decoded, 10000);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'price_mismatch');
    assert.equal(verdict.expectedCents, 50200000);
  });
});

test('verifyDirectBookingAmount returns isMock when OTASync credentials are missing', async () => {
  const originalEnv = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD
  };
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;

  const otaPath = require.resolve('../../netlify/functions/_otasync');
  const dpPath = require.resolve('../../netlify/functions/_direct-pricing');
  delete require.cache[otaPath];
  delete require.cache[dpPath];

  try {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2,
      roomTypeId: '31348', extrasMask: '000000'
    };
    const verdict = await verifyDirectBookingAmount(decoded, 999); // arbitrary
    assert.equal(verdict.ok, true);
    assert.equal(verdict.isMock, true);
    assert.equal(verdict.reason, 'mock_fallback');
  } finally {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[otaPath];
    delete require.cache[dpPath];
  }
});

test('verifyDirectBookingAmount accepts extras added correctly to room total', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 200000, '2026-07-02': 200000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 1,
      roomTypeId: '31348',
      extrasMask: '110000' /* desayuno + parqueadero */
    };
    /* Best nightly 200k, 2 nights -> 400000.
       Breakfast 20k * 1 guest * 2 nights = 40000; parking 25k * 2 = 50000.
       Expected subtotal = 490000 -> 49000000 cents. */
    const verdict = await verifyDirectBookingAmount(decoded, 49000000);
    assert.equal(verdict.ok, true);
  });
});

test('verifyDirectBookingAmount accepts late check-out (%) + mascota (flat)', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 3,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 200000, '2026-07-02': 200000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 1,
      roomTypeId: '31348',
      extrasMask: '0010001' /* late (idx2) + mascota (idx6) */
    };
    /* Base nightly 200k, 2 nights -> 400000.
       Late check-out 15% of 200000 = 30000; mascota flat 200000.
       Expected subtotal = 630000 -> 63000000 cents. */
    const verdict = await verifyDirectBookingAmount(decoded, 63000000);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.reason, 'match');
  });
});

test('verifyDirectBookingAmount returns room_not_found when roomTypeId is absent', async () => {
  const otaResponse = { rooms: [{ id_room_types: 31349, avail: 1, price: 195000 }] };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-02', guestsCount: 1,
      roomTypeId: '99999', extrasMask: '000000'
    };
    const verdict = await verifyDirectBookingAmount(decoded, 19500000);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'room_not_found');
  });
});

test('decodeDirectReference round-trips a reference with amountCents', () => {
  const { decodeDirectReference } = require('../../netlify/functions/_direct-pricing');
  const ref = encodeRef(['1', '260701', '260703', '2', '31348', 'Ana', 'Lopez', 'a@b.co', '+57 300 000 0000', '100000', 'EST-ABCDE', '1', '0', '50200000']);
  const decoded = decodeDirectReference(ref);
  assert.equal(decoded.checkin, '2026-07-01');
  assert.equal(decoded.checkout, '2026-07-03');
  assert.equal(decoded.amountCents, 50200000);
});

test('verifyDirectBookingAmount returns sold_out when availability is 0', async () => {
  const otaResponse = {
    rooms: [{
      id_room_types: 31348,
      avail: 0,
      price: 0,
      pricing_plans: [{ prices: [{ prices: { '2026-07-01': 220000, '2026-07-02': 220000 } }] }]
    }]
  };

  await withMockedFetch(otaResponse, async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const decoded = {
      checkin: '2026-07-01', checkout: '2026-07-03', guestsCount: 2,
      roomTypeId: '31348', extrasMask: '000000'
    };
    const verdict = await verifyDirectBookingAmount(decoded, 50200000);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'sold_out');
  });
});

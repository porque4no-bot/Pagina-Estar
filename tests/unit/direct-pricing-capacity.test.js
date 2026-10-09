/* Capacidad en el servidor (frente motor): verifyDirectBookingAmount rechaza con
 * reason 'over_capacity' una reserva directa con más huéspedes de los que admite
 * el apartaestudio según rooms_db.json — antes se firmaba (y cobraba) una
 * Clásica para 4. No consulta OTASync para decidirlo. */

const test = require('node:test');
const assert = require('node:assert/strict');

const roomsDb = require('../../rooms_db.json');

function encodeRef(parts) {
  return Buffer.from(parts.join('|'), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function freshModules() {
  for (const m of ['_otasync', '_direct-pricing', 'create-wompi-signature']) {
    delete require.cache[require.resolve(`../../netlify/functions/${m}`)];
  }
}

function withoutOtasync(run) {
  const saved = {
    OTASYNC_TOKEN: process.env.OTASYNC_TOKEN,
    OTASYNC_USERNAME: process.env.OTASYNC_USERNAME,
    OTASYNC_PASSWORD: process.env.OTASYNC_PASSWORD,
    NETLIFY: process.env.NETLIFY,
    NODE_ENV: process.env.NODE_ENV
  };
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
  delete process.env.NETLIFY;
  delete process.env.NODE_ENV;
  freshModules();
  return Promise.resolve(run()).finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    freshModules();
  });
}

test('roomCapacity / capacityViolation leen rooms_db.json', () => {
  const { roomCapacity, capacityViolation } = require('../../netlify/functions/_direct-pricing');
  for (const [id, room] of Object.entries(roomsDb)) {
    assert.equal(roomCapacity(id), Number(room.capacity), id);
  }
  assert.deepEqual(capacityViolation({ roomTypeId: '31348', guestsCount: 4 }), { capacity: 2, guests: 4 });
  assert.equal(capacityViolation({ roomTypeId: '31348', guestsCount: 2 }), null);
  assert.equal(capacityViolation({ roomTypeId: '31349', guestsCount: 5 }), null);
  assert.deepEqual(capacityViolation({ roomTypeId: '31349', guestsCount: 6 }), { capacity: 5, guests: 6 });
  assert.equal(capacityViolation({ roomTypeId: '31351', guestsCount: 3 }), null);
  /* Tipo desconocido: no se bloquea por capacidad (OTASync decide). */
  assert.equal(capacityViolation({ roomTypeId: '99999', guestsCount: 8 }), null);
  assert.equal(roomCapacity('99999'), null);
  /* rooms_db inyectable (pruebas / futuros tipos). */
  assert.deepEqual(capacityViolation({ roomTypeId: '1', guestsCount: 3 }, { 1: { capacity: 2 } }), { capacity: 2, guests: 3 });
});

test('verifyDirectBookingAmount devuelve over_capacity sin consultar OTASync', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; throw new Error('no debe consultar OTASync'); };
  const saved = { t: process.env.OTASYNC_TOKEN, u: process.env.OTASYNC_USERNAME, p: process.env.OTASYNC_PASSWORD };
  process.env.OTASYNC_TOKEN = 'test-token';
  process.env.OTASYNC_USERNAME = 'test-user';
  process.env.OTASYNC_PASSWORD = 'test-password';
  freshModules();
  try {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const verdict = await verifyDirectBookingAmount({
      checkin: '2026-11-01', checkout: '2026-11-03', guestsCount: 4,
      roomTypeId: '31348', extrasMask: '0000000'
    }, 50000000);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'over_capacity');
    assert.equal(verdict.capacity, 2);
    assert.equal(verdict.guests, 4);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    if (saved.t === undefined) delete process.env.OTASYNC_TOKEN; else process.env.OTASYNC_TOKEN = saved.t;
    if (saved.u === undefined) delete process.env.OTASYNC_USERNAME; else process.env.OTASYNC_USERNAME = saved.u;
    if (saved.p === undefined) delete process.env.OTASYNC_PASSWORD; else process.env.OTASYNC_PASSWORD = saved.p;
    freshModules();
  }
});

test('verifyDirectBookingAmount: también en modo mock (sin credenciales) se valida el cupo', async () => {
  await withoutOtasync(async () => {
    const { verifyDirectBookingAmount } = require('../../netlify/functions/_direct-pricing');
    const over = await verifyDirectBookingAmount({
      checkin: '2026-11-01', checkout: '2026-11-03', guestsCount: 3,
      roomTypeId: '31352', extrasMask: '0000000'
    }, 50000000);
    assert.equal(over.reason, 'over_capacity');
    assert.equal(over.ok, false);

    /* Con cupo sigue el camino de siempre (mock_fallback en local). */
    const fits = await verifyDirectBookingAmount({
      checkin: '2026-11-01', checkout: '2026-11-03', guestsCount: 5,
      roomTypeId: '31349', extrasMask: '0000000'
    }, 50000000);
    assert.equal(fits.ok, true);
    assert.equal(fits.reason, 'mock_fallback');
  });
});

test('create-wompi-signature responde 400 { error: "over_capacity" } y no firma', async () => {
  await withoutOtasync(async () => {
    process.env.WOMPI_INTEGRITY_SECRET = 'test_integrity_xxxx';
    process.env.WOMPI_PUBLIC_KEY = 'pub_test_xxxx';
    delete process.env.ALLOWED_ORIGIN;
    const fn = require('../../netlify/functions/create-wompi-signature');
    const reference = encodeRef(['1', '261101', '261103', '4', '31348', 'Ana', 'Lopez', 'a@b.co', '3000000000',
      '0000000', 'EST-CAP01', '1', '0', '50000000', 'B']);
    const res = await fn.handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ reference, amountInCents: 50000000, currency: 'COP' })
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'over_capacity');
    assert.equal(body.signature, undefined);
  });
});

/* insertReservation con deadline (ruta directa de Mercado Pago): los reintentos
 * no pueden pasarse del tiempo de la función de Netlify. Sin deadline (Wompi,
 * cotizaciones) el comportamiento no cambia. fetch mockeado; sin red. */

const test = require('node:test');
const assert = require('node:assert/strict');

const OTA = require.resolve('../../netlify/functions/_otasync');

function withOtasync(fetchImpl, run) {
  const keys = ['OTASYNC_TOKEN', 'OTASYNC_USERNAME', 'OTASYNC_PASSWORD', 'OTASYNC_PROPERTY_ID'];
  const saved = {};
  for (const k of keys) saved[k] = process.env[k];
  process.env.OTASYNC_TOKEN = 'tok';
  process.env.OTASYNC_USERNAME = 'u';
  process.env.OTASYNC_PASSWORD = 'p';
  process.env.OTASYNC_PROPERTY_ID = '9889';
  const origFetch = global.fetch;
  global.fetch = fetchImpl;
  delete require.cache[OTA];
  return Promise.resolve(run()).finally(() => {
    global.fetch = origFetch;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete require.cache[OTA];
  });
}

function fakeOtasync(counter) {
  return async (url) => {
    url = String(url);
    if (url.endsWith('/api/user/auth/login')) {
      return new Response(JSON.stringify({ pkey: 'pkey-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/reservation/insert/reservation')) {
      counter.inserts++;
      return new Response('upstream error', { status: 503 });
    }
    return new Response(JSON.stringify({ reservations: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('insertReservation con deadline corto: un solo intento y falla a tiempo (no reintenta)', async () => {
  const counter = { inserts: 0 };
  await withOtasync(fakeOtasync(counter), async () => {
    const { insertReservation } = require('../../netlify/functions/_otasync');
    const t0 = Date.now();
    await assert.rejects(() => insertReservation({ reference: 'EST-DL1', date_arrival: '2026-11-10' }, { deadlineMs: Date.now() + 2000 }));
    assert.equal(counter.inserts, 1, 'no alcanzaba el tiempo para reintentar');
    assert.ok(Date.now() - t0 < 1900, 'se rindió antes del límite');
  });
});

test('insertReservation sin deadline: conserva los 3 intentos con backoff (Wompi/cotizaciones)', async () => {
  const counter = { inserts: 0 };
  await withOtasync(fakeOtasync(counter), async () => {
    const { insertReservation } = require('../../netlify/functions/_otasync');
    await assert.rejects(() => insertReservation({ reference: 'EST-DL2', date_arrival: '2026-11-10' }));
    assert.equal(counter.inserts, 3);
  });
});

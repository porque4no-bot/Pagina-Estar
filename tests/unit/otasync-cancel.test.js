/* Sprint 1 (Mesa Redonda C3) — cancelReservation: soft-cancel de una reserva en
 * OTASync vía reservation/delete/delete, con reintento+alerta+idempotencia.
 * fetch mockeado; sin red ni Blobs reales. */

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

function loginOk(url) {
  return url.endsWith('/api/user/auth/login')
    ? new Response(JSON.stringify({ pkey: 'pkey-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : null;
}

test('cancelReservation: soft-cancel exitoso devuelve {ok, status:"canceled"}', async () => {
  await withOtasync(async (url) => {
    const login = loginOk(url); if (login) return login;
    if (url.endsWith('/api/reservation/delete/delete')) {
      return new Response(JSON.stringify({ reservation: { id_reservations: 555, status: 'canceled', date_canceled: '2026-06-22 10:00:00' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  }, async () => {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    const r = await cancelReservation('555');
    assert.equal(r.ok, true);
    assert.equal(r.status, 'canceled');
  });
});

test('cancelReservation: 404 es idempotente → {ok:true, alreadyGone:true}', async () => {
  await withOtasync(async (url) => {
    const login = loginOk(url); if (login) return login;
    if (url.endsWith('/api/reservation/delete/delete')) return new Response('', { status: 404 });
    throw new Error('unexpected ' + url);
  }, async () => {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    const r = await cancelReservation('999');
    assert.equal(r.ok, true);
    assert.equal(r.alreadyGone, true);
  });
});

test('cancelReservation: sin credenciales OTASync → no-op {ok:true, isMock:true}', async () => {
  const keys = ['OTASYNC_TOKEN', 'OTASYNC_USERNAME', 'OTASYNC_PASSWORD'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  delete require.cache[OTA];
  try {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    const r = await cancelReservation('123');
    assert.equal(r.ok, true);
    assert.equal(r.isMock, true);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    delete require.cache[OTA];
  }
});

test('cancelReservation: sin id → {ok:false, reason:"no-id"}', async () => {
  await withOtasync(async (url) => loginOk(url) || new Response('', { status: 200 }), async () => {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    const r = await cancelReservation('');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-id');
  });
});

test('cancelReservation: un 4xx (no transitorio) lanza sin reintentar', async () => {
  let deleteCalls = 0;
  await withOtasync(async (url) => {
    const login = loginOk(url); if (login) return login;
    if (url.endsWith('/api/reservation/delete/delete')) { deleteCalls++; return new Response('bad request', { status: 400 }); }
    throw new Error('unexpected ' + url);
  }, async () => {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    await assert.rejects(() => cancelReservation('777'), /status 400/);
    assert.equal(deleteCalls, 1, '4xx no se reintenta');
  });
});

test('cancelReservation: un 5xx transitorio se reintenta y luego tiene éxito', async () => {
  let deleteCalls = 0;
  await withOtasync(async (url) => {
    const login = loginOk(url); if (login) return login;
    if (url.endsWith('/api/reservation/delete/delete')) {
      deleteCalls++;
      if (deleteCalls === 1) return new Response('server error', { status: 503 });
      return new Response(JSON.stringify({ reservation: { status: 'canceled' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('unexpected ' + url);
  }, async () => {
    const { cancelReservation } = require('../../netlify/functions/_otasync');
    const r = await cancelReservation('888');
    assert.equal(r.ok, true);
    assert.equal(deleteCalls, 2, 'reintentó tras el 5xx');
  });
});

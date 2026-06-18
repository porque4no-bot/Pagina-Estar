/* Pase de desayuno Fase 3: upgrade en vivo (agregar desayuno a una reserva sin
 * él). Se ejercita en modo demo (sin OTASync ni Firebase): el endpoint registra
 * la redención como 'upgrade' sin tocar folio (chargedToFolio:false). El cargo
 * real al folio reusa _otasync (ya probado) y va detrás de
 * BREAKFAST_UPGRADE_ENABLED + credenciales, fuera del alcance de este unit. */

const test = require('node:test');
const assert = require('node:assert/strict');

const blobsPath = require.resolve('@netlify/blobs');
const mem = new Map();
const memStore = {
  async set(key, val, opts) {
    if (opts && opts.onlyIfNew && mem.has(key)) return { modified: false };
    mem.set(key, val);
    return { modified: true };
  },
  async get(key) { return mem.has(key) ? mem.get(key) : null; },
  async list(opts) {
    const prefix = (opts && opts.prefix) || '';
    return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
  }
};
require.cache[blobsPath] = { id: blobsPath, filename: blobsPath, loaded: true, exports: { getStore: () => memStore } };

function forceDemo() {
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
  delete process.env.FIREBASE_PROJECT_ID;   // authenticateStaff bypasea en demo local
  delete process.env.BREAKFAST_UPGRADE_ENABLED;
}
forceDemo();

const upgrade = require('../../netlify/functions/breakfast-upgrade').handler;
const store = require('../../netlify/functions/_breakfast-store');

test.beforeEach(() => { mem.clear(); forceDemo(); });

test('upgrade (demo): agrega desayuno a una reserva sin él y lo registra como upgrade', async () => {
  const res = await upgrade({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-3', persons: 2 }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.added, 2);
  assert.equal(data.amount, 40000);
  assert.equal(data.chargedToFolio, false); // demo: no toca folio

  const reds = await store.getBookingRedemptions('EST-AIRBNB-3', store.todayBogota());
  assert.equal(reds.length, 2);
  assert.equal(reds[0].source, 'upgrade');
});

test('upgrade: rechaza una reserva que ya incluye desayuno (409)', async () => {
  const res = await upgrade({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-DEMO-2026' }) });
  assert.equal(res.statusCode, 409);
});

test('upgrade: sin persons usa la capacidad de la reserva', async () => {
  const res = await upgrade({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-9' }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.added, 2); // demoReservation.capacity = 2
  assert.equal(data.amount, 40000);
});

test('upgrade: es idempotente por persona/día (no duplica)', async () => {
  await upgrade({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-5', persons: 1 }) });
  await upgrade({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-5', persons: 1 }) });
  const reds = await store.getBookingRedemptions('EST-AIRBNB-5', store.todayBogota());
  assert.equal(reds.length, 1);
});

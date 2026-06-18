/* Pase de desayuno Fase 4: agregación de analítica. Mock de @netlify/blobs +
 * modo demo (sin OTASync ni Firebase). Se precargan redenciones y se verifica el
 * resumen: servidos, incluidos vs upgrades, monto, por día y por hora. */

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
  delete process.env.FIREBASE_PROJECT_ID;
}
forceDemo();

const analytics = require('../../netlify/functions/breakfast-analytics').handler;
const store = require('../../netlify/functions/_breakfast-store');

test.beforeEach(() => { mem.clear(); forceDemo(); });

async function seed() {
  await store.recordRedemption({ bookingCode: 'A', guestIndex: 0, date: '2026-06-18', source: 'included' });
  await store.recordRedemption({ bookingCode: 'A', guestIndex: 1, date: '2026-06-18', source: 'included' });
  await store.recordRedemption({ bookingCode: 'B', guestIndex: 0, date: '2026-06-19', source: 'upgrade' });
}

test('analytics: agrega servidos, incluidos vs upgrades y monto', async () => {
  await seed();
  const res = await analytics({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ fromDate: '2026-06-01', toDate: '2026-06-30' }) });
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.served, 3);
  assert.equal(d.included, 2);
  assert.equal(d.upgrades, 1);
  assert.equal(d.upgradeAmount, 20000);
  assert.equal(d.toLiquidate, 3);
});

test('analytics: agrupa por día y por hora (la suma cuadra con el total)', async () => {
  await seed();
  const res = await analytics({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ fromDate: '2026-06-01', toDate: '2026-06-30' }) });
  const d = JSON.parse(res.body);
  assert.equal(d.byDay['2026-06-18'], 2);
  assert.equal(d.byDay['2026-06-19'], 1);
  const totalByHour = Object.values(d.byHour).reduce((a, b) => a + b, 0);
  assert.equal(totalByHour, 3);
});

test('analytics: respeta el rango de fechas', async () => {
  await seed();
  const res = await analytics({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ fromDate: '2026-06-19', toDate: '2026-06-30' }) });
  const d = JSON.parse(res.body);
  assert.equal(d.served, 1);     // solo el del 19
  assert.equal(d.upgrades, 1);
  assert.equal(d.included, 0);
});

test('analytics: es solo-admin — fuera de demo, sin token => 401 (el comedor no ve la caja)', async () => {
  // Con FIREBASE_PROJECT_ID se apaga el bypass demo y rige authenticateAdmin.
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  try {
    const res = await analytics({ httpMethod: 'POST', headers: {}, body: '{}' });
    assert.equal(res.statusCode, 401);
  } finally {
    delete process.env.FIREBASE_PROJECT_ID;
  }
});

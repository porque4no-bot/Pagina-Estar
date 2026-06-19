/* Panel admin de desayunos (#4): tablero del día (breakfast-day), cortesías
 * (breakfast-courtesy) y analítica con cortesías. Mock de @netlify/blobs + modo
 * demo (sin OTASync ni Firebase, para que pasen los gates de auth en local). */

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

const day = require('../../netlify/functions/breakfast-day').handler;
const courtesy = require('../../netlify/functions/breakfast-courtesy').handler;
const analytics = require('../../netlify/functions/breakfast-analytics').handler;
const store = require('../../netlify/functions/_breakfast-store');

const ALL = { fromDate: '2000-01-01', toDate: '2100-01-01' };

test.beforeEach(() => { mem.clear(); forceDemo(); });

async function seedDay() {
  await store.recordRedemption({ bookingCode: 'A', guestIndex: 0, guestName: 'Ana', date: '2026-06-18', source: 'included' });
  await store.recordRedemption({ bookingCode: 'A', guestIndex: 1, guestName: 'Ana', date: '2026-06-18', source: 'included' });
  await store.recordRedemption({ bookingCode: 'B', guestIndex: 0, guestName: 'Beto', date: '2026-06-18', source: 'upgrade' });
  await store.recordRedemption({ bookingCode: 'C', guestIndex: 0, guestName: 'Caro', date: '2026-06-18', source: 'courtesy' });
  await store.recordRedemption({ bookingCode: 'A', guestIndex: 0, guestName: 'Ana', date: '2026-06-10', source: 'included' });
}

// ── breakfast-day (tablero "día de desayunos") ──
test('day: agrupa lo servido del día por reserva y resume por fuente + ciclo', async () => {
  await seedDay();
  const res = await day({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ date: '2026-06-18' }) });
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.servedToday, 4);
  assert.equal(d.servedThisCycle, 5); // 4 del 18 + 1 del 10 (mismo mes)
  assert.deepEqual(d.bySource, { included: 2, upgrade: 1, courtesy: 1 });
  assert.equal(d.reservations.length, 3);
  const a = d.reservations.find(r => r.bookingCode === 'A');
  assert.equal(a.count, 2);
  assert.equal(a.guestName, 'Ana');
});

test('day: sin servidos en la fecha devuelve resumen en cero', async () => {
  await seedDay();
  const res = await day({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ date: '2026-07-01' }) });
  const d = JSON.parse(res.body);
  assert.equal(d.servedToday, 0);
  assert.equal(d.reservations.length, 0);
});

// ── breakfast-courtesy ──
test('courtesy: registra una cortesía (source courtesy) en demo, idempotente', async () => {
  const res = await courtesy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-1' }) });
  assert.equal(res.statusCode, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.ok, true);
  assert.equal(d.courtesies, 1);

  const reds = await store.listRedemptions({});
  assert.equal(reds.length, 1);
  assert.equal(reds[0].source, 'courtesy');

  // idempotente: misma persona/día no duplica
  const again = await courtesy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-1', guestIndex: 0 }) });
  const d2 = JSON.parse(again.body);
  assert.equal(d2.courtesies, 0);
  assert.equal(d2.alreadyServed, 1);
});

test('courtesy: cuenta como servido (a liquidar) y como cortesía en la analítica', async () => {
  await courtesy({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ code: 'EST-AIRBNB-1' }) });
  const res = await analytics({ httpMethod: 'POST', headers: {}, body: JSON.stringify(ALL) });
  const d = JSON.parse(res.body);
  assert.equal(d.courtesies, 1);
  assert.equal(d.served, 1);       // cuenta para liquidar al proveedor
  assert.equal(d.toLiquidate, 1);
  assert.equal(d.included, 0);
  assert.equal(d.upgrades, 0);
  assert.equal(d.upgradeAmount, 0); // sin cobro al huésped
});

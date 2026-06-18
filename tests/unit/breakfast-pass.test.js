/* Pase de desayuno Fase 2: token firmado + endpoint público de pases.
 *
 * Se mockea @netlify/blobs (store en memoria) y _rate-limit, y se fuerza el
 * modo demo (sin OTASync) para ejercitar el endpoint sin backend real. */

const test = require('node:test');
const assert = require('node:assert/strict');

// ── Mock de @netlify/blobs ──
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

// ── Mock de _rate-limit (el endpoint lo usa) ──
const rlPath = require.resolve('../../netlify/functions/_rate-limit');
require.cache[rlPath] = {
  id: rlPath, filename: rlPath, loaded: true,
  exports: { checkRateLimit: async () => ({ ok: true }), rateLimitResponse: () => ({ statusCode: 429, body: '{}' }) }
};

function forceDemo() {
  delete process.env.OTASYNC_TOKEN;
  delete process.env.OTASYNC_USERNAME;
  delete process.env.OTASYNC_PASSWORD;
}
forceDemo();

const { signPassToken, verifyPassToken } = require('../../netlify/functions/_breakfast-pass');
const passes = require('../../netlify/functions/breakfast-passes').handler;

test.beforeEach(() => { mem.clear(); forceDemo(); });

// ── Token ──
test('token: firma y verifica una reserva', () => {
  const claims = verifyPassToken(signPassToken('EST-DEMO-2026'));
  assert.ok(claims);
  assert.equal(claims.bookingCode, 'EST-DEMO-2026');
});

test('token: manipulado o basura => null', () => {
  assert.equal(verifyPassToken(signPassToken('EST-1') + 'x'), null);
  assert.equal(verifyPassToken('no-es-un-token'), null);
  assert.equal(verifyPassToken(''), null);
});

test('token: expirado => null', () => {
  assert.equal(verifyPassToken(signPassToken('EST-1', -10)), null);
});

// ── Endpoint ──
test('endpoint: token válido devuelve un pase por persona con desayuno', async () => {
  const res = await passes({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: signPassToken('EST-DEMO-2026') }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.hasBreakfast, true);
  assert.equal(data.passes.length, data.perDay);
  assert.equal(data.passes[0].code, 'EST-DEMO-2026:0');
});

test('endpoint: token inválido => 401', async () => {
  const res = await passes({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: 'bad' }) });
  assert.equal(res.statusCode, 401);
});

test('endpoint: reserva sin desayuno (Airbnb) igual entrega al menos un pase', async () => {
  const res = await passes({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: signPassToken('EST-AIRBNB-1') }) });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.hasBreakfast, false);
  assert.ok(data.passes.length >= 1);
});

test('endpoint: refleja lo ya servido hoy', async () => {
  const store = require('../../netlify/functions/_breakfast-store');
  const today = store.todayBogota();
  await store.recordRedemption({ bookingCode: 'EST-DEMO-2026', guestIndex: 0, date: today });
  const res = await passes({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ token: signPassToken('EST-DEMO-2026') }) });
  const data = JSON.parse(res.body);
  assert.equal(data.passes[0].served, true);
});

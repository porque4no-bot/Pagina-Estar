'use strict';

/* _alert: el dedupe se marca SOLO tras un envío exitoso.
 *
 * Antes: shouldSend() reclamaba la clave (set onlyIfNew) ANTES de enviar; si el
 * correo fallaba (Resend caído, sin llave → sendEmail devuelve {sent:false}, no
 * lanza), la alerta quedaba silenciada una hora sin haber salido nada. */

const { test } = require('node:test');
const assert = require('node:assert');

const { reportAlert } = require('../../netlify/functions/_alert');
const { recentlyAlerted, markAlerted, stableHash } = require('../../netlify/functions/_alert')._test;

function memStore() {
  const m = new Map();
  let etag = 0;
  return {
    _m: m,
    async set(key, value, opts = {}) {
      if (opts.onlyIfNew && m.has(key)) return { modified: false };
      if (opts.onlyIfMatch && (!m.has(key) || m.get(key).etag !== opts.onlyIfMatch)) return { modified: false };
      m.set(key, { value, etag: String(++etag) });
      return { modified: true };
    },
    async getWithMetadata(key) {
      if (!m.has(key)) return null;
      const e = m.get(key);
      return { data: JSON.parse(e.value), etag: e.etag };
    }
  };
}

function deps(store, sendImpl, now = 1_000_000) {
  return {
    sendEmail: sendImpl,
    adminEmail: () => 'team@estar.test',
    getStore: () => store,
    logger: { warn() {}, error() {} },
    now: () => now,
    opsDeps: { getStore: () => null } /* sin cola en este test */
  };
}

test('envío fallido (sent:false) NO marca el dedupe: el siguiente intento sí envía', async () => {
  const store = memStore();
  let attempts = 0;
  const failing = async () => { attempts++; return { sent: false }; };
  const r1 = await reportAlert({ kind: 'k', message: 'm', deps: deps(store, failing) });
  assert.equal(r1.alerted, false);
  assert.equal(r1.reason, 'send_failed');
  assert.equal(await recentlyAlerted(() => store, 'k:' + stableHash('m|{}'), 3600e3, 1_000_000), false, 'el reclamo se liberó');

  const sent = [];
  const ok = async (msg) => { sent.push(msg); return { sent: true }; };
  const r2 = await reportAlert({ kind: 'k', message: 'm', deps: deps(store, ok) });
  assert.equal(r2.alerted, true, 'la alerta que no salió se reintenta y sale');
  assert.equal(sent.length, 1);
  assert.equal(attempts, 1);
});

test('sin RESEND_API_KEY (sent:false, reason no-key) tampoco silencia la alerta', async () => {
  const store = memStore();
  const noKey = async () => ({ sent: false, reason: 'no-key' });
  let calls = 0;
  const counting = async () => { calls++; return noKey(); };
  await reportAlert({ kind: 'k2', message: 'x', deps: deps(store, counting) });
  const r = await reportAlert({ kind: 'k2', message: 'x', deps: deps(store, counting) });
  assert.equal(r.reason, 'send_failed', 'el segundo intento no queda deduplicado');
  assert.equal(calls, 2);
});

test('envío exitoso SÍ marca y deduplica dentro del TTL', async () => {
  const store = memStore();
  const sent = [];
  const ok = async (msg) => { sent.push(msg); return { sent: true, id: 'r1' }; };
  await reportAlert({ kind: 'k3', message: 'y', deps: deps(store, ok) });
  const r = await reportAlert({ kind: 'k3', message: 'y', deps: deps(store, ok) });
  assert.equal(r.reason, 'deduped');
  assert.equal(sent.length, 1);
  assert.equal(store._m.size, 1);
});

test('una excepción al enviar no marca el dedupe', async () => {
  const store = memStore();
  const boom = async () => { throw new Error('resend down'); };
  const r = await reportAlert({ kind: 'k4', message: 'z', deps: deps(store, boom) });
  assert.equal(r.reason, 'error');
  const sent = [];
  const r2 = await reportAlert({ kind: 'k4', message: 'z', deps: deps(store, async (m) => { sent.push(m); return { sent: true }; }) });
  assert.equal(r2.alerted, true, 'tras la excepción la clave quedó liberada');
  assert.equal(sent.length, 1);
});

test('recentlyAlerted es de solo lectura y falla abierto', async () => {
  const store = memStore();
  assert.equal(await recentlyAlerted(() => store, 'fp', 1000, 5000), false);
  assert.equal(store._m.size, 0, 'consultar no escribe');
  await markAlerted(() => store, 'fp', 5000);
  assert.equal(await recentlyAlerted(() => store, 'fp', 1000, 5500), true);
  assert.equal(await recentlyAlerted(() => store, 'fp', 1000, 7000), false, 'vencido el TTL vuelve a avisar');
  assert.equal(await recentlyAlerted(() => { throw new Error('sin blobs'); }, 'fp', 1000, 5500), false);
});

test('dos invocaciones CONCURRENTES con el mismo fingerprint envían un solo correo', async () => {
  const store = memStore();
  const sent = [];
  let releaseSend;
  const gate = new Promise(r => { releaseSend = r; });
  const slow = async (m) => { sent.push(m); await gate; return { sent: true }; };
  const p1 = reportAlert({ kind: 'mp', message: 'fallo reserva', dedupeKey: 'pay:1', deps: deps(store, slow) });
  const p2 = reportAlert({ kind: 'mp', message: 'fallo reserva', dedupeKey: 'pay:1', deps: deps(store, slow) });
  await new Promise(r => setTimeout(r, 10));
  releaseSend();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(sent.length, 1, 'el reclamo atómico evita el duplicado');
  assert.deepEqual([r1.alerted, r2.alerted].sort(), [false, true]);
  assert.equal([r1, r2].find(r => !r.alerted).reason, 'deduped');
});

test('vencido el TTL se re-arma y vuelve a enviar', async () => {
  const store = memStore();
  const sent = [];
  const ok = async (m) => { sent.push(m); return { sent: true }; };
  await reportAlert({ kind: 'k5', message: 'w', deps: deps(store, ok, 1_000_000) });
  await reportAlert({ kind: 'k5', message: 'w', deps: deps(store, ok, 1_000_000 + 3601_000) });
  assert.equal(sent.length, 2);
});

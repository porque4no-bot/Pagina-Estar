/* Sprint 2 (Staff App v2) — cola de tareas operativas: idempotente por dedupeKey,
 * re-abre tras resolver, lista solo abiertas. Blobs en memoria inyectado. */

const test = require('node:test');
const assert = require('node:assert/strict');
const ops = require('../../netlify/functions/_ops-queue');

function makeStore() {
  const m = new Map();
  return {
    store: {
      async get(k) { return m.has(k) ? m.get(k) : null; },
      async set(k, v) { m.set(k, v); return { modified: true }; },
      async delete(k) { m.delete(k); },
      async list({ prefix } = {}) { return { blobs: [...m.keys()].filter(k => !prefix || k.startsWith(prefix)).map(key => ({ key })) }; }
    },
    map: m
  };
}
function deps(s, now) { return { getStore: () => s.store, now: now ? () => now : undefined }; }

test('enqueue crea una tarea abierta', async () => {
  const s = makeStore();
  const r = await ops.enqueue({ kind: 'folio_post_failed', title: 'x', context: { eventId: 'GST-1' }, dedupeKey: 'folio_post_failed:GST-1' }, deps(s));
  assert.equal(r.queued, true);
  const open = await ops.listOpen(deps(s));
  assert.equal(open.length, 1);
  assert.equal(open[0].status, 'open');
  assert.equal(open[0].context.eventId, 'GST-1');
});

test('enqueue es idempotente por dedupeKey (no duplica una tarea abierta)', async () => {
  const s = makeStore();
  await ops.enqueue({ kind: 'k', title: 'a', dedupeKey: 'dup' }, deps(s));
  const second = await ops.enqueue({ kind: 'k', title: 'b', dedupeKey: 'dup' }, deps(s));
  assert.equal(second.queued, false);
  assert.equal(second.reason, 'already-open');
  assert.equal((await ops.listOpen(deps(s))).length, 1);
});

test('resolve marca resuelta y desaparece de listOpen', async () => {
  const s = makeStore();
  await ops.enqueue({ kind: 'k', title: 'a', dedupeKey: 'r1' }, deps(s));
  const r = await ops.resolve('r1', 'admin@x.co', deps(s));
  assert.equal(r.ok, true);
  assert.equal(r.item.status, 'resolved');
  assert.equal(r.item.resolvedBy, 'admin@x.co');
  assert.equal((await ops.listOpen(deps(s))).length, 0);
});

test('una clave resuelta SE RE-ABRE si el fallo reaparece', async () => {
  const s = makeStore();
  await ops.enqueue({ kind: 'k', title: 'a', dedupeKey: 'rec' }, deps(s));
  await ops.resolve('rec', 'admin', deps(s));
  const again = await ops.enqueue({ kind: 'k', title: 'a otra vez', dedupeKey: 'rec' }, deps(s));
  assert.equal(again.queued, true, 'se re-abre');
  const open = await ops.listOpen(deps(s));
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'a otra vez');
});

test('resolve de una tarea inexistente → not-found', async () => {
  const s = makeStore();
  const r = await ops.resolve('ghost', 'admin', deps(s));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-found');
});

test('sin store → best-effort, no lanza', async () => {
  const noStore = { getStore: () => null };
  assert.deepEqual(await ops.enqueue({ kind: 'k', title: 't' }, noStore), { queued: false, reason: 'no-store' });
  assert.deepEqual(await ops.listOpen(noStore), []);
});

/* Sprint 2 (Staff App v2) — staff-ops: reintento de folio (con deps inyectados) +
 * handler (auth + cola mockeados en require.cache). node --test aísla el proceso. */

const test = require('node:test');
const assert = require('node:assert/strict');

const R = (m) => require.resolve('../../netlify/functions/' + m);
function fake(id, exportsObj) { require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj }; }

/* ---- retryFolio (deps inyectados, sin tocar require.cache) ---- */
function folioDeps({ flagOn = true, event, postImpl }) {
  const events = {};
  if (event) events['GST-1'] = event;
  const calls = { posted: 0 };
  return {
    deps: {
      settings: { flag: async () => flagOn },
      guestApp: {
        guestStore: () => ({
          get: async (k) => (events[k] || null),
          setJSON: async (k, v) => { events[k] = v; }
        }),
        unprotectRecord: (r) => r,
        protectRecord: (r) => r
      },
      otasync: { postOrderExtrasToFolio: async () => { calls.posted++; return postImpl ? postImpl() : { posted: true }; } }
    },
    events, calls
  };
}

test('retryFolio: folio deshabilitado → folio-disabled', async () => {
  const { _test } = require('../../netlify/functions/staff-ops');
  const { deps } = folioDeps({ flagOn: false });
  assert.deepEqual(await _test.retryFolio('GST-1', 'a', deps), { ok: false, reason: 'folio-disabled' });
});

test('retryFolio: evento inexistente → not-found', async () => {
  const { _test } = require('../../netlify/functions/staff-ops');
  const { deps } = folioDeps({ event: null });
  assert.deepEqual(await _test.retryFolio('GST-1', 'a', deps), { ok: false, reason: 'not-found' });
});

test('retryFolio: ya posteado → idempotente (no re-postea)', async () => {
  const { _test } = require('../../netlify/functions/staff-ops');
  const { deps, calls } = folioDeps({ event: { bookingCode: 'EST-1', items: [{ name: 'x', quantity: 1 }], folioStatus: 'posted' } });
  const r = await _test.retryFolio('GST-1', 'a', deps);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyPosted, true);
  assert.equal(calls.posted, 0);
});

test('retryFolio: reintento exitoso → posted, actualiza folioStatus del evento', async () => {
  const { _test } = require('../../netlify/functions/staff-ops');
  const { deps, events, calls } = folioDeps({ event: { bookingCode: 'EST-1', items: [{ name: 'Desayuno', quantity: 2 }], folioStatus: 'failed' } });
  const r = await _test.retryFolio('GST-1', 'rec@x.co', deps);
  assert.equal(r.ok, true);
  assert.equal(r.posted, true);
  assert.equal(calls.posted, 1);
  assert.equal(events['GST-1'].folioStatus, 'posted', 'el evento queda marcado posted');
  assert.equal(events['GST-1'].folioRetriedBy, 'rec@x.co');
});

test('retryFolio: el folio sigue fallando → ok:false, no marca posted', async () => {
  const { _test } = require('../../netlify/functions/staff-ops');
  const { deps, events } = folioDeps({ event: { bookingCode: 'EST-1', items: [{ name: 'x', quantity: 1 }], folioStatus: 'failed' }, postImpl: () => ({ posted: false, reason: 'no-room' }) });
  const r = await _test.retryFolio('GST-1', 'a', deps);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-room');
  assert.equal(events['GST-1'].folioStatus, 'failed');
});

/* ---- handler (mocks en require.cache) ---- */
function loadHandler({ authOk = true, perms = ['guests.checkin.view', 'guests.register'], items = [] } = {}) {
  fake(R('_authz'), {
    authorize: async (event, perm) => authOk && (perms.includes(perm))
      ? { ok: true, email: 's@x.co', permissions: perms }
      : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' }
  });
  const resolved = [];
  fake(R('_ops-queue'), {
    listOpen: async () => items,
    resolve: async (id, by) => { resolved.push({ id, by }); return { ok: true }; },
    enqueue: async () => ({ queued: true }),
    getItem: async () => null
  });
  delete require.cache[R('staff-ops')];
  const mod = require('../../netlify/functions/staff-ops');
  return { mod, resolved };
}

test('handler GET: lista tareas abiertas (auth ok)', async () => {
  const { mod } = loadHandler({ items: [{ id: 'a', kind: 'k', status: 'open' }] });
  const res = await mod.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 200);
  const b = JSON.parse(res.body);
  assert.equal(b.count, 1);
  assert.equal(b.items[0].id, 'a');
});

test('handler GET sin permiso → 403', async () => {
  const { mod } = loadHandler({ authOk: false });
  const res = await mod.handler({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 403);
});

test('handler POST resolve → marca resuelta', async () => {
  const { mod, resolved } = loadHandler({});
  const res = await mod.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'resolve', id: 'x1' }) });
  assert.equal(res.statusCode, 200);
  assert.equal(resolved[0].id, 'x1');
  assert.equal(resolved[0].by, 's@x.co');
});

test('handler POST acción inválida → 400', async () => {
  const { mod } = loadHandler({});
  const res = await mod.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'launch' }) });
  assert.equal(res.statusCode, 400);
});

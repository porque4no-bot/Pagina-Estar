/* Frente "Panel Hoy para recepción" — marcar resuelto un "pago sin reserva"
 * (booking-results con reservationPending): escribe resolvedAt/resolvedBy en la
 * misma entrada (sin borrar el histórico), auditado y fail-closed. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { memStores } = require('../helpers/mem-blobs');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

const PENDING = { bookingCode: 'EST-XYZ12', reservationPending: true, reason: 'insert_failed', provider: 'wompi', transactionId: 'tx-1', amountInCents: 100000, createdAt: '2026-10-01T10:00:00Z' };

function setup({ authOk = true, permission = null, entries = { 'direct-EST-XYZ12': JSON.stringify(PENDING) } } = {}) {
  const asked = [];
  fakeModule(P('_authz'), {
    authorize: async (event, perm) => { asked.push(perm); return authOk
      ? { ok: true, email: 'rec@estar.co', permissions: [permission || perm] }
      : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' }; }
  });
  delete require.cache[P('staff-resolve-web-payment')];
  const mod = require('../../netlify/functions/staff-resolve-web-payment');
  const blobs = memStores({ 'booking-results': entries });
  mod._test.resetDeps();
  mod._test.setDeps({ getStore: blobs.getStore, now: () => Date.parse('2026-10-08T15:00:00Z') });
  return { mod, blobs, asked };
}

function post(mod, body, method = 'POST') {
  return mod.handler({ httpMethod: method, headers: { 'x-forwarded-for': '10.0.0.3' }, body: JSON.stringify(body) });
}

test('marca resuelto, conserva el histórico y audita (permiso guests.register)', async () => {
  const { mod, blobs, asked } = setup();
  const r = await post(mod, { webCode: 'est-xyz12', resolution: 'reserva_creada', note: 'Kunas 9300' });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(asked, ['guests.register']);
  const saved = JSON.parse(blobs.stores['booking-results'].data['direct-EST-XYZ12']);
  assert.equal(saved.reservationPending, true, 'el marcador original se conserva');
  assert.equal(saved.transactionId, 'tx-1');
  assert.equal(saved.resolvedAt, '2026-10-08T15:00:00.000Z');
  assert.equal(saved.resolvedBy, 'rec@estar.co');
  assert.equal(saved.resolution, 'reserva_creada');
  assert.equal(saved.resolutionNote, 'Kunas 9300');
  const audit = blobs.stores['staff-audit'];
  const keys = Object.keys(audit.data);
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^web-payment\.resolve\/2026-10-08\//);
  const a = JSON.parse(audit.data[keys[0]]);
  assert.equal(a.actor, 'rec@estar.co');
  assert.equal(a.webCode, 'EST-XYZ12');
  /* Ya resuelto → idempotente, no reescribe ni re-audita. */
  const again = await post(mod, { webCode: 'EST-XYZ12', resolution: 'devuelto' });
  assert.equal(JSON.parse(again.body).alreadyResolved, true);
  assert.equal(Object.keys(audit.data).length, 1);
  /* Lo respeta la vista operativa. */
  const hoy = require('../../netlify/functions/_staff-hoy');
  assert.equal(hoy.paymentFromResult(JSON.parse(blobs.stores['booking-results'].data['direct-EST-XYZ12']), null).status, 'resuelto');
});

test('sin auditoría no marca nada (fail-closed)', async () => {
  const { mod, blobs } = setup();
  blobs.getStore('staff-audit').failSet = true;
  const r = await post(mod, { webCode: 'EST-XYZ12', resolution: 'devuelto' });
  assert.equal(r.statusCode, 503);
  assert.equal(JSON.parse(blobs.stores['booking-results'].data['direct-EST-XYZ12']).resolvedAt, undefined);
});

test('validación: código, resolución, inexistente, no pendiente, método y auth', async () => {
  let s = setup({ entries: { 'direct-EST-OKAY1': JSON.stringify({ provider: 'mercadopago', amountInCents: 1 }) } });
  assert.equal((await post(s.mod, { webCode: 'nope', resolution: 'devuelto' })).statusCode, 400);
  assert.equal((await post(s.mod, { webCode: 'EST-OKAY1', resolution: 'borrar' })).statusCode, 400);
  assert.equal((await post(s.mod, { webCode: 'EST-NOEXI', resolution: 'devuelto' })).statusCode, 404);
  assert.equal((await post(s.mod, { webCode: 'EST-OKAY1', resolution: 'devuelto' })).statusCode, 409);
  assert.equal((await post(s.mod, {}, 'GET')).statusCode, 405);
  s = setup({ authOk: false });
  assert.equal((await post(s.mod, { webCode: 'EST-XYZ12', resolution: 'devuelto' })).statusCode, 403);
});

/* Sprint 1 (Mesa Redonda C3) — cableado en refund-admin-action: al procesar la
 * cancelación (approve/deny) se cierra el lazo cancelando la reserva en OTASync.
 * Gated OFF por defecto, idempotente, solo reservas directas, best-effort+alerta.
 * Se prueba el helper maybeCancelReservationInPms con módulos falsos en cache.
 * (node --test aísla cada archivo en su propio proceso → la cache no se filtra.) */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

function load({ flagOn, cancelImpl, refund }) {
  const transitions = [];
  const alerts = [];

  fakeModule(P('_authz'), {
    authorize: async () => ({ ok: true, email: 'admin@x.co' })
  });
  fakeModule(P('_settings'), {
    flag: async (k) => (k === 'OTASYNC_AUTO_CANCEL_ENABLED' ? !!flagOn : false),
    get: async () => undefined
  });
  fakeModule(P('_refunds-store'), {
    getRefund: async () => refund || null,
    transitionStatus: async (bookingCode, status, by, note, patch) => {
      transitions.push({ bookingCode, status, by, note, patch });
      return { refund: { bookingCode, status, ...(patch || {}) } };
    },
    STATUS: { DONE: 'done', DENIED: 'denied', APPROVED: 'approved', NEEDS_BANK_DETAILS: 'needs_bank', PROCESSING: 'processing', PENDING_PROVIDER: 'pending_provider', FAILED: 'failed' },
    ROUTE: { MANUAL_BANK: 'manual_bank', GATEWAY_AUTO: 'gateway_auto', GATEWAY_ASSISTED: 'gateway_assisted' }
  });
  fakeModule(P('_otasync'), {
    cancelReservation: cancelImpl || (async () => ({ ok: true, status: 'canceled' }))
  });
  fakeModule(P('_alert'), { reportAlert: async (a) => { alerts.push(a); } });

  delete require.cache[P('refund-admin-action')];
  const mod = require('../../netlify/functions/refund-admin-action');
  return { handler: mod.handler, maybeCancel: mod._test.maybeCancelReservationInPms, transitions, alerts };
}

test('flag OFF: no cancela ni transiciona', async () => {
  let called = 0;
  const { maybeCancel, transitions } = load({ flagOn: false, cancelImpl: async () => { called++; return { ok: true }; } });
  const r = await maybeCancel({ bookingCode: 'EST-1', status: 'approved' }, 'admin@x.co');
  assert.equal(r, null);
  assert.equal(called, 0);
  assert.equal(transitions.length, 0);
});

test('flag ON + reserva directa: cancela en OTASync y marca reservationCanceled', async () => {
  let calledWith = null;
  const { maybeCancel, transitions } = load({ flagOn: true, cancelImpl: async (id) => { calledWith = id; return { ok: true, status: 'canceled' }; } });
  const r = await maybeCancel({ bookingCode: 'EST-42', status: 'approved' }, 'admin@x.co');
  assert.equal(r.ok, true);
  assert.equal(calledWith, 'EST-42');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].patch.reservationCanceled, true);
  assert.equal(transitions[0].patch.reservationCancelResult.status, 'canceled');
});

test('flag ON + cotización (COT-): NO cancela (camino de hold/release aparte)', async () => {
  let called = 0;
  const { maybeCancel, transitions } = load({ flagOn: true, cancelImpl: async () => { called++; return { ok: true }; } });
  const r = await maybeCancel({ bookingCode: 'COT-2026-001', status: 'denied' }, 'admin@x.co');
  assert.equal(r, null);
  assert.equal(called, 0);
  assert.equal(transitions.length, 0);
});

test('idempotente: si ya está reservationCanceled, no vuelve a cancelar', async () => {
  let called = 0;
  const { maybeCancel } = load({ flagOn: true, cancelImpl: async () => { called++; return { ok: true }; } });
  const r = await maybeCancel({ bookingCode: 'EST-9', status: 'approved', reservationCanceled: true }, 'admin@x.co');
  assert.equal(r, null);
  assert.equal(called, 0);
});

test('best-effort: si cancelReservation lanza, no rompe (devuelve null) y alerta', async () => {
  const { maybeCancel, alerts, transitions } = load({ flagOn: true, cancelImpl: async () => { throw new Error('OTASync 500'); } });
  const r = await maybeCancel({ bookingCode: 'EST-7', status: 'approved' }, 'admin@x.co');
  assert.equal(r, null);
  assert.equal(transitions.length, 0, 'no marca cancelada si falló');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'otasync_cancel_failed');
  assert.match(alerts[0].dedupeKey, /^otasync-cancel-EST-7$/);
});

test('approve sin amountCents vuelve a validar el tope pagado original', async () => {
  const { handler, transitions } = load({
    flagOn: false,
    refund: {
      bookingCode: 'EST-OVER',
      status: 'NEEDS_REVIEW',
      route: 'gateway_assisted',
      refundAmountCents: 60000,
      originalAmountCents: 50000
    }
  });
  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ bookingCode: 'EST-OVER', action: 'approve' })
  });
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /superar el monto pagado/);
  assert.equal(transitions.length, 0);
});

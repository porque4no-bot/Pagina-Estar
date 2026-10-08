/* Frente "Panel Hoy para recepción" — "Reenviar confirmación": arma el correo
 * SOLO con datos de servidor (reserva de OTASync + pago registrado), ignora lo
 * que mande el cliente, salta el dedupe y audita. Todo con deps falsos. */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_DEMO_MODE = 'true';

const { memStores } = require('../helpers/mem-blobs');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

function booking(over = {}) {
  return {
    bookingCode: '9001', status: 'confirmed', guestName: 'Ana Ríos', guestEmail: 'ana@cliente.co',
    roomName: 'Clásica', checkIn: '2026-10-08', checkOut: '2026-10-10', nights: 2, totalAmount: 450000, capacity: 2,
    raw: { reference: 'EST-ABCDE', phone: '+57 300', total_price: '450000', remaining_amount: '0', email: 'ana@cliente.co' },
    ...over
  };
}

function setup({ authOk = true, found = booking(), sendResult = { sent: true, resendId: 're_1' } } = {}) {
  fakeModule(P('_authz'), {
    authorize: async () => authOk
      ? { ok: true, email: 'rec@estar.co', permissions: ['guests.checkin.view'] }
      : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' }
  });
  fakeModule(P('_rate-limit'), {
    checkRateLimit: async () => ({ ok: true }),
    rateLimitResponse: () => ({ statusCode: 429, headers: {}, body: '{}' })
  });
  delete require.cache[P('staff-resend-confirmation')];
  const mod = require('../../netlify/functions/staff-resend-confirmation');
  const blobs = memStores({
    'booking-results': { 'direct-EST-ABCDE': JSON.stringify({ provider: 'mercadopago', amountInCents: 45000000, createdAt: '2026-10-01T10:00:00Z' }) }
  });
  const sent = [];
  mod._test.resetDeps();
  mod._test.setDeps({
    getStore: blobs.getStore,
    getPaymentDetails: async () => null,
    getReservationDetail: async () => found,
    extractBreakfastEntitlement: () => ({ included: true, perDay: 2 }),
    sendConfirmationEmail: async (params, opts) => { sent.push({ params, opts }); return sendResult; }
  });
  return { mod, blobs, sent };
}

function post(mod, body) {
  return mod.handler({ httpMethod: 'POST', headers: { 'x-forwarded-for': '10.0.0.2' }, body: JSON.stringify(body) });
}

test('reenvía con datos del servidor (ignora correo/montos del cliente), sin dedupe, y audita', async () => {
  const { mod, blobs, sent } = setup();
  const r = await post(mod, { bookingCode: '9001', guestEmail: 'atacante@evil.co', paidAmount: 1 });
  assert.equal(r.statusCode, 200, r.body);
  const b = JSON.parse(r.body);
  assert.equal(b.sent, true);
  assert.equal(b.to, 'an***@cliente.co');
  assert.equal(sent.length, 1);
  const { params, opts } = sent[0];
  assert.equal(params.guestEmail, 'ana@cliente.co', 'destinatario = correo de la reserva');
  assert.equal(params.paidAmount, 450000, 'monto pagado = lo registrado por el webhook');
  assert.equal(params.breakfast, true);
  assert.equal(params.via, 'staff-resend');
  assert.deepEqual(opts, { dedupe: false });
  const audits = Object.values(blobs.stores['staff-audit'].data).map(v => JSON.parse(v));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'confirmation.resend');
  assert.equal(audits[0].actor, 'rec@estar.co');
  assert.equal(audits[0].sent, true);
});

test('sin pago registrado usa total − saldo de OTASync', () => {
  const { _test } = require('../../netlify/functions/staff-resend-confirmation');
  const p = _test.buildConfirmationParams(booking({ raw: { total_price: '300000', remaining_amount: '100000', email: 'a@b.co' }, totalAmount: 300000 }), null, false);
  assert.equal(p.paidAmount, 200000);
  assert.equal(p.guestEmail, 'ana@cliente.co');
});

test('reserva sin correo → 422; no encontrada → 404; cancelada → 409', async () => {
  let s = setup({ found: booking({ guestEmail: '', raw: { reference: '' } }) });
  assert.equal((await post(s.mod, { bookingCode: '9001' })).statusCode, 422);
  assert.equal(s.sent.length, 0);
  s = setup({ found: null });
  assert.equal((await post(s.mod, { bookingCode: '9001' })).statusCode, 404);
  s = setup({ found: booking({ status: 'canceled' }) });
  assert.equal((await post(s.mod, { bookingCode: '9001' })).statusCode, 409);
  assert.equal(s.sent.length, 0);
});

test('auth, método y validación del código', async () => {
  let s = setup({ authOk: false });
  assert.equal((await post(s.mod, { bookingCode: '9001' })).statusCode, 403);
  s = setup();
  assert.equal((await post(s.mod, { bookingCode: '../x' })).statusCode, 400);
  assert.equal((await s.mod.handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
});

test('sin llave de Resend → 200 con sent:false y reason no-key', async () => {
  const { mod } = setup({ sendResult: { sent: false, reason: 'no-key' } });
  const r = await post(mod, { bookingCode: '9001' });
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).reason, 'no-key');
});

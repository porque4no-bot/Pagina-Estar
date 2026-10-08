/* Frente "Panel Hoy para recepción" — lista de reservas web de los últimos 30
 * días (booking-results ↔ OTASync por fecha de recepción). Read-only. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { memStores } = require('../helpers/mem-blobs');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

const NOW = Date.parse('2026-10-08T17:00:00Z');

function setup({ creds = true, reservations = [], pmsThrows = false } = {}) {
  fakeModule(P('_authz'), {
    authorize: async () => ({ ok: true, email: 'rec@estar.co', permissions: ['guests.checkin.view'] })
  });
  delete require.cache[P('staff-web-bookings')];
  const mod = require('../../netlify/functions/staff-web-bookings');
  const blobs = memStores({
    'booking-results': {
      'direct-EST-MPOK1': JSON.stringify({ bookingCode: '9001', otasyncId: '9001', provider: 'mercadopago', paymentMethod: 'credit_card', amountInCents: 45000000, createdAt: '2026-10-05T15:00:00Z' }),
      'direct-EST-WMPOK': JSON.stringify({ bookingCode: '9002', provider: 'wompi', paymentMethod: 'CARD', amountInCents: 30000000, createdAt: '2026-10-03T15:00:00Z' }),
      'direct-EST-AGOTA': JSON.stringify({ bookingCode: 'EST-AGOTA', reservationPending: true, reason: 'sold_out', provider: 'mercadopago', createdAt: '2026-10-07T15:00:00Z' }),
      'direct-EST-VIEJA': JSON.stringify({ bookingCode: '8000', provider: 'wompi', amountInCents: 100, createdAt: '2026-07-01T15:00:00Z' })
    }
  });
  const calls = [];
  mod._test.resetDeps();
  mod._test.setDeps({
    getStore: blobs.getStore,
    now: () => NOW,
    hasOtasyncCreds: () => creds,
    getReservationsByDate: async (args) => { calls.push(args); if (pmsThrows) throw new Error('down'); return { reservations }; }
  });
  return { mod, calls };
}

function r(o) {
  return { idReservations: o.id, firstName: 'Ana', lastName: o.last || 'Ríos', roomName: 'Clásica', dateArrival: '2026-10-20', dateDeparture: '2026-10-22', nights: 2, status: o.status || 'confirmed', reference: o.ref || '', email: o.email || '' };
}

test('lista los pagos web de 30 días, cruza con Kunas y marca "pago sin reserva"', async () => {
  const { mod, calls } = setup({
    reservations: [
      r({ id: '9001', ref: 'EST-MPOK1', email: 'ana@x.co' }),
      r({ id: '9002', ref: 'EST-WMPOK', last: 'Gómez', status: 'canceled' }),
      r({ id: '9100', ref: 'EST-HUERF', last: 'Sinpago' }),
      r({ id: '9200', ref: '', last: 'Booking' })
    ]
  });
  const res = await mod.handler({ httpMethod: 'GET', queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 200, res.body);
  const b = JSON.parse(res.body);
  assert.equal(b.days, 30);
  assert.equal(b.pmsAvailable, true);
  assert.equal(calls[0].filterBy, 'date_received');
  assert.equal(calls[0].dto, '2026-10-08');

  const codes = b.items.map(x => x.webCode);
  assert.deepEqual(codes.slice(0, 3), ['EST-AGOTA', 'EST-MPOK1', 'EST-WMPOK'], 'más reciente primero');
  assert.ok(!codes.includes('EST-VIEJA'), 'fuera de la ventana de 30 días');

  const mp = b.items.find(x => x.webCode === 'EST-MPOK1');
  assert.equal(mp.bookingCode, '9001');
  assert.equal(mp.guestName, 'Ana Ríos');
  assert.equal(mp.payment.provider, 'mercadopago');
  assert.equal(mp.hasEmail, true);

  const wompi = b.items.find(x => x.webCode === 'EST-WMPOK');
  assert.equal(wompi.bookingCode, '9002');
  assert.equal(wompi.pmsStatus, 'canceled');

  const sold = b.items.find(x => x.webCode === 'EST-AGOTA');
  assert.equal(sold.needsAttention, true);
  assert.equal(sold.payment.status, 'pago_sin_reserva');
  assert.equal(sold.bookingCode, null);
  assert.equal(b.attention, 1);

  const orphan = b.items.find(x => x.webCode === 'EST-HUERF');
  assert.equal(orphan.source, 'otasync');
  assert.equal(orphan.payment, null);
  assert.ok(!b.items.some(x => x.bookingCode === '9200'), 'las reservas de OTA no entran a la lista web');
});

test('sin OTASync (o si falla) devuelve solo lo registrado en booking-results', async () => {
  let s = setup({ creds: false });
  let b = JSON.parse((await s.mod.handler({ httpMethod: 'GET', queryStringParameters: { days: '999' }, headers: {} })).body);
  assert.equal(b.pmsAvailable, false);
  assert.equal(b.days, 60, 'tope de 60 días');
  assert.equal(s.calls.length, 0);
  s = setup({ pmsThrows: true });
  b = JSON.parse((await s.mod.handler({ httpMethod: 'GET', queryStringParameters: {}, headers: {} })).body);
  assert.equal(b.pmsAvailable, false);
  assert.equal(b.items.length, 3);
  assert.equal(b.items.find(x => x.webCode === 'EST-MPOK1').bookingCode, '9001', 'usa el otasyncId del webhook');
});

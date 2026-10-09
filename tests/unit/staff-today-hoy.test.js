/* Frente "Panel Hoy para recepción" — staff-today enriquecido: canal, teléfono,
 * saldo, pago en línea (booking-results), check-in hecho + revisión manual
 * (guest-checkins cifrado), pedidos por cobrar y documentos por verificar
 * (ops-queue). OTASync/authz falsos en require.cache; Blobs en memoria.
 * (node --test aísla cada archivo en su proceso → la cache no se filtra.) */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const { memStores } = require('../helpers/mem-blobs');
const { protectRecord } = require('../../netlify/functions/_guest-app');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

const DATE = '2026-10-08';

function res(o) {
  return {
    idReservations: o.id, firstName: o.first || 'Ana', lastName: o.last || 'Ríos',
    roomName: 'Clásica', roomNumber: o.roomNumber || '', nights: 2, hasBreakfast: !!o.bf,
    status: 'confirmed', dateArrival: o.in, dateDeparture: o.out,
    reference: o.ref || '', channel: o.channel || '', phone: o.phone || '', email: o.email || '',
    totalPrice: o.total || 0, remainingAmount: o.remaining || 0
  };
}

function load({ window = [], departures = [], tasks = [], stores = {} } = {}) {
  fakeModule(P('_authz'), {
    authorize: async () => ({ ok: true, email: 'rec@estar.co', permissions: ['guests.checkin.view'] })
  });
  fakeModule(P('_otasync'), {
    hasOtasyncCreds: () => true,
    isHoldReservation: () => false,
    getReservationsByDate: async ({ filterBy }) => ({ reservations: filterBy === 'date_departure' ? departures : window, isMock: false })
  });
  delete require.cache[P('staff-today')];
  const mod = require('../../netlify/functions/staff-today');
  const blobs = memStores(stores);
  mod._test.resetDeps();
  mod._test.setDeps({ getStore: blobs.getStore, listOpen: async () => tasks, getPaymentDetails: async () => null });
  return { mod, blobs };
}

function call(mod) {
  return mod.handler({ httpMethod: 'GET', queryStringParameters: { date: DATE }, headers: {} });
}

test('cada reserva trae canal, teléfono, saldo, pago web, check-in y pedidos por cobrar', async () => {
  const chkId = `CHK-${Date.parse('2026-10-07T20:00:00Z')}-ABCDEF`;
  const checkin = {
    type: 'guest_checkin', checkinId: chkId, bookingCode: '9001', createdAt: '2026-10-07T20:00:00.000Z',
    manualReview: true, reservation: {},
    guests: [{ guest: { firstName: 'Ana' }, document: { needsManualReview: true }, isPrimary: true }]
  };
  const { mod } = load({
    window: [
      res({ id: '9001', in: DATE, out: '2026-10-10', ref: 'EST-ABCDE', phone: '+57 300 111 2233', email: 'ana@x.co', roomNumber: '402', remaining: 0, total: 450000 }),
      res({ id: '9002', in: '2026-10-06', out: '2026-10-09', channel: 'Booking.com', phone: '+1 555', remaining: 380000, total: 380000 })
    ],
    tasks: [
      { id: 'folio_manual_charge:GST-1', kind: 'folio_manual_charge', context: { bookingCode: '9002', eventId: 'GST-1', total: 40000, items: 'Desayuno × 2' } },
      { id: 'checkin_manual_review:' + chkId, kind: 'checkin_manual_review', context: { bookingCode: '9001', checkinId: chkId } }
    ],
    stores: {
      'booking-results': { 'direct-EST-ABCDE': JSON.stringify({ bookingCode: '9001', otasyncId: '9001', provider: 'mercadopago', paymentMethod: 'credit_card', amountInCents: 45000000, createdAt: '2026-10-01T10:00:00Z' }) },
      'guest-checkins': { [chkId]: protectRecord(checkin) }
    }
  });
  const r = await call(mod);
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.deepEqual(b.enrichment, { payments: true, checkins: true, tasks: true });

  const web = b.arrivals.find(x => x.bookingCode === '9001');
  assert.equal(web.channel, 'Web');
  assert.equal(web.isWeb, true);
  assert.equal(web.webCode, 'EST-ABCDE');
  assert.equal(web.phone, '+57 300 111 2233');
  assert.equal(web.hasEmail, true);
  assert.equal(web.roomNumber, '402');
  assert.equal(web.payment.provider, 'mercadopago');
  assert.equal(web.payment.amountCents, 45000000);
  assert.equal(web.payment.status, 'aprobado');
  assert.equal(web.checkin.done, true);
  assert.equal(web.checkin.checkinId, chkId);
  assert.equal(web.checkin.manualReview, true);
  assert.equal(web.verifyDocumentTasks, 1);
  assert.equal(web.email, undefined, 'el tablero no expone el correo');

  const ota = b.inHouse.find(x => x.bookingCode === '9002');
  assert.equal(ota.channel, 'Booking.com');
  assert.equal(ota.isWeb, false);
  assert.equal(ota.payment, null);
  assert.equal(ota.balance, 380000);
  assert.equal(ota.checkin.done, false);
  assert.equal(ota.pendingOrdersCount, 1);
  assert.equal(ota.pendingOrders[0].total, 40000);
  assert.equal(ota.pendingOrders[0].items, 'Desayuno × 2');
});

test('si la cola o los check-ins fallan, el tablero sale igual (enrichment parcial)', async () => {
  const { mod } = load({ window: [res({ id: '9003', in: DATE, out: '2026-10-09' })] });
  mod._test.setDeps({
    listOpen: async () => { throw new Error('cola caída'); },
    getStore: (name) => { if (name === 'guest-checkins') throw new Error('sin blobs'); return { get: async () => null, list: async () => ({ blobs: [] }) }; }
  });
  const r = await call(mod);
  assert.equal(r.statusCode, 200);
  const b = JSON.parse(r.body);
  assert.equal(b.arrivals.length, 1);
  assert.equal(b.enrichment.tasks, false);
  assert.equal(b.enrichment.checkins, false);
  assert.equal(b.arrivals[0].checkin.done, false);
});

test('Blobs caído en booking-results y cola que falla (strict) → enrichment payments/tasks en false y fila "desconocida"', async () => {
  const { mod, blobs } = load({
    window: [res({ id: '9004', in: DATE, out: '2026-10-09', ref: 'EST-CAIDO' })],
    stores: { 'booking-results': {} }
  });
  blobs.stores['booking-results'].failGet = true;
  let strictSeen = null;
  /* La cola real devuelve [] ante fallos salvo con strict → aquí lanza como lo haría. */
  mod._test.setDeps({ listOpen: async (opts) => { strictSeen = opts && opts.strict; throw new Error('ops-queue 503'); } });
  const b = JSON.parse((await call(mod)).body);
  assert.equal(strictSeen, true, 'staff-today pide la cola en modo strict');
  assert.equal(b.enrichment.payments, false);
  assert.equal(b.enrichment.tasks, false);
  const row = b.arrivals[0];
  assert.equal(row.payment, null);
  assert.equal(row.paymentUnknown, true, 'no se afirma "sin registro de pago"');
  assert.equal(row.tasksUnknown, true);
});

test('"pago sin reserva" en booking-results pero la reserva está en el tablero → reserva_creada', async () => {
  const { mod } = load({
    window: [res({ id: '9005', in: DATE, out: '2026-10-09', ref: 'EST-XYZ12' })],
    stores: { 'booking-results': { 'direct-EST-XYZ12': JSON.stringify({ bookingCode: 'EST-XYZ12', reservationPending: true, reason: 'insert_failed', provider: 'wompi', amountInCents: 100000, createdAt: '2026-10-01T10:00:00Z' }) } }
  });
  const b = JSON.parse((await call(mod)).body);
  assert.equal(b.arrivals[0].payment.status, 'reserva_creada');
});

test('_ops-queue.listOpen: best-effort por defecto, lanza con strict', async () => {
  const ops = require('../../netlify/functions/_ops-queue');
  const broken = { getStore: () => ({ list: async () => { throw new Error('503'); } }) };
  assert.deepEqual(await ops.listOpen(broken), []);
  await assert.rejects(ops.listOpen({ ...broken, strict: true }));
  await assert.rejects(ops.listOpen({ getStore: () => null, strict: true }), (e) => e.unavailable === true);
});

test('publicReservation sin extra mantiene la forma mínima (compatibilidad)', () => {
  const { mod } = load();
  const pub = mod._test.publicReservation(res({ id: '1', in: DATE, out: '2026-10-09' }));
  assert.equal(pub.bookingCode, '1');
  assert.equal(pub.checkin.done, false);
  assert.equal(pub.pendingOrdersCount, 0);
  assert.equal(pub.payment, null);
});

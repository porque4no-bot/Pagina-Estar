/* Sprint 1 (Mesa Redonda) — staff-today: tablero "Hoy" read-only (roster del día
 * + cola de reembolsos). Helpers puros + handler con módulos falsos en cache.
 * (node --test aísla cada archivo en su proceso → la cache no se filtra.) */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = (m) => require.resolve('../../netlify/functions/' + m);
function fakeModule(id, exportsObj) {
  require.cache[id] = { id, filename: id, loaded: true, exports: exportsObj };
}

function norm(o) {
  return {
    idReservations: o.id, firstName: o.first || 'N', lastName: o.last || 'N',
    roomName: o.room || 'Apto', nights: o.nights || 1, hasBreakfast: !!o.bf,
    status: o.status || 'confirmed', dateArrival: o.in, dateDeparture: o.out
  };
}

function load({ authOk = true, perms = ['guests.checkin.view', 'refunds.view'], hasCreds = true, window = [], departures = [], refunds = [] }) {
  fakeModule(P('_authz'), {
    authorize: async () => authOk
      ? { ok: true, email: 'rec@x.co', permissions: perms }
      : { ok: false, statusCode: 403, error: 'No tienes permiso para esta acción' }
  });
  fakeModule(P('_otasync'), {
    hasOtasyncCreds: () => hasCreds,
    isHoldReservation: (r) => /^bloqueo/i.test(`${(r && r.firstName) || ''} ${(r && r.lastName) || ''}`.trim()) || /^COT-/i.test(String((r && r.reference) || '')),
    getReservationsByDate: async ({ filterBy }) => filterBy === 'date_departure'
      ? { reservations: departures, isMock: false }
      : { reservations: window, isMock: false }
  });
  fakeModule(P('_refunds-store'), {
    listRefunds: async () => refunds,
    STATUS: { DONE: 'DONE', DENIED: 'DENIED' }
  });
  delete require.cache[P('staff-today')];
  return require('../../netlify/functions/staff-today');
}

function call(mod, qs = { date: '2026-06-22' }) {
  return mod.handler({ httpMethod: 'GET', queryStringParameters: qs, headers: {} });
}

test('helpers puros: shiftDate / isValidDate / publicReservation', () => {
  const { _test } = require('../../netlify/functions/staff-today');
  assert.equal(_test.shiftDate('2026-06-22', -92), '2026-03-22');
  assert.equal(_test.isValidDate('2026-06-22'), true);
  assert.equal(_test.isValidDate('nope'), false);
  const pub = _test.publicReservation({ idReservations: '7', firstName: 'Ana', lastName: 'Ríos', roomName: 'X', nights: 2, status: 'confirmed', dateArrival: '2026-06-22', dateDeparture: '2026-06-24', hasBreakfast: true });
  assert.equal(pub.bookingCode, '7');
  assert.equal(pub.guestName, 'Ana Ríos');
  assert.equal(pub.checkIn, '2026-06-22');
});

test('clasifica el roster: llegadas hoy, en casa y salidas hoy (excluye canceladas)', async () => {
  const date = '2026-06-22';
  const window = [
    norm({ id: 'A', in: '2026-06-22', out: '2026-06-25' }),               // llega hoy + en casa
    norm({ id: 'B', in: '2026-06-20', out: '2026-06-23' }),               // en casa
    norm({ id: 'C', in: '2026-06-10', out: '2026-06-22' }),               // sale hoy (no en casa)
    norm({ id: 'D', in: '2026-06-21', out: '2026-06-24', status: 'canceled' }) // cancelada → fuera
  ];
  const departures = [norm({ id: 'C', in: '2026-06-10', out: '2026-06-22' })];
  const mod = load({ window, departures, refunds: [] });
  const res = await call(mod, { date });
  assert.equal(res.statusCode, 200);
  const b = JSON.parse(res.body);
  assert.equal(b.date, date);
  assert.deepEqual(b.arrivals.map(r => r.bookingCode), ['A']);
  assert.deepEqual(b.inHouse.map(r => r.bookingCode).sort(), ['A', 'B']);
  assert.deepEqual(b.departures.map(r => r.bookingCode), ['C']);
  assert.deepEqual(b.counts, { arrivals: 1, departures: 1, inHouse: 2 });
});

test('incluye reembolsos pendientes (no terminales) si el rol tiene refunds.view', async () => {
  const refunds = [
    { bookingCode: 'EST-1', status: 'NEEDS_REVIEW', route: 'MANUAL_BANK', guestName: 'Ana', refundAmountCents: 50000, createdAt: '2026-06-21' },
    { bookingCode: 'EST-2', status: 'DONE', guestName: 'Leo' },     // terminal → fuera
    { bookingCode: 'EST-3', status: 'DENIED', guestName: 'Sam' }    // terminal → fuera
  ];
  const mod = load({ refunds });
  const b = JSON.parse((await call(mod)).body);
  assert.equal(b.refunds.count, 1);
  assert.equal(b.refunds.pending[0].bookingCode, 'EST-1');
  assert.equal(b.refunds.pending[0].amountCents, 50000);
});

test('NO incluye reembolsos si el rol carece de refunds.view', async () => {
  const mod = load({ perms: ['guests.checkin.view'], refunds: [{ bookingCode: 'X', status: 'NEEDS_REVIEW' }] });
  const b = JSON.parse((await call(mod)).body);
  assert.equal(b.refunds, null);
});

test('sin credenciales OTASync → tablero vacío con isMock', async () => {
  const mod = load({ hasCreds: false });
  const b = JSON.parse((await call(mod)).body);
  assert.equal(b.isMock, true);
  assert.deepEqual(b.counts, { arrivals: 0, departures: 0, inHouse: 0 });
});

test('sin permiso → 403', async () => {
  const mod = load({ authOk: false });
  const res = await call(mod);
  assert.equal(res.statusCode, 403);
});

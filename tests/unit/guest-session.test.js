/* guest-session + _guest-app (frente guestapp):
   - una reserva cancelada no abre la app (403 booking_cancelled);
   - "Pagar en línea" solo si el modo de pago de servicios lo soporta;
   - la sesión informa el último check-in (índice sin PII);
   - el token lleva el apartaestudio (para el contrato) y la reserva de OTASync
     toma el tipo/número de habitación de guests[] cuando no hay rooms[];
   - errores con código estable y mensaje en español. */
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';
delete process.env.GUEST_SERVICE_PAYMENT_URL;

const guestHelpers = require('../../netlify/functions/_guest-app');
const sessionModule = require('../../netlify/functions/guest-session');

let ipCounter = 0;
function loginEvent(payload) {
  ipCounter += 1;
  return {
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': `10.20.0.${ipCounter}` },
    body: JSON.stringify(payload)
  };
}

function booking(overrides = {}) {
  return {
    bookingCode: '3273564',
    status: 'confirmed',
    guestName: 'Andrea Restrepo',
    guestLastName: 'Restrepo',
    guestEmail: 'andrea@example.com',
    roomName: 'Selección',
    roomNumber: '402',
    capacity: 2,
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    nights: 3,
    totalAmount: 900000,
    canCancel: true,
    canModify: true,
    ...overrides
  };
}

function setDeps({ reservation = booking(), mode = '', index = null } = {}) {
  sessionModule._test.setDeps({
    getReservation: async () => reservation,
    getSetting: async key => (key === 'GUEST_SERVICE_PAYMENT_MODE' ? mode : ''),
    guestStore: () => ({ get: async () => index })
  });
}

test.afterEach(() => sessionModule._test.resetDeps());

test('a cancelled reservation does not open the guest app (403 booking_cancelled)', async () => {
  for (const status of ['canceled', 'cancelled', 'CANCELED']) {
    setDeps({ reservation: booking({ status }) });
    const res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
    assert.equal(res.statusCode, 403, status);
    const data = JSON.parse(res.body);
    assert.equal(data.code, 'booking_cancelled');
    assert.match(data.error, /cancelada/);
    assert.equal(data.token, undefined, 'no se emite sesión');
  }
  setDeps({ reservation: booking({ status: 'confirmed', cancelled: true }) });
  const res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
  assert.equal(res.statusCode, 403);
});

test('wrong last name stays a uniform 404 even for a cancelled booking (no enumeration)', async () => {
  setDeps({ reservation: booking({ status: 'canceled' }) });
  const res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Gomez' }));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).code, 'booking_not_found');
});

test('online payment is offered only when the service payment mode supports it', async () => {
  const cases = [
    ['', false], ['room_charge', false], ['payment_link', false],
    ['wompi', true], ['mercadopago', true], ['both', true]
  ];
  for (const [mode, expected] of cases) {
    setDeps({ mode });
    const res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).booking.onlinePayment, expected, mode || '(sin definir)');
  }
  process.env.GUEST_SERVICE_PAYMENT_URL = 'https://pay.example/link';
  try {
    assert.equal(sessionModule._test.onlinePaymentEnabled('payment_link'), true);
  } finally {
    delete process.env.GUEST_SERVICE_PAYMENT_URL;
  }
});

test('the session reports the last check-in from the index (and ignores junk)', async () => {
  setDeps({ index: { checkinId: 'CHK-1700000000000-ABC123', createdAt: '2026-10-08T12:00:00Z' } });
  let res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
  assert.equal(JSON.parse(res.body).booking.checkinId, 'CHK-1700000000000-ABC123');

  setDeps({ index: { checkinId: '<script>' } });
  res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
  assert.equal(JSON.parse(res.body).booking.checkinId, undefined);

  sessionModule._test.setDeps({
    getReservation: async () => booking(),
    getSetting: async () => '',
    guestStore: () => { throw new Error('blobs down'); }
  });
  res = await sessionModule.handler(loginEvent({ bookingCode: '3273564', accessKey: 'Restrepo' }));
  assert.equal(res.statusCode, 200, 'sin Blobs la sesión igual abre');
});

test('missing fields and PMS outage answer with stable codes', async () => {
  setDeps();
  let res = await sessionModule.handler(loginEvent({}));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).code, 'missing_login');

  sessionModule._test.setDeps({
    getReservation: async () => { throw Object.assign(new Error('Guest app PMS credentials are not configured'), { statusCode: 503 }); }
  });
  res = await sessionModule.handler(loginEvent({ bookingCode: '1', accessKey: 'Restrepo' }));
  assert.equal(res.statusCode, 503);
  const data = JSON.parse(res.body);
  assert.equal(data.code, 'service_unavailable');
  assert.doesNotMatch(data.error, /credentials/i, 'nada de textos técnicos en inglés');
});

test('the signed token carries the studio name for the contract', () => {
  const signed = guestHelpers.signGuestToken(booking(), 60);
  const session = guestHelpers.requireGuest({ headers: { authorization: `Bearer ${signed}` } });
  assert.equal(session.roomName, 'Selección');
  assert.equal(session.roomNumber, '402');
});

test('normalizeReservation reads room type/number from guests[] and detects cancellation', () => {
  const raw = {
    id_reservations: 3273564,
    status: 'confirmed',
    date_arrival: '2026-11-01',
    date_departure: '2026-11-04',
    date_canceled: null,
    total_price: 900000,
    guests: [{ first_name: 'Andrea', last_name: 'Restrepo', email: 'a@example.com', room_type_name: 'Selección', room_number: '402' }]
  };
  const normalized = guestHelpers.normalizeReservation(raw);
  assert.equal(normalized.roomName, 'Selección');
  assert.equal(normalized.roomNumber, '402');
  assert.equal(normalized.cancelled, false);
  assert.equal(guestHelpers.isCancelledBooking(normalized), false);

  const cancelledByDate = guestHelpers.normalizeReservation({ ...raw, date_canceled: '2026-10-07 10:00:00' });
  assert.equal(cancelledByDate.cancelled, true);
  assert.equal(cancelledByDate.status, 'cancelled');
  assert.equal(guestHelpers.isCancelledBooking(cancelledByDate), true);

  const zeroDate = guestHelpers.normalizeReservation({ ...raw, date_canceled: '0000-00-00 00:00:00' });
  assert.equal(zeroDate.cancelled, false);

  const softCancel = guestHelpers.normalizeReservation({ ...raw, status: 'canceled' });
  assert.equal(guestHelpers.isCancelledBooking(softCancel), true);
});

test('parseJsonBody errors are Spanish with a stable code', () => {
  assert.throws(
    () => guestHelpers.parseJsonBody({ body: 'x'.repeat(50) }, 10),
    error => error.statusCode === 413 && error.code === 'payload_too_large' && !/Payload too large/.test(error.message)
  );
  assert.throws(
    () => guestHelpers.parseJsonBody({ body: '{nope' }, 1000),
    error => error.statusCode === 400 && error.code === 'invalid_json'
  );
});

/* Frente "Panel Hoy para recepción" — helpers compartidos (_staff-hoy.js) y los
 * campos nuevos de _otasync.normalizeReservation. Sin red: Blobs en memoria y la
 * bóveda real (cifrado/descifrado de ida y vuelta con una llave de prueba). */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DATA_ENCRYPTION_KEY = 'unit-test-encryption-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const hoy = require('../../netlify/functions/_staff-hoy');
const { protectRecord } = require('../../netlify/functions/_guest-app');
const { normalizeReservation } = require('../../netlify/functions/_otasync');
const { memStores } = require('../helpers/mem-blobs');

function checkinRecord({ id, booking, createdAt, manual = false, guests }) {
  return {
    type: 'guest_checkin',
    checkinId: id,
    bookingCode: booking,
    createdAt,
    manualReview: manual,
    reservation: { checkIn: '2026-10-08', checkOut: '2026-10-10', roomNumber: '402', motive: 'Turismo' },
    guests: guests || [{
      guest: {
        firstName: 'Ana', lastName: 'Ríos', documentType: 'Pasaporte', documentNumber: 'X123',
        nationality: 'Estados Unidos', birthDate: '1990-01-01', sex: 'F', occupation: 'Docente',
        email: 'ana@example.com', phone: '3001112233', address: 'Calle 1', notes: 'nota privada',
        residenceCountry: 'Estados Unidos', residenceCity: 'Miami',
        originCountry: 'Estados Unidos', originCity: 'Miami', destination: 'Medellín'
      },
      document: { needsManualReview: manual, analysisSource: manual ? 'azure-error' : 'azure', ocrAttempts: manual ? 3 : 1 },
      isPrimary: true, isMinor: false, guestIndex: 0
    }],
    status: 'received'
  };
}

test('normalizeReservation expone canal, número de apto y saldo del folio', () => {
  const r = normalizeReservation({
    id_reservations: '9001', channel_name: 'Booking.com', total_price: '450000', remaining_amount: '120000',
    reference: 'EST-ABCDE', phone: '+57 300', email: 'x@y.co',
    rooms: [{ name: 'Clásica', room_number: '201', nights: [] }]
  });
  assert.equal(r.channel, 'Booking.com');
  assert.equal(r.roomNumber, '201');
  assert.equal(r.totalPrice, 450000);
  assert.equal(r.remainingAmount, 120000);
  const empty = normalizeReservation(undefined);
  assert.equal(empty.channel, '');
  assert.equal(empty.roomNumber, '');
  assert.equal(empty.remainingAmount, 0);
});

test('timestampFromKey lee el ms de CHK-/GST- y de claves de documento', () => {
  assert.equal(hoy.timestampFromKey('CHK-1760000000000-ABC123'), 1760000000000);
  assert.equal(hoy.timestampFromKey('GST-1760000000001-ab12cd'), 1760000000001);
  assert.equal(hoy.timestampFromKey('sin-marca'), null);
});

test('paymentFromResult: aprobado vs pago sin reserva; null sin datos', () => {
  assert.equal(hoy.paymentFromResult(null, null), null);
  const ok = hoy.paymentFromResult({ provider: 'mercadopago', paymentMethod: 'credit_card', amountInCents: 45000000, transactionId: 'tx1', createdAt: '2026-10-01T10:00:00Z' });
  assert.equal(ok.status, 'aprobado');
  assert.equal(ok.amountCents, 45000000);
  assert.equal(ok.provider, 'mercadopago');
  const pend = hoy.paymentFromResult({ provider: 'wompi', reservationPending: true, reason: 'sold_out' });
  assert.equal(pend.status, 'pago_sin_reserva');
  assert.equal(pend.reason, 'sold_out');
  /* fallback a payment-details para el monto */
  const fb = hoy.paymentFromResult({ provider: 'wompi' }, { amountInCents: 9900, method: 'CARD' });
  assert.equal(fb.amountCents, 9900);
  assert.equal(fb.method, 'CARD');
});

test('channelLabel: Web / Corporativo / canal OTASync / Directo', () => {
  assert.equal(hoy.channelLabel({ reference: 'EST-ABCDE' }, null), 'Web');
  assert.equal(hoy.channelLabel({ reference: 'COT-123' }, null), 'Corporativo');
  assert.equal(hoy.channelLabel({ reference: '', channel: 'Airbnb' }, null), 'Airbnb');
  assert.equal(hoy.channelLabel({ reference: '' }, null), 'Directo');
  assert.equal(hoy.channelLabel({ reference: '' }, { provider: 'wompi' }), 'Web');
});

test('getWebPayment: lee booking-results por el código web (Mercado Pago)', async () => {
  const { getStore } = memStores({
    'booking-results': { 'direct-EST-ABCDE': JSON.stringify({ bookingCode: '9001', otasyncId: '9001', provider: 'mercadopago', paymentMethod: 'credit_card', amountInCents: 45000000, createdAt: '2026-10-01T10:00:00Z' }) }
  });
  const p = await hoy.getWebPayment({ reference: 'EST-ABCDE', bookingCode: '9001' }, { getStore, getPaymentDetails: async () => null });
  assert.equal(p.provider, 'mercadopago');
  assert.equal(p.amountCents, 45000000);
  assert.equal(p.status, 'aprobado');
});

test('getWebPayment: cae a payment-details (Wompi) y no consulta reservas de OTA', async () => {
  const { getStore } = memStores();
  const asked = [];
  const getPaymentDetails = async (code) => { asked.push(code); return code === '9002' ? { provider: 'wompi', method: 'CARD', amountInCents: 30000000 } : null; };
  const p = await hoy.getWebPayment({ reference: 'EST-ZZZZZ', bookingCode: '9002' }, { getStore, getPaymentDetails });
  assert.equal(p.provider, 'wompi');
  assert.equal(p.amountCents, 30000000);
  asked.length = 0;
  const none = await hoy.getWebPayment({ reference: '', bookingCode: '7777' }, { getStore, getPaymentDetails });
  assert.equal(none, null);
  assert.deepEqual(asked, [], 'una reserva de OTA no consulta el store de pagos');
});

test('findCheckins: solo descifra las reservas pedidas y respeta la ventana', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const idA = `CHK-${now - 3600e3}-AAAAAA`;
  const idB = `CHK-${now - 7200e3}-BBBBBB`;
  const idOld = `CHK-${now - 90 * 86400e3}-CCCCCC`;
  const { getStore } = memStores({
    'guest-checkins': {
      [idA]: protectRecord(checkinRecord({ id: idA, booking: '9001', createdAt: new Date(now - 3600e3).toISOString(), manual: true })),
      [idB]: protectRecord(checkinRecord({ id: idB, booking: '5555', createdAt: new Date(now - 7200e3).toISOString() })),
      [idOld]: protectRecord(checkinRecord({ id: idOld, booking: '9001', createdAt: new Date(now - 90 * 86400e3).toISOString() }))
    }
  });
  assert.equal(getStore('guest-checkins').data[idA].encrypted, true, 'el registro está cifrado en reposo');
  const decrypted = [];
  const unprotectRecord = (s) => { decrypted.push(s.bookingCode); return require('../../netlify/functions/_guest-app').unprotectRecord(s); };
  const res = await hoy.findCheckins(['9001'], { sinceMs: now - 30 * 86400e3, deps: { getStore, unprotectRecord } });
  const list = res.byBooking.get('9001');
  assert.equal(list.length, 1, 'el check-in viejo queda fuera de la ventana');
  assert.equal(list[0].checkinId, idA);
  assert.equal(list[0].manualReview, true);
  assert.equal(list[0].manualReviewGuests, 1);
  assert.equal(list[0].guests, 1);
  assert.deepEqual(decrypted, ['9001'], 'no descifra el check-in de otra reserva');
  assert.equal(res.byBooking.has('5555'), false);
});

test('checkinView/occupantView: solo datos del registro (sin correo, teléfono, dirección ni notas)', () => {
  const view = hoy.checkinView(checkinRecord({ id: 'CHK-1760000000000-ABCDEF', booking: '9001', createdAt: '2026-10-08T10:00:00Z', manual: true }));
  assert.equal(view.manualReview, true);
  assert.equal(view.reservation.roomNumber, '402');
  const g = view.guests[0];
  assert.equal(g.documentType, 'Pasaporte');
  assert.equal(g.documentNumber, 'X123');
  assert.equal(g.foreign, true);
  assert.equal(g.destination, 'Medellín');
  assert.equal(g.origin.city, 'Miami');
  assert.equal(g.needsManualReview, true);
  const json = JSON.stringify(view);
  assert.doesNotMatch(json, /ana@example\.com/);
  assert.doesNotMatch(json, /3001112233/);
  assert.doesNotMatch(json, /Calle 1/);
  assert.doesNotMatch(json, /nota privada/);
});

test('isForeignNationality: Colombia (con o sin tilde/variantes) no es extranjero', () => {
  assert.equal(hoy.isForeignNationality('Colombia'), false);
  assert.equal(hoy.isForeignNationality('colombiana'), false);
  assert.equal(hoy.isForeignNationality('Perú'), true);
  assert.equal(hoy.isForeignNationality(''), false);
});

test('tasksByBooking agrupa pedidos por cobrar y documentos por verificar', () => {
  const map = hoy.tasksByBooking([
    { id: 'folio_manual_charge:GST-1', kind: 'folio_manual_charge', context: { bookingCode: '9001', eventId: 'GST-1', total: 40000, items: 'Desayuno × 2' }, createdAt: 'x' },
    { id: 'folio_post_failed:GST-2', kind: 'folio_post_failed', context: { bookingCode: '9001', eventId: 'GST-2', total: 25000 } },
    { id: 'checkin_manual_review:CHK-1', kind: 'checkin_manual_review', context: { bookingCode: '9001', checkinId: 'CHK-1' } },
    { id: 'otra', kind: 'payment_orphan', context: { bookingCode: '7777' } },
    { id: 'sin-codigo', kind: 'folio_manual_charge', context: {} }
  ]);
  const a = map.get('9001');
  assert.equal(a.pendingOrders.length, 2);
  assert.equal(a.pendingOrders[0].total, 40000);
  assert.equal(a.pendingOrders[0].items, 'Desayuno × 2');
  assert.equal(a.verifyDocument, 1);
  assert.equal(map.get('7777').otherTasks, 1);
  assert.equal(map.size, 2);
});

test('listCheckinDocuments + documentAad: lista lo que existe y arma la AAD correcta', async () => {
  const id = 'CHK-1760000000000-ABCDEF';
  const { getStore } = memStores({
    'guest-minor-documents': { [`${id}/1/registro-civil.jpg`]: 'x', [`${id}/1/autorizacion.pdf`]: 'y', 'CHK-1760000000001-ZZZZZZ/0/registro-civil.jpg': 'otro' },
    'guest-documents': {}
  });
  const docs = await hoy.listCheckinDocuments(id, { getStore });
  assert.equal(docs.length, 2, 'solo los del check-in pedido');
  const rcn = docs.find(d => d.kind === 'registro-civil');
  assert.equal(rcn.store, 'minor');
  assert.equal(rcn.guestIndex, 1);
  assert.equal(hoy.documentAad('minor', rcn.key, '9001'), '9001|minor-rcn');
  assert.equal(hoy.documentAad('minor', `${id}/1/autorizacion.pdf`, '9001'), '9001|minor-authorization');
  assert.equal(hoy.documentAad('adult', `${id}/1-doc.png`, '9001'), '9001|guest-document');
  assert.deepEqual(await hoy.listCheckinDocuments('no-valido', { getStore }), []);
});

test('listRecentWebResults: filtra por createdAt (Blobs no tiene TTL real)', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const { getStore } = memStores({
    'booking-results': {
      'direct-EST-NUEVA': JSON.stringify({ provider: 'mercadopago', amountInCents: 100, createdAt: '2026-10-05T10:00:00Z' }),
      'direct-EST-VIEJA': JSON.stringify({ provider: 'wompi', amountInCents: 100, createdAt: '2026-08-01T10:00:00Z' }),
      'direct-EST-ROTA': 'no-json',
      'otra-clave': JSON.stringify({ createdAt: '2026-10-05T10:00:00Z' })
    }
  });
  const res = await hoy.listRecentWebResults({ days: 30, now, deps: { getStore } });
  assert.deepEqual(res.items.map(i => i.webCode), ['EST-NUEVA']);
});

test('appendStaffAudit escribe una entrada append-only con actor y acción', async () => {
  const { getStore, stores } = memStores();
  const r = await hoy.appendStaffAudit({ action: 'checkin.view', actor: 'rec@estar.co', bookingCode: '9001' }, { getStore, now: () => Date.parse('2026-10-08T12:00:00Z') });
  assert.equal(r.ok, true);
  assert.match(r.key, /^checkin\.view\/2026-10-08\//);
  const saved = JSON.parse(stores['staff-audit'].data[r.key]);
  assert.equal(saved.actor, 'rec@estar.co');
  assert.equal(saved.at, '2026-10-08T12:00:00.000Z');
  stores['staff-audit'].failSet = true;
  const fail = await hoy.appendStaffAudit({ action: 'checkin.view' }, { getStore });
  assert.equal(fail.ok, false);
});

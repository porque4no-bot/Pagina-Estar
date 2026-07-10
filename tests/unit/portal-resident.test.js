/* Pruebas puras del backend del portal RESIDENTE (netlify/functions/portal-resident.js).
 * Solo lógica determinista, sin red/Blobs/Odoo/OTASync:
 *   - precio fijo del aseo extra ($50.000) como constante única (no número mágico)
 *   - ruteo del tipo de solicitud → acción (aseo→folio, mantenimiento→maintenance,
 *     pqr→helpdesk, desconocido→null)
 *   - construcción server-authoritative del record (el precio nunca viene del cliente)
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const portal = require('../../netlify/functions/portal-resident');

test('aseo extra vale exactamente $50.000 (constante, no mágico)', () => {
  assert.equal(portal.ASEO_PRICE_COP, 50000);
});

test('buildAseoItems usa el precio del catálogo, no el del cliente', () => {
  const items = portal.buildAseoItems(1);
  assert.equal(items.length, 1);
  assert.equal(items[0].unitPrice, 50000);
  assert.equal(items[0].quantity, 1);
  assert.equal(items[0].subtotal, 50000);
});

test('buildAseoItems clampa la cantidad a 1..5 y recalcula el subtotal', () => {
  assert.equal(portal.buildAseoItems(0)[0].quantity, 1);
  assert.equal(portal.buildAseoItems(3)[0].subtotal, 150000);
  assert.equal(portal.buildAseoItems(99)[0].quantity, 5);
  assert.equal(portal.buildAseoItems('abc')[0].quantity, 1);
});

test('routeRequestType mapea cada tipo a su acción', () => {
  assert.equal(portal.routeRequestType('aseo').action, 'folio');
  assert.equal(portal.routeRequestType('mantenimiento').action, 'maintenance');
  assert.equal(portal.routeRequestType('pqr').action, 'helpdesk');
});

test('routeRequestType es case/space-insensitive', () => {
  assert.equal(portal.routeRequestType('  ASEO  ').action, 'folio');
  assert.equal(portal.routeRequestType('PQR').action, 'helpdesk');
});

test('routeRequestType devuelve null para tipos desconocidos', () => {
  assert.equal(portal.routeRequestType('cualquiera'), null);
  assert.equal(portal.routeRequestType(''), null);
  assert.equal(portal.routeRequestType(undefined), null);
});

test('buildResidentRequest (aseo) fija precio server-side y forma de pago account', () => {
  const resident = { email: 'ana@example.com', name: 'Ana', reservationId: 'RSV-1', lang: 'es' };
  // El cliente intenta inyectar un precio: debe ignorarse.
  const rec = portal.buildResidentRequest('aseo', { quantity: 2, unitPrice: 1, total: 1 }, resident);
  assert.equal(rec.action, 'folio');
  assert.equal(rec.paymentPreference, 'account');
  assert.equal(rec.items[0].unitPrice, 50000);
  assert.equal(rec.total, 100000);
  assert.equal(rec.bookingCode, 'RSV-1');
});

test('buildResidentRequest (mantenimiento) exige mensaje', () => {
  const resident = { email: 'ana@example.com', name: 'Ana', reservationId: '', lang: 'es' };
  assert.throws(() => portal.buildResidentRequest('mantenimiento', {}, resident), /mantenimiento/i);
  const rec = portal.buildResidentRequest('mantenimiento', { message: 'Gotea la llave', location: 'Baño' }, resident);
  assert.equal(rec.action, 'maintenance');
  assert.equal(rec.message, 'Gotea la llave');
  assert.equal(rec.location, 'Baño');
});

test('buildResidentRequest (pqr) exige mensaje y arma la acción helpdesk', () => {
  const resident = { email: 'ana@example.com', name: 'Ana', reservationId: '', lang: 'es' };
  assert.throws(() => portal.buildResidentRequest('pqr', {}, resident), { statusCode: 400 });
  const rec = portal.buildResidentRequest('pqr', { message: 'Cobro incorrecto' }, resident);
  assert.equal(rec.action, 'helpdesk');
  assert.equal(rec.message, 'Cobro incorrecto');
});

test('buildResidentRequest lanza 400 en tipo inválido', () => {
  const resident = { email: 'ana@example.com', name: 'Ana', reservationId: '', lang: 'es' };
  assert.throws(() => portal.buildResidentRequest('otra-cosa', {}, resident), { statusCode: 400 });
});

test('resolveReservationId prioriza el claim firmado sobre el mapa de env', () => {
  const prev = process.env.PORTAL_RESIDENT_RESERVATION_JSON;
  process.env.PORTAL_RESIDENT_RESERVATION_JSON = JSON.stringify({ 'ana@example.com': 'MAP-1' });
  try {
    assert.equal(portal.resolveReservationId({ reservation: 'CLAIM-1', sub: 'ana@example.com' }), 'CLAIM-1');
    assert.equal(portal.resolveReservationId({ sub: 'ana@example.com' }), 'MAP-1');
    assert.equal(portal.resolveReservationId({ sub: 'nadie@example.com' }), '');
  } finally {
    if (prev === undefined) delete process.env.PORTAL_RESIDENT_RESERVATION_JSON;
    else process.env.PORTAL_RESIDENT_RESERVATION_JSON = prev;
  }
});

test('parseJsonMap tolera JSON inválido devolviendo {}', () => {
  assert.deepEqual(portal.parseJsonMap('{bad'), {});
  assert.deepEqual(portal.parseJsonMap('[1,2]'), {});
  assert.deepEqual(portal.parseJsonMap(''), {});
  assert.deepEqual(portal.parseJsonMap('{"a":"b"}'), { a: 'b' });
});

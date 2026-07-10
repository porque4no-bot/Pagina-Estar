/* isHoldReservation: distingue un hold tentativo (BLOQUEO / COT- tentative) de un
   huésped REAL. Regresión: una cotización PAGADA se inserta como reserva
   CONFIRMADA con reference COT- y el nombre del contacto — NO debe filtrarse del
   tablero de recepción. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { isHoldReservation } = require('../../netlify/functions/_otasync');

test('isHoldReservation: bloqueo por nombre BLOQUEO', () => {
  assert.equal(isHoldReservation({ firstName: 'BLOQUEO', lastName: 'Cotización', status: 'tentative' }), true);
});

test('isHoldReservation: COT- tentative es hold', () => {
  assert.equal(isHoldReservation({ firstName: 'X', reference: 'COT-2026-AB12C', status: 'tentative' }), true);
});

test('isHoldReservation: COT- CONFIRMADO (cotización pagada) es huésped real, NO hold', () => {
  assert.equal(isHoldReservation({ firstName: 'Ana', lastName: 'Ríos', reference: 'COT-2026-AB12C', status: 'confirmed' }), false);
});

test('isHoldReservation: reserva directa confirmada no es hold', () => {
  assert.equal(isHoldReservation({ firstName: 'Leo', lastName: 'Paz', reference: 'EST-ABCDE', status: 'confirmed' }), false);
});

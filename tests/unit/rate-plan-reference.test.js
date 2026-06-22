/* Tema 3 (Paso 1) — the chosen rate plan is now carried in the Wompi reference
 * (position 14: 'F' = Flexible/refundable, 'B' = Best/Estricta/non-refundable)
 * so the reservation, the payment-details snapshot and the refund record all
 * know which cancellation policy applies. Old references (no position 14) must
 * keep decoding exactly as before. */

const test = require('node:test');
const assert = require('node:assert/strict');

const { _test: wompi } = require('../../netlify/functions/wompi-webhook');

/* Mirrors the client encoder in motor-app.jsx (base64url, no padding). */
function encodeRef(parts) {
  return Buffer.from(parts.join('|'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const BASE = [
  '1', '260701', '260705', '2', '31348', 'Ana', 'Pérez',
  'ana@example.com', '+573001112233', '0000000', 'EST-ABC12', '1', '0', '50000'
];

test('Flexible plan decodes as flexible (refundable)', () => {
  const decoded = wompi.decodeReference(encodeRef([...BASE, 'F']));
  assert.equal(decoded.ratePlan, 'flexible');
  assert.equal(decoded.bookingCode, 'EST-ABC12');
  assert.equal(decoded.amountCents, 50000);
});

test('Best/Estricta plan decodes as best (non-refundable)', () => {
  const decoded = wompi.decodeReference(encodeRef([...BASE, 'B']));
  assert.equal(decoded.ratePlan, 'best');
});

test('legacy reference without a plan field decodes with ratePlan undefined', () => {
  const decoded = wompi.decodeReference(encodeRef(BASE));
  assert.equal(decoded.ratePlan, undefined);
  assert.equal(decoded.bookingCode, 'EST-ABC12');
  assert.equal(decoded.amountCents, 50000);
});

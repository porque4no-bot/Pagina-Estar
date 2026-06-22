const test = require('node:test');
const assert = require('node:assert');
const { extractWompiPaymentDetails } = require('../../netlify/functions/_payment-details');

test('extractWompiPaymentDetails pulls the refund fields from a Wompi card transaction', () => {
  const tx = {
    id: '113-1700000000-12345',
    reference: 'MPDIR-abc',
    amount_in_cents: 66000000,
    currency: 'COP',
    payment_method_type: 'CARD',
    finalized_at: '2026-07-01T10:00:00.000Z',
    payment_method: { type: 'CARD', extra: { brand: 'VISA', last_four: '4242', processor_response_code: '00' } }
  };
  const d = extractWompiPaymentDetails(tx);
  assert.equal(d.provider, 'wompi');
  assert.equal(d.transactionId, '113-1700000000-12345');
  assert.equal(d.method, 'CARD');
  assert.equal(d.amountInCents, 66000000);
  assert.equal(d.currency, 'COP');
  assert.equal(d.cardBrand, 'VISA');
  assert.equal(d.cardLast4, '4242');
  assert.equal(d.authCode, '00');
  assert.equal(d.paymentDate, '2026-07-01T10:00:00.000Z');
});

test('extractWompiPaymentDetails tolerates non-card methods (PSE/Nequi, no card extra)', () => {
  const tx = { id: 'x', payment_method_type: 'PSE', amount_in_cents: 1000, created_at: '2026-07-01T00:00:00Z', payment_method: { type: 'PSE' } };
  const d = extractWompiPaymentDetails(tx);
  assert.equal(d.method, 'PSE');
  assert.equal(d.cardLast4, null);
  assert.equal(d.cardBrand, null);
  assert.equal(d.paymentDate, '2026-07-01T00:00:00Z'); // falls back to created_at
});

test('extractWompiPaymentDetails handles null/empty input without throwing', () => {
  assert.equal(extractWompiPaymentDetails(null).transactionId, null);
  assert.equal(extractWompiPaymentDetails(undefined).method, null);
  assert.equal(extractWompiPaymentDetails({}).amountInCents, null);
});

test('authCode falls back across the fields Wompi exposes', () => {
  assert.equal(extractWompiPaymentDetails({ id: 'a', payment_method: { extra: { authorization_code: 'AUTH123' } } }).authCode, 'AUTH123');
  assert.equal(extractWompiPaymentDetails({ id: 'b', payment_method: { extra: { external_identifier: 'EXT9' } } }).authCode, 'EXT9');
});

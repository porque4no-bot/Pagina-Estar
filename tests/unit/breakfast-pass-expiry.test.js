/* Pase de desayuno: vence relativo al CHECK-OUT cuando se conoce (antes, 45 días
   desde la emisión: una reserva hecha con más anticipación llegaba con el pase
   vencido). La firma de signPassToken sigue siendo compatible. */
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GUEST_APP_TOKEN_SECRET = 'unit-test-token-secret';
process.env.GUEST_APP_DEMO_MODE = 'true';

const pass = require('../../netlify/functions/_breakfast-pass');

function claimsOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
}

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

test('with a known check-out, the pass expires at the end of that day (Bogotá) + grace', () => {
  const checkOut = isoDaysFromNow(90); /* reserva hecha 3 meses antes */
  const token = pass.signPassToken('RES-1', { checkOut });
  const { exp } = claimsOf(token);
  const expected = Math.floor(Date.parse(`${checkOut}T23:59:59-05:00`) / 1000) + pass.PASS_GRACE_AFTER_CHECKOUT_SECONDS;
  assert.equal(exp, expected);
  assert.ok(exp > Math.floor(Date.now() / 1000) + 45 * 86400, 'ya no vence antes de la estadía');
  assert.deepEqual(pass.verifyPassToken(token), { bookingCode: 'RES-1', exp });
});

test('a short stay no longer gets 45 days of validity', () => {
  const checkOut = isoDaysFromNow(3);
  const { exp } = claimsOf(pass.signPassToken('RES-2', { checkOut }));
  assert.ok(exp < Math.floor(Date.now() / 1000) + 6 * 86400);
});

test('a past check-out yields an already-expired pass', () => {
  const token = pass.signPassToken('RES-3', { checkOut: isoDaysFromNow(-5) });
  assert.equal(pass.verifyPassToken(token), null);
});

test('backwards compatible: no options / numeric ttl / invalid check-out fall back', () => {
  const now = Math.floor(Date.now() / 1000);
  const legacy = claimsOf(pass.signPassToken('RES-4')).exp;
  assert.ok(Math.abs(legacy - (now + pass.PASS_TTL_SECONDS)) <= 2);
  const ttl = claimsOf(pass.signPassToken('RES-5', 120)).exp;
  assert.ok(Math.abs(ttl - (now + 120)) <= 2);
  const invalid = claimsOf(pass.signPassToken('RES-6', { checkOut: 'mañana' })).exp;
  assert.ok(Math.abs(invalid - (now + pass.PASS_TTL_SECONDS)) <= 2);
  const customFallback = claimsOf(pass.signPassToken('RES-7', { checkOut: '', ttlSeconds: 600 })).exp;
  assert.ok(Math.abs(customFallback - (now + 600)) <= 2);
});

test('an absurd check-out is capped', () => {
  const { exp } = claimsOf(pass.signPassToken('RES-8', { checkOut: '2099-12-31' }));
  assert.ok(exp <= Math.floor(Date.now() / 1000) + pass.PASS_MAX_TTL_SECONDS + 2);
});

test('expiryForCheckOut validates the date format', () => {
  assert.equal(pass.expiryForCheckOut('2026-13-45x'), null);
  assert.equal(pass.expiryForCheckOut(''), null);
  assert.equal(typeof pass.expiryForCheckOut('2026-11-04'), 'number');
});

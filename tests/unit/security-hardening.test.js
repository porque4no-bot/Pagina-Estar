/* Regression tests for the auditoría 360° security fixes:
 *   C-1  create-booking is retired (returns 410)
 *   A-1/A-2  get-booking requires a valid second factor and never discloses
 *            PII from an enumerated code alone
 *   A-3  purge-guest-data dates records from the timestamp in the blob key
 *   C-3  reconcile-payments recognizes direct-booking references */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function freshRequire(rel) {
  const resolved = require.resolve(rel);
  delete require.cache[resolved];
  return require(rel);
}

/* ── C-1: create-booking retired ─────────────────────────────── */
test('create-booking returns 410 Gone for POST', async () => {
  const fn = freshRequire('../../netlify/functions/create-booking');
  const res = await fn.handler({ httpMethod: 'POST', body: JSON.stringify({ checkin: '2026-08-10' }) });
  assert.equal(res.statusCode, 410);
  assert.match(res.body, /gone/);
});

test('create-booking still answers OPTIONS preflight', async () => {
  const fn = freshRequire('../../netlify/functions/create-booking');
  const res = await fn.handler({ httpMethod: 'OPTIONS' });
  assert.equal(res.statusCode, 200);
});

/* ── A-1/A-2: get-booking second factor ──────────────────────── */
test('get-booking identityMatches enforces email or full/partial surname', () => {
  const { identityMatches } = require('../../netlify/functions/get-booking')._test;
  const reservation = { guestLastName: 'García López', guestName: 'Ana García López', guestEmail: 'ana@example.com' };

  // Email (exact, case-insensitive) passes.
  assert.equal(identityMatches(reservation, 'ANA@example.com'), true);
  // Full surname passes.
  assert.equal(identityMatches(reservation, 'garcia lopez'), true);
  // A single real surname token passes (two-surname UX).
  assert.equal(identityMatches(reservation, 'García'), true);
  // Wrong surname / empty / too short fails.
  assert.equal(identityMatches(reservation, 'martinez'), false);
  assert.equal(identityMatches(reservation, ''), false);
  assert.equal(identityMatches(reservation, 'a'), false);
});

test('get-booking returns 400 when the second factor is missing', async () => {
  const fn = freshRequire('../../netlify/functions/get-booking');
  const res = await fn.handler({
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: { code: 'EST-ABC12' }
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /apellido|email/);
});

/* ── A-3: retention purge dating ─────────────────────────────── */
test('purge-guest-data dates records from the key timestamp', () => {
  const { timestampFromKey, isExpired, RETENTION_MS } = require('../../netlify/functions/purge-guest-data')._test;
  const now = Date.UTC(2031, 0, 1);
  const oldMs = now - RETENTION_MS - 86400000; // just over retention
  const recentMs = now - 86400000;             // yesterday

  assert.equal(timestampFromKey(`CHK-${oldMs}-AB12`), oldMs);
  assert.equal(timestampFromKey(`CHK-${oldMs}-AB12/2/registro-civil.jpg`), oldMs);
  assert.equal(timestampFromKey('no-timestamp-here'), null);

  assert.equal(isExpired(`CHK-${oldMs}-AB12`, now), true);
  assert.equal(isExpired(`GST-${recentMs}-abcd`, now), false);
  // Unparseable keys are never deleted (fail-safe).
  assert.equal(isExpired('weird-key', now), false);
});

/* ── C-3: reconcile recognizes direct references ─────────────── */
test('reconcile-payments decodes direct booking references', () => {
  const { createDirectReference } = require('../../netlify/functions/_payments');
  const { decodeDirectReference } = require('../../netlify/functions/_direct-pricing');
  // Build a Wompi-style direct ref the way the front-end does (version 1, base64url).
  const serialized = ['1', '260810', '260813', '2', '31349', 'Ana', 'García', 'ana@example.com', '+57300', '000000', 'EST-ABC12', '0', '0', '900000'].join('|');
  const b64 = Buffer.from(serialized, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decoded = decodeDirectReference(b64);
  assert.ok(decoded, 'direct ref should decode');
  assert.equal(decoded.bookingCode, 'EST-ABC12');
  assert.equal(decoded.roomTypeId, '31349');
});

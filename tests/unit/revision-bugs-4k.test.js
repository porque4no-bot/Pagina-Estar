/* Regression tests for the July 2026 full-project bug review (docs/revision-bugs-2026-07-10.md).
   Covers the pure/exported logic of the highest-value fixes so they can't silently regress. */
const test = require('node:test');
const assert = require('node:assert');

const { matchesAccessKey } = require('../../netlify/functions/_guest-app');
const purge = require('../../netlify/functions/purge-guest-data');

/* ── M13: guest-session second factor no longer accepts 2-char surname particles ── */
test('matchesAccessKey rejects 2-char surname particles ("de", "la")', () => {
  const booking = { guestLastName: 'de la Cruz' };
  assert.equal(matchesAccessKey(booking, 'de'), false);
  assert.equal(matchesAccessKey(booking, 'la'), false);
});

test('matchesAccessKey accepts a surname token of >= 3 chars', () => {
  assert.equal(matchesAccessKey({ guestLastName: 'de la Cruz' }, 'cruz'), true);
});

test('matchesAccessKey accepts the full surname at any length', () => {
  assert.equal(matchesAccessKey({ guestLastName: 'de la Cruz' }, 'de la cruz'), true);
});

test('matchesAccessKey still matches email exactly', () => {
  assert.equal(matchesAccessKey({ guestEmail: 'Ana@Correo.com' }, 'ana@correo.com'), true);
});

/* ── A1: the retention purge can date staged check-in draft keys (Blobs has no TTL) ── */
test('timestampFromKey parses a draft key "<sub>/<ms>-<hex>.json"', () => {
  assert.equal(purge._test.timestampFromKey('sub123/1717000000000-ab12.json'), 1717000000000);
});

test('timestampFromKey parses a draft key with a docKind prefix', () => {
  assert.equal(purge._test.timestampFromKey('sub/registro/1717000000000-ab.json'), 1717000000000);
});

test('timestampFromKey still parses legacy CHK-/GST- ids', () => {
  assert.equal(purge._test.timestampFromKey('CHK-1717000000000-AB12'), 1717000000000);
  assert.equal(purge._test.timestampFromKey('GST-1717000000000-ab12/2/registro-civil.jpg'), 1717000000000);
});

test('timestampFromKey returns null for an undatable key (fail-safe: kept, not purged)', () => {
  assert.equal(purge._test.timestampFromKey('no-timestamp-here'), null);
});

test('guest-checkin-drafts is included in the retention purge scope', () => {
  /* The store name must be purged: an abandoned draft holds an unencrypted-legacy
     or encrypted ID image that must not linger past retention. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../netlify/functions/purge-guest-data.js'), 'utf8');
  assert.ok(src.includes("'guest-checkin-drafts'"), 'guest-checkin-drafts must be in PII_STORES');
});

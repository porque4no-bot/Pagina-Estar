'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { shouldRemindExpiry } = require('../../netlify/functions/_quotes-store');
const { quoteExpiringHtml } = require('../../netlify/functions/_email');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-19T12:00:00Z');
const WINDOW = DAY;

function baseQuote(overrides) {
  return Object.assign({
    quoteId: 'COT-2026-ABCDE',
    email: 'cliente@empresa.co',
    contacto: 'Ana',
    empresa: 'ACME',
    status: 'activa',
    checkin: '2026-07-01',
    checkout: '2026-07-03',
    expiresAt: new Date(NOW + 12 * HOUR).toISOString() // within 24h window
  }, overrides || {});
}

test('reminds an actionable quote expiring within the window', () => {
  assert.equal(shouldRemindExpiry(baseQuote(), NOW, WINDOW), true);
  assert.equal(shouldRemindExpiry(baseQuote({ status: 'vista' }), NOW, WINDOW), true);
});

test('does not remind when expiry is beyond the window', () => {
  const q = baseQuote({ expiresAt: new Date(NOW + 3 * DAY).toISOString() });
  assert.equal(shouldRemindExpiry(q, NOW, WINDOW), false);
});

test('does not remind an already-expired quote', () => {
  const q = baseQuote({ expiresAt: new Date(NOW - HOUR).toISOString() });
  assert.equal(shouldRemindExpiry(q, NOW, WINDOW), false);
});

test('does not remind twice (reminderSentAt set)', () => {
  const q = baseQuote({ reminderSentAt: new Date(NOW - HOUR).toISOString() });
  assert.equal(shouldRemindExpiry(q, NOW, WINDOW), false);
});

test('does not remind without a client email', () => {
  assert.equal(shouldRemindExpiry(baseQuote({ email: '' }), NOW, WINDOW), false);
});

test('does not remind a cancelled or accepted quote', () => {
  assert.equal(shouldRemindExpiry(baseQuote({ status: 'cancelada' }), NOW, WINDOW), false);
  assert.equal(shouldRemindExpiry(baseQuote({ status: 'aceptada' }), NOW, WINDOW), false);
});

test('does not remind a quote that lost availability', () => {
  assert.equal(shouldRemindExpiry(baseQuote({ availabilityOk: false }), NOW, WINDOW), false);
});

test('handles missing/invalid input safely', () => {
  assert.equal(shouldRemindExpiry(null, NOW, WINDOW), false);
  assert.equal(shouldRemindExpiry(baseQuote({ expiresAt: 'not-a-date' }), NOW, WINDOW), false);
  assert.equal(shouldRemindExpiry({}, NOW, WINDOW), false);
});

test('quoteExpiringHtml renders the quote id, stay and the CTA url', () => {
  const url = 'https://www.hotelestar.co/cotizacion.html?id=COT-2026-ABCDE';
  const html = quoteExpiringHtml({ quote: baseQuote(), quoteUrl: url });
  assert.match(html, /COT-2026-ABCDE/);
  assert.ok(html.includes(url), 'CTA href must contain the quote url');
  assert.match(html, /vence pronto/i);
});

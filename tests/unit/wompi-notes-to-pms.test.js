'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { sanitizeIncomingNotes, notesToPmsEnabled } = require('../../netlify/functions/create-wompi-signature')._test;

test('sanitizeIncomingNotes: trims, collapses whitespace, caps at 500', () => {
  assert.equal(sanitizeIncomingNotes('  hola   mundo \n\t ok '), 'hola mundo ok');
  assert.equal(sanitizeIncomingNotes('x'.repeat(600)).length, 500);
});

test('sanitizeIncomingNotes: strips control characters', () => {
  const ctrl = String.fromCharCode(0) + String.fromCharCode(7) + String.fromCharCode(31) + String.fromCharCode(127);
  const input = 'a' + ctrl + 'b';
  assert.equal(sanitizeIncomingNotes(input), 'a b');
});

test('sanitizeIncomingNotes: non-string / empty → empty string', () => {
  assert.equal(sanitizeIncomingNotes(undefined), '');
  assert.equal(sanitizeIncomingNotes(null), '');
  assert.equal(sanitizeIncomingNotes(123), '');
  assert.equal(sanitizeIncomingNotes(''), '');
});

test('sanitizeIncomingNotes keeps ordinary punctuation (not stripped as a range)', () => {
  assert.equal(sanitizeIncomingNotes('Llego 11-12pm, piso #3 (gracias!)'), 'Llego 11-12pm, piso #3 (gracias!)');
});

test('sanitizeIncomingNotes strips angle brackets (defense-in-depth vs HTML)', () => {
  const out = sanitizeIncomingNotes('hola <script>alert(1)</script> ok');
  assert.ok(!out.includes('<') && !out.includes('>'), 'angle brackets removed');
});

test('notesToPmsEnabled reflects the GUEST_NOTES_TO_PMS_ENABLED flag', async () => {
  /* Ahora lee vía _settings.flag() (panel → env), y es async, para respetar el
     override del panel /admin igual que el consumidor (wompi-webhook). */
  const prev = process.env.GUEST_NOTES_TO_PMS_ENABLED;
  try {
    process.env.GUEST_NOTES_TO_PMS_ENABLED = 'true';
    assert.equal(await notesToPmsEnabled(), true);
    process.env.GUEST_NOTES_TO_PMS_ENABLED = 'false';
    assert.equal(await notesToPmsEnabled(), false);
    delete process.env.GUEST_NOTES_TO_PMS_ENABLED;
    assert.equal(await notesToPmsEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.GUEST_NOTES_TO_PMS_ENABLED; else process.env.GUEST_NOTES_TO_PMS_ENABLED = prev;
  }
});

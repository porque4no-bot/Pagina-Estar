'use strict';

/* Frente C — consentimiento de marketing en el motor de reserva directa.
   Cubre el parser del opt-in en create-wompi-signature (body, NO referencia) y
   el cableado a Odoo en wompi-webhook (tag 'Opt-in marketing' + Email Marketing
   solo con opt-in; sin opt-in = NO marketing, Ley 1581). */

const { test } = require('node:test');
const assert = require('node:assert');

const { parseMarketingOptIn } = require('../../netlify/functions/create-wompi-signature')._test;
const { buildGuestMarketing } = require('../../netlify/functions/wompi-webhook')._test;

test('parseMarketingOptIn: solo TRUE explícito cuenta como opt-in (Ley 1581)', () => {
  assert.equal(parseMarketingOptIn(true), true);
  assert.equal(parseMarketingOptIn('true'), true);
  assert.equal(parseMarketingOptIn(1), true);
  assert.equal(parseMarketingOptIn('1'), true);
});

test('parseMarketingOptIn: ausente / false / vacío = NO marketing', () => {
  assert.equal(parseMarketingOptIn(undefined), false);
  assert.equal(parseMarketingOptIn(null), false);
  assert.equal(parseMarketingOptIn(false), false);
  assert.equal(parseMarketingOptIn('false'), false);
  assert.equal(parseMarketingOptIn(''), false);
  assert.equal(parseMarketingOptIn(0), false);
  assert.equal(parseMarketingOptIn('on'), false); /* un value de checkbox HTML crudo NO cuenta */
  assert.equal(parseMarketingOptIn('yes'), false);
});

test('buildGuestMarketing: con opt-in añade tag y marca Email Marketing', () => {
  const out = buildGuestMarketing({ email: 'a@b.co' }, { accepted: true, email: 'a@b.co' });
  assert.equal(out.optIn, true);
  assert.deepEqual(out.tags, ['Huésped directo', 'Opt-in marketing']);
  assert.equal(out.addToMailing, true);
});

test('buildGuestMarketing: sin blob de opt-in = NO marketing (solo tag de canal)', () => {
  const out = buildGuestMarketing({ email: 'a@b.co' }, null);
  assert.equal(out.optIn, false);
  assert.deepEqual(out.tags, ['Huésped directo']);
  assert.equal(out.addToMailing, false);
});

test('buildGuestMarketing: accepted !== true se trata como NO opt-in', () => {
  for (const bad of [{ accepted: false }, { accepted: 'true' }, { accepted: 1 }, {}]) {
    const out = buildGuestMarketing({ email: 'a@b.co' }, bad);
    assert.equal(out.optIn, false, JSON.stringify(bad));
    assert.deepEqual(out.tags, ['Huésped directo']);
    assert.equal(out.addToMailing, false);
  }
});

test('buildGuestMarketing: opt-in sin email NO va a Email Marketing (addToMailingList exige email)', () => {
  const out = buildGuestMarketing({ email: '' }, { accepted: true });
  assert.equal(out.optIn, true);
  assert.deepEqual(out.tags, ['Huésped directo', 'Opt-in marketing']);
  assert.equal(out.addToMailing, false);
});

test('i18n: claves de opt-in con paridad ES/EN', () => {
  const es = require('../../i18n/motor.es.json');
  const en = require('../../i18n/motor.en.json');
  for (const key of ['marketingOptIn', 'marketingOptInHelp']) {
    assert.equal(typeof es[key], 'string', `ES falta ${key}`);
    assert.equal(typeof en[key], 'string', `EN falta ${key}`);
    assert.ok(es[key].length > 0 && en[key].length > 0, `${key} no debe estar vacío`);
  }
});

/* M-2: the booking-engine extras prices live in TWO places — the server
 * (_pricing.js, used to verify the paid amount) and the front-end
 * (reservar.html calcTotal / BE_EXTRAS, used to show the price). If they
 * diverge, the server rejects legitimate payments as price_mismatch. This test
 * parses reservar.html and asserts it still matches the single source of truth,
 * so any future edit to one side without the other fails CI. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { EXTRAS_PRICES, EXTRA_GUEST_SURCHARGE } = require('../../netlify/functions/_pricing');

const reservarHtml = fs.readFileSync(path.join(__dirname, '../../reservar.html'), 'utf8');

function numberAfter(pattern) {
  const m = reservarHtml.match(pattern);
  assert.ok(m, `pattern not found in reservar.html: ${pattern}`);
  return parseInt(m[1], 10);
}

test('reservar.html calcTotal extras prices match _pricing', () => {
  // if(extras.desayuno)ex+=20000*search.guests*nights;
  assert.equal(numberAfter(/extras\.desayuno\)\s*ex\s*\+=\s*(\d+)\s*\*\s*search\.guests/),
    EXTRAS_PRICES.desayuno.price, 'desayuno price drifted between front-end and server');
  // if(extras.late)ex+=60000;
  assert.equal(numberAfter(/extras\.late\)\s*ex\s*\+=\s*(\d+)/),
    EXTRAS_PRICES.late.price, 'late price drifted');
  // if(extras.early)ex+=50000;
  assert.equal(numberAfter(/extras\.early\)\s*ex\s*\+=\s*(\d+)/),
    EXTRAS_PRICES.early.price, 'early price drifted');
});

test('reservar.html BE_EXTRAS catalogue prices match _pricing', () => {
  const beExtras = reservarHtml.match(/const BE_EXTRAS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(beExtras, 'BE_EXTRAS array not found');
  const block = beExtras[1];
  const priceFor = (id) => {
    const re = new RegExp(`id:'${id}'[\\s\\S]*?price:\\s*(\\d+)`);
    const m = block.match(re);
    assert.ok(m, `BE_EXTRAS entry for ${id} not found`);
    return parseInt(m[1], 10);
  };
  assert.equal(priceFor('desayuno'), EXTRAS_PRICES.desayuno.price);
  assert.equal(priceFor('late'), EXTRAS_PRICES.late.price);
  assert.equal(priceFor('early'), EXTRAS_PRICES.early.price);
});

test('server modules consume the shared _pricing source', () => {
  const directPricing = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_direct-pricing.js'), 'utf8');
  const otasync = fs.readFileSync(path.join(__dirname, '../../netlify/functions/_otasync.js'), 'utf8');
  const availability = fs.readFileSync(path.join(__dirname, '../../netlify/functions/check-availability.js'), 'utf8');
  assert.match(directPricing, /require\('\.\/_pricing'\)/, '_direct-pricing should import _pricing');
  assert.match(otasync, /require\('\.\/_pricing'\)/, '_otasync should import _pricing');
  assert.match(availability, /require\('\.\/_pricing'\)/, 'check-availability should import _pricing');
  // The surcharge literal should no longer be hardcoded in check-availability.
  assert.ok(!/\b31000\b/.test(availability), 'check-availability should not hardcode 31000');
  assert.equal(EXTRA_GUEST_SURCHARGE, 31000);
});

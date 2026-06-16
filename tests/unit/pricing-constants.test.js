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

function floatAfter(pattern) {
  const m = reservarHtml.match(pattern);
  assert.ok(m, `pattern not found in reservar.html: ${pattern}`);
  return parseFloat(m[1]);
}

test('reservar.html calcTotal extras math matches _pricing', () => {
  // lines.push({key:'desayuno',amount:20000*search.guests*nights})
  assert.equal(numberAfter(/extras\.desayuno\)lines\.push\(\{key:'desayuno',amount:(\d+)\*search\.guests/),
    EXTRAS_PRICES.desayuno.price, 'desayuno price drifted between front-end and server');
  // late check-out = 15% of the base nightly
  assert.equal(floatAfter(/extras\.late\)lines\.push\(\{key:'late',amount:Math\.round\(base\*([\d.]+)\)/),
    EXTRAS_PRICES.late.pct, 'late pct drifted');
  // early check-in tiers = 15 / 35 / 50 % of the base nightly
  assert.equal(floatAfter(/extras\.early==='t1'\)lines\.push\(\{key:'early',tier:'t1',amount:Math\.round\(base\*([\d.]+)\)/),
    EXTRAS_PRICES.early.pct, 'early t1 pct drifted');
  assert.equal(floatAfter(/extras\.early==='t2'\)lines\.push\(\{key:'early',tier:'t2',amount:Math\.round\(base\*([\d.]+)\)/),
    EXTRAS_PRICES.early2.pct, 'early t2 pct drifted');
  assert.equal(floatAfter(/extras\.early==='t3'\)lines\.push\(\{key:'early',tier:'t3',amount:Math\.round\(base\*([\d.]+)\)/),
    EXTRAS_PRICES.early3.pct, 'early t3 pct drifted');
  // mascota = flat charge (VAT included)
  assert.equal(numberAfter(/extras\.mascota\?(\d+)/),
    EXTRAS_PRICES.mascota.price, 'mascota price drifted');
});

test('reservar.html BE_EXTRAS catalogue matches _pricing', () => {
  const beExtras = reservarHtml.match(/const BE_EXTRAS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(beExtras, 'BE_EXTRAS array not found');
  const block = beExtras[1];
  const numFor = (id, field) => {
    const re = new RegExp(`id:'${id}'[\\s\\S]*?${field}:\\s*([\\d.]+)`);
    const m = block.match(re);
    assert.ok(m, `BE_EXTRAS entry for ${id} (${field}) not found`);
    return parseFloat(m[1]);
  };
  assert.equal(numFor('desayuno', 'price'), EXTRAS_PRICES.desayuno.price);
  assert.equal(numFor('late', 'pct'), EXTRAS_PRICES.late.pct);
  assert.equal(numFor('mascota', 'price'), EXTRAS_PRICES.mascota.price);
  // early check-in tiers
  assert.equal(numFor('t1', 'pct'), EXTRAS_PRICES.early.pct);
  assert.equal(numFor('t2', 'pct'), EXTRAS_PRICES.early2.pct);
  assert.equal(numFor('t3', 'pct'), EXTRAS_PRICES.early3.pct);
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

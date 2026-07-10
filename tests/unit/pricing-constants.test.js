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
  // const desayunoSub = extras.desayuno ? 20000*search.guests*nights : 0
  assert.equal(numberAfter(/desayunoSub = extras\.desayuno \? (\d+)\*search\.guests/),
    EXTRAS_PRICES.desayuno.price, 'desayuno price drifted between front-end and server');
  // const lateSub = extras.late ? Math.round(base*0.15) : 0
  assert.equal(floatAfter(/lateSub = extras\.late \? Math\.round\(base\*([\d.]+)\)/),
    EXTRAS_PRICES.late.pct, 'late pct drifted');
  // desayuno tributa INC 8% (no IVA 19%) — decisión dueño; verifica el % en calcTotal
  assert.equal(floatAfter(/const inc=Math\.round\(desayunoSub\*([\d.]+)\)/), 0.08, 'INC del desayuno debe ser 8%');
  // early check-in ya NO se vende en el motor (solo en el check-in) → no se valida aquí.
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
  // early check-in fue removido del motor (solo se compra en el check-in).
  assert.ok(!/id:'early'/.test(block), 'early NO debe estar en BE_EXTRAS del motor');
  assert.equal(numFor('mascota', 'price'), EXTRAS_PRICES.mascota.price);
});

test('early check-in: solo en el check-in (guest), 25% redondeado a $5.000', () => {
  const { SERVICES } = require('../../netlify/functions/_services-catalog');
  assert.deepEqual(SERVICES.early.surfaces, ['guest'], 'early solo en guest');
  assert.equal(SERVICES.early.pct, 0.25);
  assert.equal(SERVICES.early.round5k, true);
  // priceForService redondea a 5.000: 25% de una noche de $224.900 = 56.225 → 55.000
  const { _test } = require('../../netlify/functions/guest-action');
  if (_test && _test.priceForService) {
    assert.equal(_test.priceForService(SERVICES.early, 224900), 55000);
    assert.equal(_test.priceForService(SERVICES.late, 224900), Math.round(0.15 * 224900));
  }
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

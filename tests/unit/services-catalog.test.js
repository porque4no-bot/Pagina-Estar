/* Anti-divergence guard for additional-service pricing. The three surfaces
 * (booking engine, corporate quotes, guest app) each declare their own service
 * prices and historically drifted (desayuno was 20k/25k/28k at once). This test
 * parses each surface and asserts it matches netlify/functions/_services-catalog.js,
 * so a future edit to one side without the others fails CI.
 *
 * Only the agreed/consistent values are enforced. Known-pending items (guest-app
 * late check-out as %-of-night, traslado/tour/parqueadero surface placement) are
 * NOT asserted here — they await the owner's surface-matrix decision. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SERVICES } = require('../../netlify/functions/_services-catalog');
const { EXTRAS_PRICES } = require('../../netlify/functions/_pricing');

const root = path.join(__dirname, '../..');
const cotizarAdmin = fs.readFileSync(path.join(root, 'cotizar-admin.html'), 'utf8');
const guestAction = fs.readFileSync(path.join(root, 'netlify/functions/guest-action.js'), 'utf8');

test('booking engine (_pricing.js) matches the services catalogue', () => {
  assert.equal(EXTRAS_PRICES.desayuno.price, SERVICES.desayuno.price, 'desayuno price drifted');
  assert.equal(EXTRAS_PRICES.late.pct, SERVICES.late.pct, 'late pct drifted');
  assert.equal(EXTRAS_PRICES.early.pct, SERVICES.early.pct, 'early pct drifted');
  assert.equal(EXTRAS_PRICES.mascota.price, SERVICES.mascota.price, 'mascota price drifted');
});

test('quote admin (cotizar-admin.html SERVICE_DEFS) matches the catalogue', () => {
  const block = cotizarAdmin.match(/const SERVICE_DEFS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, 'SERVICE_DEFS not found in cotizar-admin.html');
  const priceFor = (key) => {
    const m = block[1].match(new RegExp(`key:\\s*'${key}'[\\s\\S]*?price:\\s*(\\d+)`));
    assert.ok(m, 'SERVICE_DEFS entry not found: ' + key);
    return parseInt(m[1], 10);
  };
  assert.equal(priceFor('desayuno'), SERVICES.desayuno.price, 'desayuno drifted in quotes');
  assert.equal(priceFor('almuerzo'), SERVICES.almuerzo.price, 'almuerzo drifted');
  assert.equal(priceFor('cena'), SERVICES.cena.price, 'cena drifted');
  assert.equal(priceFor('personaAdicional'), SERVICES.personaAdicional.price, 'personaAdicional drifted');
});

test('guest app (guest-action.js SERVICE_CATALOG) matches the catalogue', () => {
  const block = guestAction.match(/const SERVICE_CATALOG\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(block, 'SERVICE_CATALOG not found in guest-action.js');
  const priceFor = (key) => {
    const m = block[1].match(new RegExp(`${key}:\\s*\\{[^}]*?price:\\s*(\\d+)`));
    assert.ok(m, 'SERVICE_CATALOG entry not found: ' + key);
    return parseInt(m[1], 10);
  };
  assert.equal(priceFor('breakfast'), SERVICES.desayuno.price, 'breakfast must equal canonical desayuno');
  assert.equal(priceFor('laundry'), SERVICES.laundry.price, 'laundry drifted');
  assert.equal(priceFor('airport_transfer'), SERVICES.airport_transfer.price, 'airport_transfer drifted');
  assert.equal(priceFor('city_experience'), SERVICES.city_experience.price, 'city_experience drifted');
});

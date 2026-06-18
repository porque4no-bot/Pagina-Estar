/* Anti-divergence guard for additional-service pricing. The three surfaces
 * (booking engine, corporate quotes, guest app) each declare their own service
 * prices and historically drifted (desayuno was 20k/25k/28k at once). This test
 * parses each surface and asserts it matches netlify/functions/_services-catalog.js,
 * so a future edit to one side without the others fails CI.
 *
 * The guest app now READS its catalogue from _services-catalog (guest-action.js),
 * so the guest checks below verify the derivation AND that guest.html's UI prices
 * (flat data-service-price and %-of-night data-service-pct, plus the visible
 * price text) match the catalogue. Parqueadero was retired from every surface. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SERVICES } = require('../../netlify/functions/_services-catalog');
const { EXTRAS_PRICES } = require('../../netlify/functions/_pricing');

const root = path.join(__dirname, '../..');
const cotizarAdmin = fs.readFileSync(path.join(root, 'cotizar-admin.html'), 'utf8');
const guestHtml = fs.readFileSync(path.join(root, 'guest.html'), 'utf8');
// guest-action builds its catalogue from _services-catalog at module load, so we
// read the derived result from the module instead of parsing a hardcoded literal.
const guestAction = require('../../netlify/functions/guest-action');

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

test('guest app (guest-action.js) derives its catalogue from the single source', () => {
  const { SERVICE_CATALOG, GUEST_SERVICE_KEYS } = guestAction._test;
  for (const [guestId, catalogKey] of Object.entries(GUEST_SERVICE_KEYS)) {
    const svc = SERVICES[catalogKey];
    const offered = svc && Array.isArray(svc.surfaces) && svc.surfaces.includes('guest');
    if (!offered) {
      assert.ok(!(guestId in SERVICE_CATALOG), `${guestId} should not be offered (catalogue surface is not 'guest')`);
      continue;
    }
    const entry = SERVICE_CATALOG[guestId];
    assert.ok(entry, `guest service ${guestId} missing from derived catalogue`);
    assert.equal(entry.name, svc.es, `${guestId} name drifted from the catalogue`);
    if (svc.multiplier === 'pctOfNight') {
      assert.equal(entry.pct, svc.pct, `${guestId} pct drifted from the catalogue`);
      assert.ok(!('price' in entry), `${guestId} must be priced by pct, not a flat price`);
    } else {
      assert.equal(entry.price, svc.price, `${guestId} price drifted from the catalogue`);
    }
  }
  // Parqueadero was retired from every surface — it must not reappear here.
  assert.ok(!('parking' in SERVICE_CATALOG), 'parking must not be offered in the guest app');
});

test('guest app UI (guest.html) prices match the catalogue', () => {
  const { GUEST_SERVICE_KEYS } = guestAction._test;
  const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // Each card: data-service-id + either a flat data-service-price or a
  // %-of-night data-service-pct. Attribute order is fixed by convention so the
  // visible <strong> price text can be checked against the catalogue too.
  const cardRe = /<article class="guest-service-card" data-service-id="([^"]+)" data-service-(price|pct)="([^"]+)">([\s\S]*?)<\/article>/g;
  const seen = new Set();
  let m;
  while ((m = cardRe.exec(guestHtml)) !== null) {
    const [, guestId, kind, rawValue, block] = m;
    seen.add(guestId);
    const catalogKey = GUEST_SERVICE_KEYS[guestId];
    assert.ok(catalogKey, `guest.html has an unmapped service id: ${guestId}`);
    const svc = SERVICES[catalogKey];
    assert.ok(svc && svc.surfaces.includes('guest'), `${guestId} is not a guest-surface service`);
    const strong = block.match(/<strong[^>]*>([^<]*)<\/strong>/);
    assert.ok(strong, `${guestId} card has no price element`);
    if (kind === 'pct') {
      assert.equal(svc.multiplier, 'pctOfNight', `${guestId} should be a %-of-night card in guest.html`);
      assert.equal(Number(rawValue), svc.pct, `${guestId} data-service-pct drifted from the catalogue`);
    } else {
      assert.notEqual(svc.multiplier, 'pctOfNight', `${guestId} should be a flat-price card in guest.html`);
      assert.equal(parseInt(rawValue, 10), svc.price, `${guestId} data-service-price drifted from the catalogue`);
      assert.equal(strong[1].trim(), `$${thousands(svc.price)}`, `${guestId} visible price text drifted from the catalogue`);
    }
  }
  // Every guest-surface service must have a card — nothing silently dropped.
  for (const [guestId, catalogKey] of Object.entries(GUEST_SERVICE_KEYS)) {
    const svc = SERVICES[catalogKey];
    if (svc && svc.surfaces.includes('guest')) {
      assert.ok(seen.has(guestId), `guest.html is missing a card for ${guestId}`);
    }
  }
});

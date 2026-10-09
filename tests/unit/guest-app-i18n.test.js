/* Guest app bilingüe (frente guestapp):
   - build.js genera dist/en/guest.html desde el guest.html bilingüe;
   - nada de voseo ni textos de relleno ("Disponible próximamente");
   - "Pagar en línea" ya no está fijo en el HTML (lo arma la app según el modo);
   - el diccionario inline de guest-app.js está sincronizado con i18n/guest.*.json. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const { buildEnglishGuestHtml, EN_TITLE } = require('../../build-guest-en');

test('buildEnglishGuestHtml switches lang, title, description and climbs asset paths', () => {
  const html = '<html lang="es"><head><title>Mi estadía · estar</title>' +
    '<meta name="description" content="Guest app de Estar">' +
    '<link rel="stylesheet" href="guest-app.css?v=4"><link rel="icon" href="assets/favicon.png">' +
    '<script src="guest-app.js?v=4" defer></script></head><body><a href="#main" class="skip-link">Saltar al contenido principal</a>' +
    '<img src="assets/photos/a.webp"><a href="index.html">x</a><a href="privacidad.html">y</a></body></html>';
  const out = buildEnglishGuestHtml(html);
  assert.match(out, /<html lang="en">/);
  assert.match(out, new RegExp(`<title>${EN_TITLE}</title>`));
  assert.doesNotMatch(out, /Guest app de Estar/);
  assert.match(out, /href="\.\.\/guest-app\.css\?v=4"/);
  assert.match(out, /href="\.\.\/assets\/favicon\.png"/);
  assert.match(out, /src="\.\.\/assets\/photos\/a\.webp"/);
  assert.match(out, /src="\.\.\/guest-app\.js\?v=4"/);
  assert.match(out, />Skip to main content</);
  assert.match(out, /href="index\.html"/, 'los enlaces a páginas quedan relativos (→ /en/)');
  assert.match(out, /href="privacidad\.html"/);
});

test('the build ships an English guest app without Spanish-only blocks', () => {
  assert.ok(fs.existsSync(path.join(dist, 'en', 'guest.html')), 'Run npm run build first');
  const en = fs.readFileSync(path.join(dist, 'en', 'guest.html'), 'utf8');
  const es = fs.readFileSync(path.join(dist, 'guest.html'), 'utf8');
  assert.match(en, /<html lang="en">/);
  assert.match(en, /<title>My stay · estar<\/title>/);
  assert.doesNotMatch(en, /class="[^"]*\blang-es\b/);
  assert.doesNotMatch(es, /class="[^"]*\blang-en\b/);
  assert.match(en, /Find your booking/);
  assert.match(en, /Complete check-in/);
  assert.doesNotMatch(en, /Encuentra tu reserva/);
  assert.match(en, /href="\.\.\/guest\.html"[^>]*>Español/);
  assert.match(es, /href="en\/guest\.html"[^>]*>English/);
  /* Los íconos de la guest app se dibujan con Lucide en tiempo de ejecución. */
  assert.match(es, /unpkg\.com\/lucide@/);
  assert.match(en, /unpkg\.com\/lucide@/);
});

test('no voseo and no placeholder documents in the guest app', () => {
  const sources = [read('guest.html'), read('guest-app.js'), read('i18n/guest.es.json')].join('\n');
  for (const word of ['Encuadrá', 'probá', 'Podés', 'podés']) {
    assert.ok(!sources.includes(word), `voseo: ${word}`);
  }
  assert.doesNotMatch(read('guest.html'), /Disponible próximamente/);
  assert.doesNotMatch(read('guest.html'), /Facturas y documentos/);
});

test('"Pagar en línea" is not hard-coded in the HTML (rendered from the session)', () => {
  const html = read('guest.html');
  assert.doesNotMatch(html, /<option value="online"/);
  assert.match(read('guest-app.js'), /onlinePayment/);
});

test('the desktop upload button exists and is wired to the file input', () => {
  const html = read('guest.html');
  assert.match(html, /id="uploadDocument"/);
  assert.match(read('guest-app.js'), /#uploadDocument[\s\S]*#identityDocument/);
});

test('inline dictionaries in guest-app.js match i18n/guest.*.json', () => {
  const js = read('guest-app.js');
  for (const lang of ['es', 'en']) {
    const L = lang.toUpperCase();
    const match = js.match(new RegExp(`/\\*__GUEST_I18N_${L}_START__\\*/([\\s\\S]*?)/\\*__GUEST_I18N_${L}_END__\\*/`));
    assert.ok(match, `markers for ${lang}`);
    assert.deepEqual(JSON.parse(match[1]), JSON.parse(read(`i18n/guest.${lang}.json`)), `inline ${lang} dict drifted`);
  }
});

test('the guest app scripts are cache-busted (JS/CSS are cached for a year)', () => {
  const html = read('guest.html');
  assert.match(html, /guest-app\.js\?v=4/);
  assert.match(html, /guest-app\.css\?v=4/);
});

test('/en/guest.html keeps the guest-app privacy + camera headers', () => {
  const config = read('netlify.toml');
  assert.match(config, /for = "\/en\/guest\.html"[\s\S]*?X-Robots-Tag = "noindex, nofollow, noarchive"[\s\S]*?Permissions-Policy = "camera=\(self\)/);
});

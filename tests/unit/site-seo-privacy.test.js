/* Frente site — privacidad, analítica y SEO del sitio público.
   - GA4 no se inyecta en páginas privadas o con tokens (build-ga4.js).
   - La URL que se le reporta a GA4 va sin datos personales (external_reference
     de Mercado Pago, tokens, #hash) — se prueba la función real Y el snippet tal
     como sale en dist/, ejecutado en un sandbox.
   - sitemap con reservar.html (ES/EN) y lastmod del build; hreflang del motor.
   - JSON-LD del home sin aggregateRating de Booking y con paridad EN.
   - Textos legales: cookies reales, datos no "anónimos", privacidad corregida.
   Requiere `npm run build` (test:unit lo corre antes). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const readDist = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');

const { isGa4Excluded, cleanAnalyticsUrl, ANALYTICS_QUERY_ALLOWLIST_SOURCE } = require(path.join(root, 'build-ga4.js'));
const KEEP = new RegExp(ANALYTICS_QUERY_ALLOWLIST_SOURCE, 'i');

const PRIVATE_PAGES = [
  'cotizacion.html', 'datos-cuenta.html', 'en/datos-cuenta.html', 'pase-desayuno.html',
  'guest.html', 'cotizar-admin.html', 'desayuno.html', 'desayuno-admin.html',
  'aseo.html', 'portal.html', 'en/portal.html'
];
const PUBLIC_PAGES = [
  'index.html', 'en/index.html', 'reservar.html', 'en/reservar.html', 'empresas.html',
  'en/empresas.html', 'trabaja.html', 'cookies.html', 'en/cookies.html', 'clasica.html', 'en/clasica.html'
];

/* ── Exclusiones de GA4 ── */
test('isGa4Excluded cubre las páginas privadas/con token (ES y EN) y no las públicas', () => {
  for (const p of PRIVATE_PAGES) assert.equal(isGa4Excluded(p), true, p);
  assert.equal(isGa4Excluded('desayuno-nuevo-panel.html'), true, 'cualquier desayuno*.html');
  for (const p of PUBLIC_PAGES) assert.equal(isGa4Excluded(p), false, p);
});

test('dist: las páginas privadas salen SIN gtag, Consent Mode ni banner', () => {
  for (const p of PRIVATE_PAGES) {
    const html = readDist(p);
    assert.ok(!/googletagmanager\.com/.test(html), `${p} no debe cargar gtag.js`);
    assert.ok(!/consent\.js/.test(html), `${p} no debe cargar el banner`);
  }
});

test('dist: las páginas públicas sí llevan GA4 + Consent Mode (denegado por defecto) + consent.js', () => {
  for (const p of PUBLIC_PAGES) {
    const html = readDist(p);
    assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-9PB0Z2KQJK/, p);
    assert.match(html, /gtag\('consent','default',\{ad_storage:'denied'[^}]*analytics_storage:'denied'/, p);
    /* El cache-busting del frente motor agrega ?v=<hash> a los scripts locales. */
    assert.match(html, /<script src="\/consent\.js(\?v=[0-9a-f]+)?" defer><\/script>/, p);
  }
});

/* ── URL limpia para GA4 ── */
test('cleanAnalyticsUrl quita external_reference de Mercado Pago, ids de pago y el #hash', () => {
  const ref = 'MPDIR-' + Buffer.from('2|261010|261012|2|31348|Ana|Pérez|ana@mail.co|3001234567|0|EST-1|1|0').toString('base64');
  const url = `https://estar.com.co/reservar.html?payment=success&collection_id=123&payment_id=123&external_reference=${encodeURIComponent(ref)}&preference_id=abc#x`;
  const clean = cleanAnalyticsUrl(url, url, KEEP);
  assert.equal(clean, 'https://estar.com.co/reservar.html?payment=success');
  assert.ok(!/ana|EST-1|MPDIR/i.test(clean));
});

test('cleanAnalyticsUrl conserva UTM, ids de clic y la búsqueda del motor', () => {
  const url = 'https://estar.com.co/reservar.html?checkin=2026-10-10&checkout=2026-10-12&guests=2&room=clasica&utm_source=ig&utm_campaign=oct&gclid=G1&email=a%40b.co&token=SECRET';
  assert.equal(
    cleanAnalyticsUrl(url, url, KEEP),
    'https://estar.com.co/reservar.html?checkin=2026-10-10&checkout=2026-10-12&guests=2&room=clasica&utm_source=ig&utm_campaign=oct&gclid=G1'
  );
});

test('cleanAnalyticsUrl limpia el referrer interno con token (cotización, datos de cuenta)', () => {
  assert.equal(
    cleanAnalyticsUrl('https://estar.com.co/cotizacion.html?id=COT-1&token=abc', 'https://estar.com.co/', KEEP),
    'https://estar.com.co/cotizacion.html'
  );
});

test('el snippet GA4 tal como sale en dist fija page_location/page_referrer limpios antes de config', () => {
  const html = readDist('reservar.html');
  const m = html.match(/<script>\s*window\.dataLayer = window\.dataLayer \|\| \[\];[\s\S]*?<\/script>/);
  assert.ok(m, 'snippet GA4 inline');
  const body = m[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  const pageUrl = 'https://estar.com.co/reservar.html?payment=success&external_reference=MPDIR-QW5hfGFuYUBtYWlsLmNv&utm_source=mail';
  const sandbox = {
    window: {},
    URL,
    location: new URL(pageUrl),
    document: { referrer: 'https://estar.com.co/datos-cuenta.html?token=SECRETO' },
    Date
  };
  sandbox.window = sandbox;
  sandbox.dataLayer = [];
  vm.runInNewContext(body, sandbox);
  const calls = sandbox.dataLayer.map(a => Array.from(a));
  const set = calls.find(c => c[0] === 'set');
  const config = calls.find(c => c[0] === 'config' && c[1] === 'G-9PB0Z2KQJK');
  assert.ok(set && config, 'set + config');
  assert.ok(calls.indexOf(set) < calls.indexOf(config), 'set va antes de config');
  assert.equal(config[2].page_location, 'https://estar.com.co/reservar.html?payment=success&utm_source=mail');
  assert.equal(config[2].page_referrer, 'https://estar.com.co/datos-cuenta.html');
  assert.equal(set[1].page_location, config[2].page_location);
  assert.ok(!JSON.stringify(calls).includes('MPDIR'), 'nada de la referencia de pago llega a dataLayer');
  assert.ok(!JSON.stringify(calls).includes('SECRETO'), 'nada del token del referrer llega a dataLayer');
  const consentIdx = calls.findIndex(c => c[0] === 'consent' && c[1] === 'default');
  assert.ok(consentIdx > -1 && consentIdx < calls.indexOf(config), 'Consent Mode default antes de config');
});

/* ── Sitemap + hreflang ── */
test('sitemap fuente: reservar ES/EN con lastmod __BUILD_DATE__ (solo esas URLs)', () => {
  const src = read('sitemap.xml');
  assert.match(src, /<loc>https:\/\/estar\.com\.co\/reservar\.html<\/loc><lastmod>__BUILD_DATE__<\/lastmod>/);
  assert.match(src, /<loc>https:\/\/estar\.com\.co\/en\/reservar\.html<\/loc><lastmod>__BUILD_DATE__<\/lastmod>/);
});

test('sitemap en dist: fecha real del build, sin marcadores, y cada URL existe', () => {
  const xml = readDist('sitemap.xml');
  assert.ok(!xml.includes('__BUILD_DATE__'), 'el build reemplaza el marcador');
  const today = new Date().toISOString().slice(0, 10);
  const m = xml.match(/<loc>https:\/\/estar\.com\.co\/reservar\.html<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/);
  assert.ok(m, 'reservar.html con lastmod');
  assert.ok(Math.abs(new Date(m[1]) - new Date(today)) <= 86400000, `lastmod del build (${m[1]})`);
  assert.match(xml, /<loc>https:\/\/estar\.com\.co\/en\/reservar\.html<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  const locs = [...xml.matchAll(/<loc>https:\/\/estar\.com\.co\/([^<]*)<\/loc>/g)].map(x => x[1]);
  const missing = locs.filter(rel => !fs.existsSync(path.join(dist, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel)));
  assert.deepEqual(missing, [], `URLs del sitemap sin página: ${missing.join(', ')}`);
  for (const p of PRIVATE_PAGES) assert.ok(!locs.includes(p), `${p} no va en el sitemap`);
});

test('reservar.html ES y EN declaran hreflang es/en/x-default recíprocos', () => {
  for (const rel of ['reservar.html', 'en/reservar.html']) {
    const html = read(rel);
    assert.match(html, /<link rel="alternate" hreflang="es" href="https:\/\/estar\.com\.co\/reservar\.html">/, rel);
    assert.match(html, /<link rel="alternate" hreflang="en" href="https:\/\/estar\.com\.co\/en\/reservar\.html">/, rel);
    assert.match(html, /<link rel="alternate" hreflang="x-default" href="https:\/\/estar\.com\.co\/reservar\.html">/, rel);
  }
});

/* ── JSON-LD del home ── */
function homeSchema(rel) {
  const html = readDist(rel);
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test('JSON-LD del home (ES/EN): sin aggregateRating/review de Booking (pautas de Google)', () => {
  for (const rel of ['index.html', 'en/index.html']) {
    const json = JSON.stringify(homeSchema(rel));
    assert.ok(!/aggregateRating|AggregateRating|"review"/i.test(json), `${rel} no debe marcar reseñas de terceros`);
  }
  assert.ok(!/biz\.aggregateRating/.test(readDist('index.html')), 'ni el script que lo reescribía');
});

test('JSON-LD del home: paridad EN (mismas habitaciones y datos) y URLs que existen', () => {
  const es = homeSchema('index.html')[0];
  const en = homeSchema('en/index.html')[0];
  assert.equal(es['@type'], 'LodgingBusiness');
  assert.equal(en['@type'], 'LodgingBusiness');
  assert.deepEqual(en.address, es.address, 'misma dirección');
  assert.deepEqual(en.geo, es.geo, 'mismas coordenadas');
  assert.equal(en.containsPlace.length, es.containsPlace.length);
  es.containsPlace.forEach((room, i) => {
    const other = en.containsPlace[i];
    assert.equal(other.name, room.name);
    assert.deepEqual(other.occupancy, room.occupancy, room.name);
    assert.deepEqual(other.bed, room.bed, room.name);
    assert.deepEqual(other.floorSize, room.floorSize, room.name);
    assert.ok(other.description && room.description, `${room.name} con descripción en ambos idiomas`);
  });
  for (const r of [...es.containsPlace, ...en.containsPlace]) {
    const rel = r.url.replace('https://estar.com.co/', '');
    assert.ok(fs.existsSync(path.join(dist, rel)), `${r.url} existe en dist`);
  }
  assert.ok(en.containsPlace.every(r => r.url.includes('/en/')), 'el home EN enlaza las fichas EN');
});

/* ── Paridad EN: enlaces legales de páginas EN no apuntan a la versión ES ── */
test('páginas EN: enlaces legales del footer y de formularios apuntan a la versión EN', () => {
  const enDir = path.join(root, 'en');
  const bad = [];
  for (const f of fs.readdirSync(enDir).filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(enDir, f), 'utf8');
    const re = /<a href="\.\.\/(aviso-legal|cancelacion|privacidad|cookies|escnna)\.html"([^>]*)>/g;
    let m;
    while ((m = re.exec(html))) {
      if (/class="lang-toggle"/.test(m[2])) continue; // el botón "ES" sí lleva a la versión española
      bad.push(`en/${f} → ../${m[1]}.html`);
    }
  }
  assert.deepEqual(bad, []);
});

/* ── Textos legales ── */
test('cookies (ES/EN): lista las cookies reales y no llama "anónimos" a los datos', () => {
  const es = read('cookies.html');
  const en = read('en/cookies.html');
  for (const [lbl, html] of [['es', es], ['en', en]]) {
    for (const name of ['_ga', '_ga_9PB0Z2KQJK', '_fbp', 'estar-cookie-consent-v1', 'estar-booking-draft', 'estar-mp-pending']) {
      assert.ok(html.includes(`<strong>${name}</strong>`), `${lbl}: ${name}`);
    }
    assert.match(html, /data-cookie-settings/, `${lbl}: botón para cambiar la elección`);
    assert.ok(!/atmósfera|atmosphere/i.test(html), `${lbl}: sin la personalización que ya no existe`);
  }
  assert.ok(!/de forma anónima/i.test(es), 'ES no promete anonimato');
  assert.match(es, /no son anónimos/);
  assert.ok(!/collect anonymous data/i.test(en) && !/collect anonymous data/i.test(es), 'EN no promete anonimato');
  assert.match(en, /not anonymous/);
});

test('privacidad (ES/EN): GA como encargado, selección de personal, 5 años y SIRE/TRA exactos', () => {
  const root_ = read('privacidad.html');
  const en = read('en/privacidad.html');
  assert.match(root_, /<strong>Google Analytics<\/strong> \(Google LLC\)/);
  assert.match(root_, /<h2>7\. Selección de Personal<\/h2>/);
  assert.match(root_, /cinco \(5\) años/);
  assert.match(root_, /huéspedes extranjeros mediante el Sistema de Información para el Reporte de Extranjeros \(<strong>SIRE<\/strong>\)/);
  assert.match(root_, /Tarjeta de Registro Hotelero \(<strong>TRA<\/strong>\)/);
  assert.match(root_, /solo cuando esa función está activada, archivo de los documentos del check-in en Google Drive/);
  assert.ok(!/archivo seguro de documentos/.test(root_), 'ya no promete archivo en Drive siempre');
  assert.ok(!/\(registro SIRE\)/.test(root_), 'ya no dice que todo se transmite a SIRE');
  for (const html of [root_, en]) {
    assert.match(html, /<h2>7\. Recruitment<\/h2>/);
    assert.match(html, /five \(5\) years/);
    assert.match(html, /data of foreign guests through the Foreigners Reporting Information System/);
    assert.match(html, /only when that feature is enabled, archiving of check-in documents in Google Drive/);
    assert.ok(!/\(SIRE registry\)/.test(html));
  }
});

/* ── Formulario de cotización corporativa ── */
test('empresas (ES/EN): la cotización exige aceptar la política y envía el opt-in de marketing', () => {
  for (const rel of ['empresas.html', 'en/empresas.html']) {
    const html = read(rel);
    const form = html.slice(html.indexOf('<form id="requestQuoteForm">'), html.indexOf('</form>', html.indexOf('<form id="requestQuoteForm">')));
    assert.match(form, /<input type="checkbox" id="rqPolitica" name="aceptar_politica" required>/, rel);
    assert.match(html, /marketingOptIn: !!\(form\.querySelector\('input\[name="marketingOptIn"\]'\) \|\| \{\}\)\.checked/, rel);
    assert.match(html, /window\.estarTrack\('generate_lead', \{ form_name: 'cotizacion-corporativa'/, rel);
  }
});

/* ── Revisión: Meta Pixel sin fuga de URL + plazo de postulaciones ── */
const { metaPixelScript, analyticsUrlIsClean } = require(path.join(root, 'build-ga4.js'));

function runPixel(pageUrl, referrer) {
  const body = metaPixelScript('123456789').replace(/^<script>/, '').replace(/<\/script>$/, '');
  const inserted = [];
  const sandbox = {
    URL,
    location: new URL(pageUrl),
    document: {
      referrer: referrer || '',
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore: (t) => inserted.push(t) } }]
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(body, sandbox);
  return { fbq: sandbox.fbq, inserted };
}

test('analyticsUrlIsClean: solo parámetros de la lista blanca y sin #hash con datos', () => {
  const keep = new RegExp(ANALYTICS_QUERY_ALLOWLIST_SOURCE, 'i');
  assert.equal(analyticsUrlIsClean('https://estar.com.co/reservar.html?utm_source=x&checkin=2026-10-10', undefined, keep), true);
  assert.equal(analyticsUrlIsClean('https://estar.com.co/reservar.html?external_reference=MPDIR-abc', undefined, keep), false);
  assert.equal(analyticsUrlIsClean('https://estar.com.co/x.html#token=abc', undefined, keep), false);
});

test('Meta Pixel: no se carga si la URL trae external_reference de Mercado Pago', () => {
  const r = runPixel('https://estar.com.co/reservar.html?payment=success&external_reference=MPDIR-QW5hfGFuYUBtYWlsLmNv');
  assert.equal(r.fbq, undefined);
  assert.equal(r.inserted.length, 0);
});

test('Meta Pixel: no se carga si el referrer trae un token', () => {
  const r = runPixel('https://estar.com.co/index.html', 'https://estar.com.co/datos-cuenta.html?token=SECRETO');
  assert.equal(r.fbq, undefined);
});

test('Meta Pixel: en una URL limpia se carga con consentimiento revocado por defecto', () => {
  const r = runPixel('https://estar.com.co/index.html?utm_source=ig');
  assert.equal(typeof r.fbq, 'function');
  assert.equal(r.inserted.length, 1);
  const q = r.fbq.queue.map(a => Array.from(a));
  assert.deepEqual(q[0], ['consent', 'revoke']);
  assert.deepEqual(q[1], ['init', '123456789']);
});

test('build.js usa el píxel protegido (no el snippet crudo con fbq init directo)', () => {
  const src = read('build.js');
  assert.match(src, /metaPixelScript\(META_PIXEL_ID\)/);
  assert.ok(!/fbq\('init','\$\{META_PIXEL_ID\}'\)/.test(src));
});

test('privacidad (ES/EN): el plazo de las postulaciones es el que el sistema cumple (hasta que se pida borrar)', () => {
  const es = read('privacidad.html');
  const en = read('en/privacidad.html');
  assert.ok(!/hasta por un \(1\) año/.test(es), 'no promete un borrado automático a 1 año que no existe');
  assert.ok(!/up to one \(1\) year afterwards/.test(es + en));
  assert.match(es, /queda registrada en el formulario del sitio \(Netlify\)/);
  assert.match(es, /la borramos tanto del formulario como del correo del equipo/);
  for (const html of [es, en]) {
    assert.match(html, /is recorded in the website form \(Netlify\)/);
    assert.match(html, /we delete it from both the form and the team's email/);
  }
});

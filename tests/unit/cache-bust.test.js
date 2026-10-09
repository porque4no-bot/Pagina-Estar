/* Cache-busting por hash de contenido (build-cache-bust.js).
 *
 * netlify.toml cachea /*.js y /*.css por 1 año: sin una URL que cambie con el
 * contenido, un arreglo de motor-app.js no le llega a quien ya visitó el sitio.
 * Estas pruebas cubren la función pura y el resultado real en dist/
 * (npm run test:unit construye antes de correrlas). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { bustHtml, contentHash, isLocalAssetRef, applyCacheBusting, HASH_LEN } = require('../../build-cache-bust');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');

function makeSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estar-bust-'));
  fs.mkdirSync(path.join(dir, 'en'));
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'site.css'), 'body{color:red}');
  return dir;
}

test('isLocalAssetRef: solo JS/CSS locales', () => {
  assert.equal(isLocalAssetRef('motor-app.js'), true);
  assert.equal(isLocalAssetRef('../shell.js?v=2'), true);
  assert.equal(isLocalAssetRef('/consent.js'), true);
  assert.equal(isLocalAssetRef('bundle.css?v=3'), true);
  assert.equal(isLocalAssetRef('https://unpkg.com/lucide@0.484.0/dist/umd/lucide.min.js'), false);
  assert.equal(isLocalAssetRef('//cdn.example.com/x.js'), false);
  assert.equal(isLocalAssetRef('assets/logo.png'), false);
  assert.equal(isLocalAssetRef('index.html'), false);
});

test('bustHtml versiona por contenido y deja intactas las referencias externas o inexistentes', () => {
  const dir = makeSite();
  const htmlFile = path.join(dir, 'en', 'page.html');
  const hashOf = file => contentHash(fs.readFileSync(file));
  const jsHash = contentHash(Buffer.from('console.log(1)'));
  const cssHash = contentHash(Buffer.from('body{color:red}'));
  const html = [
    '<link rel="canonical" href="https://estar.com.co/x.html">',
    '<link rel="stylesheet" href="../site.css?v=4">',
    '<link rel="manifest" href="/manifest.json">',
    '<script src="https://checkout.wompi.co/widget.js"></script>',
    '<script src="../app.js?v=2" defer></script>',
    '<script defer src="/app.js"></script>',
    '<script src="../missing.js"></script>',
    '<script>var inline = 1;</script>'
  ].join('\n');
  const out = bustHtml(html, { distDir: dir, htmlFile, hashOf });
  assert.ok(out.includes(`href="../site.css?v=${cssHash}"`));
  assert.ok(out.includes(`src="../app.js?v=${jsHash}" defer`));
  assert.ok(out.includes(`<script defer src="/app.js?v=${jsHash}"></script>`));
  assert.ok(out.includes('href="https://estar.com.co/x.html"'));
  assert.ok(out.includes('href="/manifest.json"'));
  assert.ok(out.includes('src="https://checkout.wompi.co/widget.js"'));
  assert.ok(out.includes('src="../missing.js"'));
  assert.ok(out.includes('<script>var inline = 1;</script>'));
  assert.equal(jsHash.length, HASH_LEN);
});

test('applyCacheBusting: si el archivo cambia, cambia la URL', () => {
  const dir = makeSite();
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="app.js"></script>');
  applyCacheBusting(dir);
  const first = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(2)');
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="app.js"></script>');
  applyCacheBusting(dir);
  const second = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(first, /app\.js\?v=[0-9a-f]{10}/);
  assert.match(second, /app\.js\?v=[0-9a-f]{10}/);
  assert.notEqual(first, second);
});

/* ── Resultado real del build ─────────────────────────────────────────── */

function htmlFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'netlify') out.push(...htmlFiles(full)); }
    else if (e.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function localRefs(html) {
  const refs = [];
  const re = /<script\b[^>]*?\bsrc="([^"]+)"|<link\b[^>]*?\bhref="([^"]+\.css[^"]*)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[1] || m[2];
    if (isLocalAssetRef(ref)) refs.push(ref);
  }
  return refs;
}

test('dist: cada JS/CSS local del HTML construido lleva ?v=<hash de su contenido>', () => {
  assert.ok(fs.existsSync(dist), 'Ejecuta npm run build antes de las pruebas');
  const failures = [];
  let checked = 0;
  for (const htmlFile of htmlFiles(dist)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    for (const ref of localRefs(html)) {
      const clean = ref.split('?')[0];
      const target = clean.startsWith('/') ? path.join(dist, clean) : path.resolve(path.dirname(htmlFile), clean);
      if (!fs.existsSync(target)) continue; /* site-structure.test reporta los rotos */
      const expected = contentHash(fs.readFileSync(target));
      checked += 1;
      if (!ref.endsWith(`?v=${expected}`)) failures.push(`${path.relative(dist, htmlFile)} -> ${ref} (esperado ?v=${expected})`);
    }
  }
  assert.ok(checked > 50, `se revisaron muy pocas referencias (${checked})`);
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('dist: el motor (ES y EN) carga motor-app.js versionado y el CSP sigue cubriendo sus scripts inline', () => {
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  for (const rel of ['reservar.html', 'en/reservar.html']) {
    const html = fs.readFileSync(path.join(dist, rel), 'utf8');
    assert.match(html, /<script src="(\.\.\/)?motor-app\.js\?v=[0-9a-f]{10}"><\/script>/, rel);
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\bsrc\s*=/i.test(m[1])) continue;
      const digest = crypto.createHash('sha256').update(m[2], 'utf8').digest('base64');
      assert.ok(headers.includes(`'sha256-${digest}'`), `${rel}: script inline sin hash en el CSP`);
    }
  }
});

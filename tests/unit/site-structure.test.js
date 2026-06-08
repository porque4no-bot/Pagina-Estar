const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');

function filesUnder(directory, extension) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name === 'netlify') continue;
    if (entry.isDirectory()) result.push(...filesUnder(fullPath, extension));
    if (entry.isFile() && entry.name.endsWith(extension)) result.push(fullPath);
  }
  return result;
}

function internalReferences(html) {
  const references = [];
  const pattern = /\b(?:href|src)=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) references.push(match[1]);
  return references;
}

function resolveReference(htmlFile, reference) {
  const clean = reference.split('#')[0].split('?')[0];
  if (
    !clean ||
    clean === '#' ||
    clean.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(clean) ||
    clean.includes('${') ||
    clean.includes('{{') ||
    clean.includes('__')
  ) {
    return null;
  }

  const decoded = decodeURIComponent(clean);
  let target = decoded.startsWith('/')
    ? path.join(dist, decoded.replace(/^\/+/, ''))
    : path.resolve(path.dirname(htmlFile), decoded);
  if (decoded.endsWith('/')) target = path.join(target, 'index.html');
  if (!path.extname(target)) target += '.html';
  return target;
}

test('the production build contains every public HTML page', () => {
  assert.ok(fs.existsSync(dist), 'Run npm run build before the structural tests');
  const expected = [
    'index.html',
    'reservar.html',
    'guest.html',
    'privacidad.html',
    'explora.html',
    'en/index.html',
    'en/reservar.html'
  ];
  for (const relative of expected) {
    assert.ok(fs.existsSync(path.join(dist, relative)), `Missing built page: ${relative}`);
  }
});

test('all internal href and src references in built HTML resolve to files', () => {
  const failures = [];
  for (const htmlFile of filesUnder(dist, '.html')) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    for (const reference of internalReferences(html)) {
      const target = resolveReference(htmlFile, reference);
      if (target && !fs.existsSync(target)) {
        failures.push(`${path.relative(dist, htmlFile)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(failures, [], `Broken internal references:\n${failures.join('\n')}`);
});

test('every public page has a title, language and viewport metadata', () => {
  const failures = [];
  for (const htmlFile of filesUnder(dist, '.html')) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const relative = path.relative(dist, htmlFile);
    if (!/<html[^>]+\blang=["'][^"']+["']/i.test(html)) failures.push(`${relative}: lang`);
    if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`${relative}: title`);
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) failures.push(`${relative}: viewport`);
  }
  assert.deepEqual(failures, [], `Missing page metadata:\n${failures.join('\n')}`);
});

test('guest app deployment configuration keeps private pages and APIs uncached', () => {
  const config = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(config, /for = "\/guest\.html"[\s\S]*X-Robots-Tag = "noindex, nofollow, noarchive"/);
  assert.match(config, /for = "\/guest\.html"[\s\S]*Cache-Control = "no-store, no-cache, must-revalidate"/);
  assert.match(config, /for = "\/api\/\*"[\s\S]*Cache-Control = "no-store, no-cache, must-revalidate"/);
});

test('guest app environment contract documents every required integration variable', () => {
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const required = [
    'GUEST_APP_TOKEN_SECRET',
    'GUEST_APP_DATA_ENCRYPTION_KEY',
    'GUEST_APP_SYNC_WEBHOOK_URL',
    'GUEST_APP_SYNC_WEBHOOK_SECRET',
    'GUEST_APP_DRIVE_WEBHOOK_URL',
    'GUEST_APP_DRIVE_WEBHOOK_SECRET',
    'GOOGLE_DRIVE_APPS_SCRIPT_URL',
    'GOOGLE_DRIVE_APPS_SCRIPT_SECRET',
    'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT',
    'AZURE_DOCUMENT_INTELLIGENCE_KEY'
  ];
  for (const variable of required) {
    assert.match(example, new RegExp(`^${variable}=`, 'm'), `Missing ${variable} in .env.example`);
  }
});

/* Cache-busting por hash de contenido para el HTML construido (dist/).
 *
 * netlify.toml sirve /*.js y /*.css con `Cache-Control: max-age=31536000`
 * (1 año). Con URLs fijas ("motor-app.js", "shell.js?v=2") un navegador que ya
 * visitó el sitio seguía usando el JS viejo durante meses: los arreglos del
 * motor no le llegaban. Aquí reescribimos cada <script src> y
 * <link rel="stylesheet" href> LOCAL del HTML construido para que apunte a
 * `archivo?v=<hash del contenido>`: si el archivo cambia, cambia la URL y el
 * navegador lo descarga; si no cambia, se sigue aprovechando la caché.
 *
 * El HTML lo revalida el navegador en cada visita (Netlify lo sirve con
 * max-age=0, must-revalidate), así que la URL nueva llega sola.
 *
 * CSP: los hashes de build.js (writeCspHeaders) son de los <script> INLINE (sin
 * src); los que tienen src se excluyen, así que cambiar su query no los afecta.
 * Las URLs externas (https://, //) no se tocan.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HASH_LEN = 10;

function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, HASH_LEN);
}

function isLocalAssetRef(ref) {
  if (!ref) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false; /* https:, data:, mailto: … */
  if (ref.startsWith('//')) return false;
  if (ref.includes('${') || ref.includes('{{')) return false;
  const clean = ref.split('#')[0].split('?')[0];
  return /\.(js|css)$/i.test(clean);
}

/* Archivo en dist/ al que apunta `ref` desde `htmlFile` (null si no existe). */
function resolveAsset(distDir, htmlFile, ref) {
  const clean = decodeURIComponent(ref.split('#')[0].split('?')[0]);
  const target = clean.startsWith('/')
    ? path.join(distDir, clean.replace(/^\/+/, ''))
    : path.resolve(path.dirname(htmlFile), clean);
  if (!target.startsWith(path.resolve(distDir))) return null;
  return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
}

/* Devuelve el HTML con las referencias locales versionadas por contenido. */
function bustHtml(html, { distDir, htmlFile, hashOf }) {
  const rewrite = (ref) => {
    if (!isLocalAssetRef(ref)) return ref;
    const file = resolveAsset(distDir, htmlFile, ref);
    if (!file) return ref;
    const base = ref.split('#')[0].split('?')[0];
    return `${base}?v=${hashOf(file)}`;
  };
  return html
    .replace(/(<script\b[^>]*?\bsrc=")([^"]+)(")/gi, (m, pre, ref, post) => pre + rewrite(ref) + post)
    .replace(/(<link\b[^>]*?\bhref=")([^"]+)(")/gi, (m, pre, ref, post) => {
      /* Solo hojas de estilo (no canonical, manifest, icon, preload de fuentes…). */
      if (!/\.css(?:[?#]|$)/i.test(ref)) return m;
      return pre + rewrite(ref) + post;
    });
}

function htmlFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    /* dist/netlify/email-templates: plantillas de correo, no páginas. */
    if (entry.isDirectory()) {
      if (entry.name === 'netlify') continue;
      out.push(...htmlFilesUnder(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

/* Reescribe todo el HTML de dist/. Devuelve { files, refs } para el log. */
function applyCacheBusting(distDir) {
  const cache = new Map();
  const hashOf = (file) => {
    if (!cache.has(file)) cache.set(file, contentHash(fs.readFileSync(file)));
    return cache.get(file);
  };
  let files = 0;
  for (const htmlFile of htmlFilesUnder(distDir)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const busted = bustHtml(html, { distDir, htmlFile, hashOf });
    if (busted !== html) {
      fs.writeFileSync(htmlFile, busted);
      files += 1;
    }
  }
  return { files, assets: cache.size };
}

module.exports = { applyCacheBusting, bustHtml, contentHash, isLocalAssetRef, HASH_LEN };

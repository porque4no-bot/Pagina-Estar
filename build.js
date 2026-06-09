const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

/* ── Bilingual element stripper ──────────────────────────────────────────────
   Removes all HTML elements whose class list contains `targetClass`.
   Handles nested same-tag elements, script/style pass-through, and comments.
   No external dependencies — pure string/character scanning.
─────────────────────────────────────────────────────────────────────────────*/
function stripBilingualElements(html, targetClass) {
  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

  function tagClose(str, pos) {
    let i = pos + 1, inQ = false, qc = '';
    while (i < str.length) {
      const c = str[i];
      if (!inQ && (c === '"' || c === "'")) { inQ = true; qc = c; }
      else if (inQ && c === qc) { inQ = false; }
      else if (!inQ && c === '>') return i;
      i++;
    }
    return -1;
  }

  function parseTag(str, pos) {
    const end = tagClose(str, pos);
    if (end < 0) return null;
    const raw = str.slice(pos, end + 1);
    const isClose = raw[1] === '/';
    const isSelf = raw[raw.length - 2] === '/';
    const nm = raw.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
    const name = nm ? nm[1].toLowerCase() : '';
    const cm = raw.match(/\bclass="([^"]*)"/);
    const classes = cm ? cm[1].split(/\s+/) : [];
    return { end, name, isClose, isSelf: isSelf || VOID.has(name), hasTarget: classes.includes(targetClass) };
  }

  let out = '', i = 0;
  while (i < html.length) {
    if (html[i] !== '<') { out += html[i++]; continue; }

    if (html.startsWith('<!--', i)) {
      const e = html.indexOf('-->', i + 4);
      if (e < 0) { out += html.slice(i); break; }
      out += html.slice(i, e + 3); i = e + 3; continue;
    }

    const tag = parseTag(html, i);
    if (!tag) { out += html[i++]; continue; }

    if (!tag.isClose && (tag.name === 'script' || tag.name === 'style')) {
      const ct = `</${tag.name}>`;
      const ce = html.toLowerCase().indexOf(ct, tag.end + 1);
      if (ce < 0) { out += html.slice(i); break; }
      out += html.slice(i, ce + ct.length); i = ce + ct.length; continue;
    }

    if (!tag.isClose && !tag.isSelf && tag.hasTarget) {
      let depth = 1, j = tag.end + 1;
      while (j < html.length && depth > 0) {
        if (html[j] !== '<') { j++; continue; }
        const inner = parseTag(html, j);
        if (!inner) { j++; continue; }
        if (inner.name === tag.name) {
          if (!inner.isClose && !inner.isSelf) depth++;
          else if (inner.isClose) depth--;
        }
        j = inner.end + 1;
      }
      while (j < html.length && html[j] === ' ') j++;
      if (j < html.length && html[j] === '\r') j++;
      if (j < html.length && html[j] === '\n') j++;
      const nl = out.lastIndexOf('\n');
      if (nl >= 0 && out.slice(nl + 1).trim() === '') out = out.slice(0, nl + 1);
      i = j; continue;
    }

    out += html.slice(i, tag.end + 1); i = tag.end + 1;
  }
  return out;
}

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');

// 1. Create dist directory if it does not exist
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Helper to copy directory recursively
const ARIAL_FONTS = new Set(['Arial-Regular.woff2', 'Arial-Bold.woff2', 'Arial-Italic.woff2', 'Arial-Black.woff2']);

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const srcPath = path.join(from, element);
    const destPath = path.join(to, element);
    if (srcPath.includes('drive_downloads')) return false;
    if (ARIAL_FONTS.has(element)) return;
    const stat = fs.lstatSync(srcPath);
    if (stat.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    } else if (stat.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    }
  });
}

// Helper to copy file
function copyFileSync(from, to) {
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to);
  }
}

console.log('Copying static assets...');

// Copy specific folders
const foldersToCopy = ['assets', 'fonts', 'uploads', 'en', 'netlify/email-templates'];
foldersToCopy.forEach(folder => {
  const src = path.join(rootDir, folder);
  const dest = path.join(distDir, folder);
  copyFolderSync(src, dest);
});

// Copy specific non-CSS, non-JS files
const filesToCopy = [
  'rooms_db.json',
  'favicon.png',
  'datos_habitaciones_estar.csv',
  'manifest.json',
  'robots.txt',
  'sitemap.xml'
];
filesToCopy.forEach(file => {
  copyFileSync(path.join(rootDir, file), path.join(distDir, file));
});

// Copy all HTML files from root to dist
fs.readdirSync(rootDir).forEach(file => {
  if (file.endsWith('.html')) {
    fs.copyFileSync(path.join(rootDir, file), path.join(distDir, file));
  }
});

// Inject GA4 into all HTML files in dist (including en/ subdir)
const GA4_ID = 'G-9PB0Z2KQJK';
const ga4Snippet = `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', '${GA4_ID}');\n</script>`;

function injectGA4(dir) {
  fs.readdirSync(dir).forEach(entry => {
    const fullPath = path.join(dir, entry);
    if (fs.lstatSync(fullPath).isDirectory()) {
      injectGA4(fullPath);
    } else if (entry.endsWith('.html')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes('gtag') && content.includes('</head>')) {
        content = content.replace('</head>', ga4Snippet + '\n</head>');
        fs.writeFileSync(fullPath, content);
      }
    }
  });
}
console.log('Injecting GA4 tracking...');
injectGA4(distDir);

// Strip bilingual mash: remove .lang-en from root ES pages, .lang-es from en/ pages
console.log('Stripping bilingual inline elements...');
fs.readdirSync(distDir).forEach(file => {
  if (!file.endsWith('.html')) return;
  const p = path.join(distDir, file);
  const stripped = stripBilingualElements(fs.readFileSync(p, 'utf8'), 'lang-en');
  fs.writeFileSync(p, stripped);
});
const distEnDir = path.join(distDir, 'en');
if (fs.existsSync(distEnDir)) {
  fs.readdirSync(distEnDir).forEach(file => {
    if (!file.endsWith('.html')) return;
    const p = path.join(distEnDir, file);
    const stripped = stripBilingualElements(fs.readFileSync(p, 'utf8'), 'lang-es');
    fs.writeFileSync(p, stripped);
  });
}

function injectPublicEnvPlaceholders(dir) {
  const replacements = {
    '__WOMPI_PUBLIC_KEY__': process.env.WOMPI_PUBLIC_KEY || '',
    '__MERCADOPAGO_PUBLIC_KEY__': process.env.MERCADOPAGO_PUBLIC_KEY || ''
  };
  fs.readdirSync(dir).forEach(entry => {
    const fullPath = path.join(dir, entry);
    if (fs.lstatSync(fullPath).isDirectory()) {
      injectPublicEnvPlaceholders(fullPath);
    } else if (entry.endsWith('.html') || entry.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      for (const [token, value] of Object.entries(replacements)) {
        content = content.split(token).join(value);
      }
      fs.writeFileSync(fullPath, content);
    }
  });
}
console.log('Injecting public payment configuration...');
injectPublicEnvPlaceholders(distDir);

async function convertLogosToWebP(sharp) {
  const logosToConvert = ['logo-cotelco.png', 'logo-asohost.png'];
  for (const logo of logosToConvert) {
    const input = path.join(distDir, 'assets', logo);
    const output = input.replace('.png', '.webp');
    if (fs.existsSync(input) && !fs.existsSync(output)) {
      await sharp(input).webp({ quality: 85 }).toFile(output);
      console.log(`  Converted to WebP: ${logo}`);
    }
  }
}

// Optional: generate responsive image variants using Sharp
async function generateResponsiveImages() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.log('Sharp not installed — skipping responsive image generation. Run: npm install sharp');
    return;
  }

  await convertLogosToWebP(sharp);

  const photosDir = path.join('dist', 'assets', 'photos');
  const widths = [480, 768, 1200];
  const files = fs.readdirSync(photosDir).filter(f => f.endsWith('.webp') && !f.includes('-'));

  for (const file of files) {
    const input = path.join(photosDir, file);
    const base = file.replace('.webp', '');
    for (const w of widths) {
      const output = path.join(photosDir, `${base}-${w}w.webp`);
      if (!fs.existsSync(output)) {
        await sharp(input).resize(w, null, { withoutEnlargement: true }).webp({ quality: 80 }).toFile(output);
        console.log(`  Generated: ${base}-${w}w.webp`);
      }
    }
  }
}

/* ── Lucide SVG inline map ───────────────────────────────────────────────────*/
const LUCIDE_SVGS = {
  'wifi': '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>',
  'tv': '<rect width="20" height="15" x="2" y="3" rx="2"/><polyline points="8 21 12 17 16 21"/>',
  'cooking-pot': '<path d="M2 12h20"/><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8"/><path d="m4 8 16-4"/><path d="m8.86 6.78-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"/><path d="M15 2h1a2 2 0 0 1 2 2v2"/><path d="M2.2 13.4A9 9 0 0 0 6 17.9"/><path d="M12 17a3 3 0 0 0 2.83-2"/><path d="M21 13.4A9 9 0 0 1 18 17.9"/>',
  'shower-head': '<path d="m4 4 2.5 2.5"/><path d="M13.5 6.5a4.95 4.95 0 0 0-7 7"/><path d="M15 5 5 15"/><path d="M14 17v.01"/><path d="M10 16v.01"/><path d="M13 13v.01"/><path d="M16 10v.01"/><path d="M11 20v.01"/><path d="M17 14v.01"/><path d="M20 11v.01"/>',
  'sparkles': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  'paw-print': '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  'coffee': '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z"/><path d="M16 8h4a2 2 0 0 1 0 4h-4"/>',
  'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  'external-link': '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  'layout': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="9" y2="21"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
};

/* ── Replace <i data-lucide="name" [attrs]> with inline SVG ─────────────────*/
function inlineLucideIcons(html) {
  // Match both <i data-lucide="name"></i> and <i data-lucide="name"> (no closing tag)
  return html.replace(/<i\s+data-lucide="([^"]+)"([^>]*)>(?:\s*<\/i>)?/g, (match, iconName, extraAttrs) => {
    const paths = LUCIDE_SVGS[iconName];
    if (!paths) return match; // safety fallback: leave unknown icons unchanged

    // Extract style and class from the extra attributes string
    const styleMatch = extraAttrs.match(/\bstyle="([^"]*)"/);
    const classMatch = extraAttrs.match(/\bclass="([^"]*)"/);
    const styleAttr = styleMatch ? ` style="${styleMatch[1]}"` : '';
    const classAttr = classMatch ? ` class="${classMatch[1]}"` : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${classAttr}${styleAttr} aria-hidden="true">${paths}</svg>`;
  });
}

async function build() {
  // Minify CSS files with esbuild
  console.log('Minifying CSS files...');
  const cssFiles = ['styles.css', 'colors_and_type.css', 'guest-app.css'];
  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(path.join(rootDir, cssFile), 'utf8');
    const result = await esbuild.transform(css, { loader: 'css', minify: true });
    fs.writeFileSync(path.join(distDir, cssFile), result.code);
  }

  console.log('Minifying shell.js, kunas.js and guest-app.js...');
  const jsFilesToMinify = ['shell.js', 'kunas.js', 'guest-app.js'];
  for (const jsFile of jsFilesToMinify) {
    const js = fs.readFileSync(path.join(rootDir, jsFile), 'utf8');
    const result = await esbuild.transform(js, { loader: 'js', minify: true });
    fs.writeFileSync(path.join(distDir, jsFile), result.code);
  }

  console.log('Compiling motor-app.jsx with esbuild...');
  try {
    await esbuild.build({
      entryPoints: [path.join(rootDir, 'motor-app.jsx')],
      outfile: path.join(distDir, 'motor-app.js'),
      bundle: true,
      format: 'iife',
      minify: true,
      target: ['es2019'],
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    console.log('Build completed successfully.');
  } catch (error) {
    console.error('Esbuild compilation failed:', error);
    process.exit(1);
  }

  await generateResponsiveImages();

  // ── Optimization 1: Merge CSS into bundle.css ───────────────────────────
  console.log('Merging CSS into bundle.css...');
  const colorsCSS = fs.readFileSync(path.join(distDir, 'colors_and_type.css'), 'utf8');
  const stylesCSS = fs.readFileSync(path.join(distDir, 'styles.css'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'bundle.css'), colorsCSS + stylesCSS);

  // ── Optimization 2: Inline Lucide SVGs and remove CDN script ───────────
  console.log('Inlining Lucide SVGs...');
  // Match the CDN script tag with or without the `defer` attribute.
  const LUCIDE_CDN_RE = /<script src="https:\/\/unpkg\.com\/lucide@[\d.]+\/dist\/umd\/lucide\.min\.js"(?:\s+defer)?><\/script>/g;

  // Apply CSS-bundle + Lucide-inline optimizations to every HTML file in a
  // directory. `prefix` is the path prefix the page uses to reach root assets
  // ('' for dist root, '../' for the en/ subdir). `keepCdn` lists files that
  // build Lucide icons dynamically at runtime and therefore must keep the CDN.
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function optimizeHtmlDir(dir, prefix, keepCdn) {
    const cssBundleTag = `<link rel="stylesheet" href="${prefix}bundle.css?v=3">`;
    const pre = escapeRegex(prefix);
    // Tolerant matchers: optional ?v=N version query, any leading indentation.
    // colors link is swapped in place for the bundle tag; styles link line is dropped.
    const colorsRe = new RegExp(`<link rel="stylesheet" href="${pre}colors_and_type\\.css(?:\\?v=\\d+)?">`);
    const stylesRe = new RegExp(`[ \\t]*<link rel="stylesheet" href="${pre}styles\\.css(?:\\?v=\\d+)?">\\n?`);

    fs.readdirSync(dir).forEach(file => {
      if (!file.endsWith('.html')) return;
      const p = path.join(dir, file);
      let content = fs.readFileSync(p, 'utf8');

      // Merge the two stylesheet links into the single bundle reference.
      // Version-agnostic and indentation-agnostic.
      if (colorsRe.test(content) && stylesRe.test(content)) {
        content = content.replace(colorsRe, cssBundleTag).replace(stylesRe, '');
      }

      // Always inline static <i data-lucide> tags
      content = inlineLucideIcons(content);

      if (!keepCdn.has(file)) {
        // Remove CDN script tag (with or without defer)
        content = content.replace(LUCIDE_CDN_RE, '');
        // Remove createIcons() call variants (inside DOMContentLoaded wrappers)
        content = content.replace(/<script>document\.addEventListener\('DOMContentLoaded',function\(\)\{lucide\.createIcons\(\);\}\);<\/script>/g, '');
        content = content.replace(/<script>document\.addEventListener\('DOMContentLoaded', function\(\)\{ if\(window\.lucide\) lucide\.createIcons\(\); \}\);<\/script>/g, '');
        content = content.replace(/<script>document\.addEventListener\('DOMContentLoaded',function\(\)\{ if \(window\.lucide\) lucide\.createIcons\(\); \}\);<\/script>/g, '');
      }

      fs.writeFileSync(p, content);
    });
  }

  // Root pages: cotizacion.html and reservar.html keep the Lucide CDN
  optimizeHtmlDir(distDir, '', new Set(['reservar.html', 'cotizacion.html']));
  // English pages live in en/ and reach assets via ../ ; only reservar.html is dynamic
  if (fs.existsSync(distEnDir)) {
    optimizeHtmlDir(distEnDir, '../', new Set(['reservar.html']));
  }

  // 404.html needs absolute asset paths so it works from any URL depth on Netlify
  const err404Path = path.join(distDir, '404.html');
  if (fs.existsSync(err404Path)) {
    let c = fs.readFileSync(err404Path, 'utf8');
    c = c.replace(/href="bundle\.css\?v=\d+"/, 'href="/bundle.css?v=3"');
    c = c.replace(/src="assets\/logo\.png"/, 'src="/assets/logo.png"');
    c = c.replace(/href="assets\/favicon\.png"/g, 'href="/assets/favicon.png"');
    fs.writeFileSync(err404Path, c);
  }
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

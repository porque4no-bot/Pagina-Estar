const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

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
const foldersToCopy = ['assets', 'fonts', 'uploads', 'en'];
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

async function build() {
  // Minify CSS files with esbuild
  console.log('Minifying CSS files...');
  const cssFiles = ['styles.css', 'colors_and_type.css'];
  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(path.join(rootDir, cssFile), 'utf8');
    const result = await esbuild.transform(css, { loader: 'css', minify: true });
    fs.writeFileSync(path.join(distDir, cssFile), result.code);
  }

  console.log('Minifying shell.js and kunas.js...');
  const jsFilesToMinify = ['shell.js', 'kunas.js'];
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
      minify: true,
    });
    console.log('Build completed successfully.');
  } catch (error) {
    console.error('Esbuild compilation failed:', error);
    process.exit(1);
  }

  await generateResponsiveImages();
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

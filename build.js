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
function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach(element => {
    const srcPath = path.join(from, element);
    const destPath = path.join(to, element);
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
const foldersToCopy = ['assets', 'fonts', 'uploads'];
foldersToCopy.forEach(folder => {
  const src = path.join(rootDir, folder);
  const dest = path.join(distDir, folder);
  copyFolderSync(src, dest);
});

// Copy specific files
const filesToCopy = [
  'styles.css',
  'colors_and_type.css',
  'shell.js',
  'kunas.js',
  'rooms_db.json',
  'favicon.png',
  'datos_habitaciones_estar.csv'
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

console.log('Compiling motor-app.jsx with esbuild...');

try {
  esbuild.buildSync({
    entryPoints: [path.join(rootDir, 'motor-app.jsx')],
    outfile: path.join(distDir, 'motor-app.js'),
    minify: true,
  });
  console.log('Build completed successfully.');
} catch (error) {
  console.error('Esbuild compilation failed:', error);
  process.exit(1);
}

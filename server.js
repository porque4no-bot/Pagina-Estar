const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3400;

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
};

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]; // strip query strings like ?v=2
  let filePath = path.join(__dirname, urlPath === '/' ? '/index.html' : urlPath);
  if (!path.extname(filePath)) filePath += '.html';
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(port, () => console.log(`Server running on port ${port}`));

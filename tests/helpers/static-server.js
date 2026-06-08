const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 3401);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
};

function resolveRequest(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://127.0.0.1:${port}`).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let candidate = path.resolve(root, relative);
  if (!path.extname(candidate)) candidate += '.html';
  if (!candidate.startsWith(`${root}${path.sep}`) && candidate !== root) return null;
  return candidate;
}

const server = http.createServer((req, res) => {
  const filePath = resolveRequest(req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    res.end(body);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Test server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

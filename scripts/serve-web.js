// Tiny static server for the web export (dist/). It exists because expo-sqlite's
// WASM engine wants a cross-origin-isolated page, and PWA installability needs a
// few specific content types — neither of which a bare `npx serve` guarantees.
//
// Usage:  node scripts/serve-web.js [port]
// Open:   http://localhost:8080  (localhost is a secure context, so SQLite + PWA
//         install work; a LAN IP over http would NOT be a secure context.)
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function setHeaders(res, ext) {
  // Cross-origin isolation: required by wa-sqlite's WASM/OPFS persistence.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
}

function tryFiles(urlPath) {
  // Resolve a URL path to a real file inside DIST, guarding against traversal.
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const base = path.normalize(path.join(DIST, clean));
  if (!base.startsWith(DIST)) return null; // path traversal attempt

  const candidates = [];
  if (clean === '/' || clean === '') {
    candidates.push(path.join(DIST, 'index.html'));
  } else {
    candidates.push(base);
    candidates.push(base + '.html'); // Expo static export: /assets -> assets.html
    candidates.push(path.join(base, 'index.html'));
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return null;
}

const server = http.createServer((req, res) => {
  let file = tryFiles(req.url);

  // SPA-style fallback for client-side routes that have no static .html.
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (!file && wantsHtml) file = path.join(DIST, 'index.html');

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  setHeaders(res, path.extname(file).toLowerCase());
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  if (!fs.existsSync(DIST)) {
    console.error('dist/ not found — run `npx expo export --platform web` first.');
    process.exit(1);
  }
  console.log(`Serving dist/ at http://localhost:${PORT}  (cross-origin isolated)`);
});

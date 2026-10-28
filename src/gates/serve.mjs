import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.splinecode': 'application/octet-stream',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

// The file a URL path maps to, the way a static host serves an Astro "directory" build:
// /about, /about/ and /about/index.html all serve about/index.html. Null when there is none.
export function resolvePath(dist, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const rel = normalize(path).replace(/^([/\\])+/, '');
  if (rel.split(sep).includes('..')) return null;
  const base = join(dist, rel);
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) if (isFile(candidate)) return candidate;
  return null;
}

// serveSite(dist) => Promise<{ url, close }>: a static server on 127.0.0.1 and a free port,
// with 404.html for missing pages. Only GET and HEAD; a form POST gets 405, so a form gate
// must intercept its endpoint rather than rely on the server.
export function serveSite(dist) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolvePath(dist, new URL(req.url, 'http://localhost').pathname);
    const notFound = join(dist, '404.html');
    const target = file ?? (isFile(notFound) ? notFound : null);
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(file ? 200 : 404, { 'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(target).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

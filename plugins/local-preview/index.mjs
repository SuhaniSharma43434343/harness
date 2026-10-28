import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { ConfigMissing } from '../../src/core/errors.mjs';

// Serves a built site (for example site/dist) on 127.0.0.1, so the operator and the gates can
// open it before anything is deployed. Clean URLs map to <path>/index.html or <path>.html, and
// a missing page gets the site's 404.html with status 404.

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.splinecode': 'application/octet-stream',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function resolveFile(dir, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const rel = normalize(path).replace(/^[/\\]+/, '');
  if (rel.split(sep).includes('..')) return null;
  const base = join(dir, rel);
  for (const candidate of [base, join(base, 'index.html'), `${base}.html`]) if (isFile(candidate)) return candidate;
  return null;
}

export async function healthCheck() {
  const { url, close } = await start({ dir: process.cwd(), probe: true });
  await close();
  return { ok: true, detail: `can serve on ${new URL(url).hostname}` };
}

// start({ dir, port }) => { url, close }. port 0 (the default) picks a free one.
export function start({ dir, port = 0, probe = false }) {
  if (!probe && !existsSync(join(dir, 'index.html'))) {
    return Promise.reject(new ConfigMissing(`There is no built site in ${dir}`, { hint: 'Build the site first; the preview serves its output folder.' }));
  }
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const file = resolveFile(dir, new URL(req.url, 'http://127.0.0.1').pathname);
    const notFound = join(dir, '404.html');
    const target = file ?? (isFile(notFound) ? notFound : null);
    if (!target) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(file ? 200 : 404, {
      'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(target).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

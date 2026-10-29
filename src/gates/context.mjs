import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parse } from 'node-html-parser';

const toPosix = (p) => p.split(sep).join('/');

// Everything a gate reads about a site, loaded lazily. siteDir is workspace/<project>/site; the
// project folder around it holds the locked content, the source register and the licence register.
export function gateContext(siteDir, opts = {}) {
  const projectDir = opts.projectDir ?? dirname(siteDir);
  const dist = join(siteDir, 'dist');
  const cache = new Map();
  const once = (key, fn) => (cache.has(key) ? cache.get(key) : (cache.set(key, fn()), cache.get(key)));

  const ctx = {
    siteDir,
    projectDir,
    dist,
    opts,
    hasDist: () => existsSync(dist),
    // Every built file, relative to dist, with forward slashes.
    files: () => once('files', () => (existsSync(dist) ? readdirSync(dist, { recursive: true }).map(String).map(toPosix).filter((f) => !isDir(join(dist, f))) : [])),
    // Routes: one per HTML page except the 404 page, as URL paths.
    routes: () =>
      once('routes', () =>
        ctx
          .files()
          .filter((f) => f.endsWith('.html') && f !== '404.html' && !f.endsWith('/404.html'))
          .map(routeOf)
          .sort(),
      ),
    html: (route) => once(`html:${route}`, () => readFileSync(join(dist, fileOf(route)), 'utf8')),
    doc: (route) => once(`doc:${route}`, () => parse(ctx.html(route), { comment: false })),
    read: (rel) => readFileSync(join(projectDir, rel), 'utf8'),
    exists: (rel) => existsSync(join(projectDir, rel)),
    json: (rel, fallback) => (existsSync(join(projectDir, rel)) ? JSON.parse(readFileSync(join(projectDir, rel), 'utf8')) : fallback),
    rel: (abs) => toPosix(relative(projectDir, abs)),
  };
  return ctx;
}

const isDir = (p) => statSync(p).isDirectory();

export const routeOf = (file) => {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'/index.html'.length)}`;
  return `/${file.replace(/\.html$/, '')}`;
};
export const fileOf = (route) => (route === '/' ? 'index.html' : `${route.slice(1)}/index.html`);

// Visible text, with whitespace collapsed and typographic quotes and dashes made plain, so a
// locked sentence matches its rendered copy.
export function normalise(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The text a visitor reads: <main> if there is one, else <body>, without scripts and styles.
export function visibleText(doc) {
  const root = doc.querySelector('main') ?? doc.querySelector('body') ?? doc;
  const clone = parse(root.toString());
  for (const el of clone.querySelectorAll('script, style, noscript, template')) el.remove();
  return normalise(clone.text);
}

// A Markdown page: simple "key: value" frontmatter and the body.
export function readMarkdown(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const data = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (kv) data[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  return { data, body: m ? m[2] : text };
}

// Markdown body -> the plain-text blocks a reader sees (paragraphs, headings, list items).
export function markdownBlocks(body) {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n\s*\r?\n/)
    .flatMap((block) => (/^\s*([-*+]|\d+\.)\s/m.test(block) ? block.split(/\r?\n(?=\s*([-*+]|\d+\.)\s)/) : [block]))
    .filter((b) => b && !/^\s*([-*+]|\d+\.)\s*$/.test(b))
    .map((b) =>
      normalise(
        b
          .replace(/^\s*#{1,6}\s+/gm, '')
          .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')
          .replace(/^\s*>\s?/gm, '')
          .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/(\*\*|__|\*|_|`)/g, ''),
      ),
    )
    .filter(Boolean);
}

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Unavailable } from '../core/errors.mjs';

// APP-01 budget from the plan: base JavaScript at most 150 KB gzip.
export const JS_BUDGET_BYTES = 150 * 1024;

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, cwd, env) {
  const r = spawnSync(npm, args, {
    cwd,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.error) throw new Unavailable(`Could not run npm ${args[0]}`, { hint: r.error.message });
  return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// Installs the site's dependencies when they are missing, then runs `astro build`.
// Resolves to { ok, code, output, dist }; a failing build is a result, not an exception.
export function buildSite(siteDir, { install = 'auto', env } = {}) {
  let output = '';
  if (install === 'always' || (install === 'auto' && !existsSync(join(siteDir, 'node_modules')))) {
    const lock = existsSync(join(siteDir, 'package-lock.json'));
    const r = run(lock ? ['ci', '--no-audit', '--no-fund'] : ['install', '--no-audit', '--no-fund'], siteDir, env);
    output += r.output;
    if (r.code !== 0) return { ok: false, code: r.code, output, dist: null };
  }
  const r = run(['run', 'build'], siteDir, env);
  output += r.output;
  return { ok: r.code === 0, code: r.code, output, dist: join(siteDir, 'dist') };
}

function files(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.split(sep).join('/'));
}

// Static imports of a bundled module: `import{a}from"./x.js"` and `import"./x.js"`, but not
// dynamic `import("./x.js")`, which loads later, on demand.
const STATIC_IMPORT = /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+\.m?js)["']/g;

// The bundled files a page loads before anything runs on demand: its <script src> and
// modulepreload files, and everything they import statically.
export function initialScripts(dist, htmlFile, text = readFileSync(join(dist, htmlFile), 'utf8')) {
  const queue = [...text.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*rel="modulepreload"[^>]*\bhref)="([^"]+\.m?js)"/g)].map((m) => m[1]);
  const seen = new Set();
  while (queue.length) {
    const ref = queue.shift();
    if (/^https?:/.test(ref)) continue;
    const rel = ref.startsWith('/') ? ref.slice(1) : join(dirname(htmlFile), ref).split(sep).join('/');
    if (seen.has(rel) || !existsSync(join(dist, rel))) continue;
    seen.add(rel);
    for (const m of readFileSync(join(dist, rel), 'utf8').matchAll(STATIC_IMPORT)) {
      queue.push(m[1].startsWith('/') ? m[1] : join(dirname(rel), m[1]).split(sep).join('/'));
    }
  }
  return seen;
}

// Facts about a built site, for build tests and the budgets: routes; jsBytes, the most
// JavaScript any one page loads up front (its inline scripts plus the bundled files it loads
// and their static imports), gzipped, which is what the APP-01 budget limits; lazyJsBytes,
// the bundled JavaScript no page loads up front (approach libraries behind a dynamic import);
// and totalJsBytes, everything bundled plus the largest page's inline scripts.
export function siteReport(dist) {
  const all = files(dist);
  const html = all.filter((f) => f.endsWith('.html'));
  const routes = html
    .filter((f) => f !== '404.html')
    .map((f) => '/' + f.replace(/(^|\/)index\.html$/, '').replace(/\/$/, ''))
    .sort();
  const gz = new Map(all.filter((f) => /\.m?js$/.test(f)).map((f) => [f, gzipSync(readFileSync(join(dist, f))).length]));
  const upFront = new Set();
  let jsBytes = 0;
  let inline = 0;
  for (const f of html) {
    const text = readFileSync(join(dist, f), 'utf8');
    let page = 0;
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if (m[1].trim()) page += gzipSync(m[1]).length;
    inline = Math.max(inline, page);
    for (const s of initialScripts(dist, f, text)) {
      upFront.add(s);
      page += gz.get(s) ?? 0;
    }
    jsBytes = Math.max(jsBytes, page);
  }
  const bundled = [...gz.values()].reduce((a, b) => a + b, 0);
  const lazyJsBytes = [...gz].filter(([f]) => !upFront.has(f)).reduce((a, [, n]) => a + n, 0);
  return { routes, html, jsBytes, lazyJsBytes, totalJsBytes: bundled + inline, withinBudget: jsBytes <= JS_BUDGET_BYTES };
}

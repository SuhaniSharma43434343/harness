import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
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

// Facts about a built site, for build tests and the APP-01 budget: routes, and the most
// JavaScript any one page ships, gzipped (every bundled file, which is an upper bound, plus
// that page's inline module scripts).
export function siteReport(dist) {
  const all = files(dist);
  const html = all.filter((f) => f.endsWith('.html'));
  const routes = html
    .filter((f) => f !== '404.html')
    .map((f) => '/' + f.replace(/(^|\/)index\.html$/, '').replace(/\/$/, ''))
    .sort();
  let bundled = 0;
  for (const f of all.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) bundled += gzipSync(readFileSync(join(dist, f))).length;
  let inline = 0;
  for (const f of html) {
    let page = 0;
    for (const m of readFileSync(join(dist, f), 'utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      if (m[1].trim()) page += gzipSync(m[1]).length;
    }
    inline = Math.max(inline, page);
  }
  const jsBytes = bundled + inline;
  return { routes, html, jsBytes, withinBudget: jsBytes <= JS_BUDGET_BYTES };
}

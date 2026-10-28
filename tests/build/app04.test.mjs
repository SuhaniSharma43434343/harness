// T20: the APP-04 Spline module. Build: a site with a SplineScene builds and passes the routes,
// accessibility and responsive gates, with the Spline runtime outside the up-front JavaScript.
// Fallback: a missing scene (plugin missing), no WebGL, reduced motion, a low-end device, a slow
// network and a failed load each keep the poster, by DOM assertion and screenshot. Budget: the
// runtime is requested only after LCP and the load event, never up front.
//
// Not covered here: rendering a real scene. That needs a scene from the operator's Spline
// account (and the Spline plugin, T08); the scene served here is not a valid scene file, so
// the full path ends in the load-failed fallback, which is what these tests check.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app04 from '../../src/approaches/app04.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite, initialScripts, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { addSections, buildSkipReason, linkModules, packageCache, scaffold } from './approach-helpers.mjs';
import { LOW_END, NO_WEBGL, openWith, SLOW_NETWORK } from './fallback-helpers.mjs';

let skip = buildSkipReason();
let cache;
if (!skip) {
  try {
    cache = packageCache(app04.packages);
  } catch (err) {
    skip = err.message;
  }
}
let browser;
let noBrowser = false;
try {
  browser = await launchBrowser();
  await loadTool('axe-core');
} catch (err) {
  noBrowser = `browser test tools are not available: ${err.message}`;
}

const POSTER = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#d8dee6"/><circle cx="600" cy="400" r="220" fill="#1f3a5f"/></svg>';
const section = (scene) => `  - use: "APP-04/SplineScene"
    heading: "See it from every side"
    text: "Turn the model to look closer."
${scene ? `    scene: "${scene}"\n` : ''}    poster: { src: "/images/scene-poster.svg", alt: "The product on a stand", width: 1200, height: 800 }
    events: [{ on: "mouseDown", object: "Button", dispatch: "scene:button" }]`;

let site;
let server;
let runtimeChunk;
let lazyChunks = [];
const shots = mkdtempSync(join(tmpdir(), 'forge-app04-shots-'));

before(async () => {
  if (skip) return;
  site = scaffold('showroom');
  site.applied = app04.apply(site.siteDir, { install: false });
  linkModules(site.siteDir, cache, app04.packages.map((p) => p.name));
  mkdirSync(join(site.siteDir, 'public/images'), { recursive: true });
  mkdirSync(join(site.siteDir, 'public/scenes'), { recursive: true });
  writeFileSync(join(site.siteDir, 'public/images/scene-poster.svg'), POSTER);
  writeFileSync(join(site.siteDir, 'public/scenes/demo.splinecode'), 'not a real scene');
  const pages = site.brief.pages.map((p) => p.slug);
  site.withScene = pages[0];
  site.withoutScene = pages[1];
  addSections(site.siteDir, site.withScene, section('/scenes/demo.splinecode'));
  addSections(site.siteDir, site.withoutScene, section(null));
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (!site.build.ok) return;
  // The chunks a page loads only on demand: the Spline runtime and its parts.
  const dir = join(site.build.dist, '_astro');
  const upFront = initialScripts(site.build.dist, 'index.html');
  lazyChunks = readdirSync(dir).filter((f) => f.endsWith('.js') && !upFront.has(`_astro/${f}`));
  runtimeChunk = lazyChunks.sort((a, b) => statSync(join(dir, b)).size - statSync(join(dir, a)).size)[0];
  server = await serveSite(site.build.dist);
});
after(async () => {
  await server?.close();
  await browser?.close();
});

test('build: the APP-04 site builds; the Spline runtime is outside the up-front JavaScript', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const report = siteReport(site.build.dist);
  t.diagnostic(`up-front ${(report.jsBytes / 1024).toFixed(1)} KB, on demand ${(report.lazyJsBytes / 1024).toFixed(1)} KB gzip (runtime chunk ${runtimeChunk})`);
  assert.ok(report.withinBudget, `${report.jsBytes} bytes up front`);
  assert.ok(report.lazyJsBytes > 100 * 1024, 'the runtime is a lazy chunk');
  const html = readFileSync(join(site.build.dist, 'index.html'), 'utf8');
  assert.match(html, /data-app04="scene"/);
  assert.match(html, /fetchpriority="high"/);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-04 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

const url = (slug) => server.url + slug;

async function assertPoster(page, name) {
  const poster = await page.$eval('.spline__poster', (img) => ({ visible: getComputedStyle(img).visibility === 'visible', loaded: img.complete && img.naturalWidth > 0 }));
  assert.deepEqual(poster, { visible: true, loaded: true });
  const canvas = await page.$('.spline__canvas:not([hidden])');
  assert.equal(canvas, null, 'no live canvas');
  const shot = await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  assert.ok(shot.length > 1000);
}

test('budget: the runtime loads only after LCP and the load event, and the poster stays on failure', { skip: skip || noBrowser }, async () => {
  const r = await openWith(browser, url(site.withScene), 'app04');
  const timing = await r.page.evaluate(
    (chunks) =>
      new Promise((resolve) => {
        new PerformanceObserver((l) => {
          const lcp = l.getEntries().at(-1);
          const nav = performance.getEntriesByType('navigation')[0];
          const lazy = performance.getEntriesByType('resource').filter((e) => chunks.some((c) => e.name.endsWith(c)));
          resolve({ lcp: lcp.startTime, load: nav.loadEventEnd, runtime: lazy.length ? Math.min(...lazy.map((e) => e.startTime)) : null });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
    lazyChunks,
  );
  // The scene served here is not a real scene, so the full path ends in the load-failed fallback.
  assert.deepEqual(r.mode, { mode: 'fallback', reason: 'load-failed' });
  await assertPoster(r.page, 'invalid-scene');
  await r.context.close();
  assert.ok(timing.runtime !== null, 'the runtime was requested on a capable device');
  assert.ok(timing.runtime > timing.lcp, `runtime at ${timing.runtime} ms, LCP at ${timing.lcp} ms`);
  assert.ok(timing.runtime >= timing.load, `runtime at ${timing.runtime} ms, load at ${timing.load} ms`);
});

const FALLBACKS = [
  { reason: 'plugin-missing', page: () => site.withoutScene, options: {} },
  { reason: 'no-webgl', options: { init: NO_WEBGL } },
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'low-end-device', options: { init: LOW_END } },
  { reason: 'slow-network', options: { init: SLOW_NETWORK } },
  { reason: 'load-failed', options: { block: (u) => lazyChunks.some((c) => u.pathname.endsWith(c)) } },
];

for (const { reason, page, options } of FALLBACKS) {
  test(`fallback: ${reason} keeps the poster`, { skip: skip || noBrowser }, async () => {
    const r = await openWith(browser, url(page ? page() : site.withScene), 'app04', options);
    assert.deepEqual(r.mode, { mode: 'fallback', reason });
    await assertPoster(r.page, reason);
    if (reason !== 'load-failed') assert.ok(!r.requests.some((q) => lazyChunks.some((c) => q.url.endsWith(c))), 'no part of the runtime is downloaded');
    await r.context.close();
  });
}

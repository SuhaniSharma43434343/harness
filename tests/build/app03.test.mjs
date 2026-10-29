// T12: the APP-03 Interactive 3D module. Build: a site with two Scene3D sections (a glTF model
// and a procedural object) builds, keeps Three.js out of the up-front JavaScript within the
// 250 KB budget, and passes the routes, accessibility and responsive gates. Full: the scene
// renders after the page has loaded, turns with the keyboard, and only one WebGL canvas runs at a
// time. Fallback: reduced motion, no WebGL, a low-end device, a slow network and a failed load
// each keep the poster. Budget: a model over 3 MB is refused, and a frame-time probe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app03, { registerModel } from '../../src/approaches/app03.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite, initialScripts, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { addSections, buildSkipReason, linkModules, packageCache, scaffold, tinyGlb } from './approach-helpers.mjs';
import { LOW_END, NO_WEBGL, openWith, SLOW_NETWORK } from './fallback-helpers.mjs';

let skip = buildSkipReason();
let cache;
if (!skip) {
  try {
    cache = packageCache(app03.packages);
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
after(() => browser?.close());

const POSTER = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#d8dee6"/><circle cx="600" cy="400" r="220" fill="#1f3a5f"/></svg>';
const SECTIONS = `  - use: "APP-03/Scene3D"
    heading: "Turn it over"
    text: "Drag, or use the arrow keys, to look from every side."
    model: "/models/triangle.glb"
    poster: { src: "/images/poster.svg", alt: "The product on a stand", width: 1200, height: 800 }
  - use: "APP-03/Scene3D"
    heading: "Made to be held"
    poster: { src: "/images/poster.svg", alt: "A knot of brushed metal", width: 1200, height: 800 }`;

let site;
let baseline;
let server;
const shots = mkdtempSync(join(tmpdir(), 'forge-app03-shots-'));

before(async () => {
  if (skip) return;
  const base = scaffold('showroom');
  linkModules(base.siteDir);
  const b0 = buildSite(base.siteDir, { install: 'never' });
  assert.ok(b0.ok, b0.output.slice(-2000));
  baseline = siteReport(b0.dist);

  site = scaffold('showroom');
  site.applied = app03.apply(site.siteDir, { install: false });
  linkModules(site.siteDir, cache, app03.packages.map((p) => p.name));
  mkdirSync(join(site.siteDir, 'public/images'), { recursive: true });
  mkdirSync(join(site.siteDir, 'public/models'), { recursive: true });
  writeFileSync(join(site.siteDir, 'public/images/poster.svg'), POSTER);
  writeFileSync(join(site.siteDir, 'public/models/triangle.glb'), tinyGlb());
  addSections(site.siteDir, site.brief.pages[0].slug, SECTIONS);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

const url = () => server.url + site.brief.pages[0].slug;

test('apply adds the section, runtime, Three.js and its licence row', { skip }, () => {
  for (const f of ['src/sections/APP-03/Scene3D.astro', 'src/lib/app03/scene3d.js', 'src/lib/app03/webgl-slot.js']) assert.ok(site.applied.files.includes(f), f);
  const pkg = JSON.parse(readFileSync(join(site.siteDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.three, '0.186.1');
  const rows = JSON.parse(readFileSync(join(site.siteDir, '..', 'assets/register.json'), 'utf8')).assets;
  assert.equal(rows.find((r) => r.package === 'three').status, 'cleared');
});

test('a model is registered with its licence, and one over 3 MB is refused', () => {
  const project = mkdtempSync(join(tmpdir(), 'forge-model-'));
  const small = join(project, 'small.glb');
  writeFileSync(small, tinyGlb());
  assert.throws(() => registerModel(project, { file: small, path: '/models/small.glb' }), /source and licence/);
  assert.ok(registerModel(project, { file: small, path: '/models/small.glb', source: 'Made in Blender for this site', licence: 'client-owned' }).bytes > 0);
  const big = join(project, 'big.glb');
  writeFileSync(big, Buffer.alloc(3 * 1024 * 1024 + 1));
  assert.throws(() => registerModel(project, { file: big, path: '/models/big.glb', source: 's', licence: 'l' }), /over the 3 MB budget/);
});

test('build: Three.js loads on demand, within 250 KB of extra JavaScript', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const report = siteReport(site.build.dist);
  const extra = report.totalJsBytes - baseline.totalJsBytes;
  t.diagnostic(`extra JavaScript: ${(extra / 1024).toFixed(1)} KB gzip, lazy ${(report.lazyJsBytes / 1024).toFixed(1)} KB`);
  assert.ok(report.withinBudget, 'Three.js is not in the up-front JavaScript');
  assert.ok(report.lazyJsBytes > 100 * 1024, 'Three.js is a lazy chunk');
  assert.ok(extra <= app03.budget.extraJsBytes, `${extra} bytes (budget ${app03.budget.extraJsBytes})`);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-03 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

test('full mode: the scene loads after the page, turns with the keyboard, one canvas at a time', { skip: skip || noBrowser }, async (t) => {
  const { context, page, errors, mode } = await openWith(browser, url(), 'app03');
  assert.deepEqual(mode, { mode: 'full', reason: null });
  // Timed in the browser: every on-demand chunk (Three.js and the loaders) starts after the
  // load event, so the poster stays the LCP.
  const slug = site.brief.pages[0].slug;
  const upFront = initialScripts(site.build.dist, slug === '/' ? 'index.html' : `${slug.slice(1)}/index.html`);
  const timing = await page.evaluate((eager) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const lazy = performance.getEntriesByType('resource').filter((r) => /\/_astro\/.+\.js$/.test(r.name) && !eager.some((e) => r.name.endsWith(e)));
    return { loadAt: nav.loadEventStart, lazy: lazy.map((r) => ({ name: r.name.split('/').pop(), at: r.startTime })) };
  }, [...upFront]);
  assert.ok(timing.lazy.length > 0, 'Three.js came as on-demand chunks');
  for (const r of timing.lazy) assert.ok(r.at >= timing.loadAt, `${r.name} started at ${r.at.toFixed(0)} ms, before load at ${timing.loadAt.toFixed(0)} ms`);

  const first = page.locator('.scene3d__canvas').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const before = await first.screenshot();
  await first.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  const after_ = await first.screenshot();
  assert.ok(!before.equals(after_), 'the arrow keys turned the model');

  const running = await page.evaluate(() => globalThis.__forgeWebglSlots.list.filter((s) => s.running).length);
  assert.ok(running <= 1, `${running} WebGL sections running at once`);

  const p90 = await page.evaluate(async () => {
    const times = [];
    let last = performance.now();
    await new Promise((done) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        times.length < 90 ? requestAnimationFrame(tick) : done();
      };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length * 0.9)];
  });
  await page.screenshot({ path: join(shots, 'full.png'), fullPage: true });
  await context.close();
  t.diagnostic(`frame time p90 ${p90.toFixed(1)} ms (headless software rendering)`);
  assert.ok(p90 < 60, `p90 ${p90} ms`);
  assert.deepEqual(errors, []);
});

const FALLBACKS = [
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'no-webgl', options: { init: NO_WEBGL } },
  { reason: 'low-end-device', options: { init: LOW_END } },
  { reason: 'slow-network', options: { init: SLOW_NETWORK } },
  { reason: 'load-failed', options: { block: (u) => /\.glb$|three|GLTFLoader|meshopt/i.test(u.pathname) } },
];

for (const { reason, options } of FALLBACKS) {
  test(`fallback: ${reason} keeps the poster`, { skip: skip || noBrowser }, async () => {
    const { context, page, errors, mode } = await openWith(browser, url(), 'app03', options);
    if (reason === 'load-failed') await page.waitForFunction(() => document.documentElement.dataset.app03 === 'fallback', null, { timeout: 20_000 });
    const final = await page.evaluate(() => ({ mode: document.documentElement.dataset.app03, reason: document.documentElement.dataset.app03Reason }));
    assert.deepEqual(final, { mode: 'fallback', reason });
    const state = await page.evaluate(() =>
      [...document.querySelectorAll('section[data-app03]')].map((s) => ({
        live: s.classList.contains('is-live'),
        poster: getComputedStyle(s.querySelector('.scene3d__poster')).visibility,
        tilt: s.querySelector('.scene3d__stage').classList.contains('is-tilt'),
      })),
    );
    await page.screenshot({ path: join(shots, `fallback-${reason}.png`) });
    await context.close();
    for (const s of state) {
      assert.equal(s.live, false);
      assert.equal(s.poster, 'visible');
      assert.equal(s.tilt, reason !== 'reduced-motion', 'the CSS depth tilt, except with reduced motion');
    }
    if (reason !== 'load-failed') assert.deepEqual(errors, []);
    void mode;
  });
}

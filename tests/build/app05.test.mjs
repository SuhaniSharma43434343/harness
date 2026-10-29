// T12: the APP-05 Shader / WebGL module. Build: a site with a ShaderBackground builds, adds no
// package and little JavaScript, and passes the routes, accessibility and responsive gates.
// Full: the shader draws, at full quality, and steps down the quality ladder when frames are
// slow. Fallback: reduced motion (a still frame), no WebGL, a low-end device, a slow network and
// a forced load failure each keep the CSS gradient. Budget: at most 80 KB of extra JavaScript, and
// a frame-time probe while it runs. Real-device GPU timing is manual: docs/device-log.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app05 from '../../src/approaches/app05.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { addSections, buildSkipReason, linkModules, scaffold } from './approach-helpers.mjs';
import { LOW_END, NO_WEBGL, openWith, SLOW_NETWORK } from './fallback-helpers.mjs';

const skip = buildSkipReason();
let browser;
let noBrowser = false;
try {
  browser = await launchBrowser();
  await loadTool('axe-core');
} catch (err) {
  noBrowser = `browser test tools are not available: ${err.message}`;
}
after(() => browser?.close());

const SECTION = `  - use: "APP-05/ShaderBackground"
    heading: "Light, in motion"
    text: "A calm field of colour behind the story."
    intensity: 2`;

let site;
let baseline;
let server;
const shots = mkdtempSync(join(tmpdir(), 'forge-app05-shots-'));

before(async () => {
  if (skip) return;
  const base = scaffold('launch');
  linkModules(base.siteDir);
  const b0 = buildSite(base.siteDir, { install: 'never' });
  assert.ok(b0.ok, b0.output.slice(-2000));
  baseline = siteReport(b0.dist);

  site = scaffold('launch');
  site.applied = app05.apply(site.siteDir, { install: false });
  linkModules(site.siteDir);
  addSections(site.siteDir, '/', SECTION);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

const url = () => server.url + '/';

test('apply adds the section and runtime, and no package', { skip }, () => {
  assert.deepEqual(site.applied.packages, []);
  for (const f of ['src/sections/APP-05/ShaderBackground.astro', 'src/lib/app05/shader.js', 'src/lib/app05/webgl-slot.js']) assert.ok(site.applied.files.includes(f), f);
});

test('build: the APP-05 site builds within 80 KB of extra JavaScript', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const report = siteReport(site.build.dist);
  const extra = report.totalJsBytes - baseline.totalJsBytes;
  t.diagnostic(`extra JavaScript: ${(extra / 1024).toFixed(1)} KB gzip`);
  assert.ok(report.withinBudget);
  assert.ok(extra <= app05.budget.extraJsBytes, `${extra} bytes`);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-05 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

const scrollTo = (page) => page.evaluate(() => document.querySelector('section[data-app05]').scrollIntoView());

test('full mode: the shader draws at full quality, with smooth frames', { skip: skip || noBrowser }, async (t) => {
  const { context, page, errors, mode } = await openWith(browser, url(), 'app05');
  // Headless Chromium draws with a software renderer, so the ladder may already have stepped
  // down to reduced; both run the shader.
  assert.ok(['full', 'reduced'].includes(mode.mode), JSON.stringify(mode));
  await scrollTo(page);
  const probe = await page.evaluate(async () => {
    const canvas = document.querySelector('.shader__canvas');
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
    return { hidden: canvas.hidden, width: canvas.width, quality: document.querySelector('section[data-app05]').dataset.quality, p90: times[Math.floor(times.length * 0.9)] };
  });
  await page.screenshot({ path: join(shots, 'full.png') });
  await context.close();
  t.diagnostic(`quality ${probe.quality}, frame time p90 ${probe.p90.toFixed(1)} ms`);
  assert.equal(probe.hidden, false);
  assert.ok(probe.width > 0);
  assert.ok(['full', 'reduced'].includes(probe.quality), probe.quality);
  assert.ok(probe.p90 < 50, `p90 ${probe.p90} ms (headless; real devices are logged by hand)`);
  assert.deepEqual(errors, []);
});

test('the quality ladder steps down to reduced, then off, when frames are slow', { skip: skip || noBrowser }, async () => {
  // Make every frame slow by blocking the main thread inside requestAnimationFrame.
  const slow = () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => {
      const end = performance.now() + 60;
      while (performance.now() < end);
      cb(t);
    });
  };
  const { context, page } = await openWith(browser, url(), 'app05', { init: slow });
  await scrollTo(page);
  await page.waitForFunction(() => document.querySelector('section[data-app05]').dataset.quality === 'off', null, { timeout: 60_000 });
  const state = await page.evaluate(() => ({ mode: document.documentElement.dataset.app05, canvasHidden: document.querySelector('.shader__canvas').hidden }));
  await context.close();
  assert.deepEqual(state, { mode: 'fallback', canvasHidden: true });
});

const FALLBACKS = [
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'no-webgl', options: { init: NO_WEBGL } },
  { reason: 'low-end-device', options: { init: LOW_END } },
  { reason: 'slow-network', options: { init: SLOW_NETWORK } },
];

for (const { reason, options } of FALLBACKS) {
  test(`fallback: ${reason} keeps the gradient${reason === 'reduced-motion' ? ' with one still frame' : ''}`, { skip: skip || noBrowser }, async () => {
    const { context, page, errors, mode } = await openWith(browser, url(), 'app05', options);
    assert.deepEqual(mode, { mode: 'fallback', reason });
    const state = await page.evaluate(() => {
      const s = document.querySelector('section[data-app05]');
      return { canvasHidden: s.querySelector('.shader__canvas').hidden, gradient: getComputedStyle(s).backgroundImage.includes('gradient'), heading: s.querySelector('h2').textContent };
    });
    await page.screenshot({ path: join(shots, `fallback-${reason}.png`) });
    await context.close();
    assert.equal(state.gradient, true, 'the CSS gradient is always there');
    assert.equal(state.canvasHidden, reason !== 'reduced-motion', 'only reduced motion shows the still frame');
    assert.equal(state.heading, 'Light, in motion');
    assert.deepEqual(errors, []);
  });
}

test('fallback: a forced load failure keeps the gradient', { skip: skip || noBrowser }, async () => {
  const { context, mode } = await openWith(browser, url() + '?forge-fallback=load-failed', 'app05');
  await context.close();
  assert.deepEqual(mode, { mode: 'fallback', reason: 'load-failed' });
});

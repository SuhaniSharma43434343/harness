// T19: the APP-02 Cinematic Scroll module. Build: a launch site with APP-02 sections builds and
// passes the routes, accessibility and responsive gates. Fallback: reduced motion, a low-end
// device, a slow network and a failed load each give the static stacked layout, checked by DOM
// assertion and screenshot. Budget: at most 60 KB extra JavaScript, CLS at most 0.1, and a
// frame-time probe while scrolling. Real-device checks are manual: docs/device-log.md.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app02 from '../../src/approaches/app02.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { addSections, buildSkipReason, linkModules, packageCache, scaffold } from './approach-helpers.mjs';

let skip = buildSkipReason();
let cache;
if (!skip) {
  try {
    cache = packageCache(app02.packages);
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

const STORY = `  - use: "APP-02/ScrollStory"
    heading: "How Lumen works"
    steps:
      - title: "Plug it in"
        text: "Lumen fits any standard socket and finds your network on its own."
      - title: "Set the mood"
        text: "Choose a scene once, and Lumen remembers it for every room."
      - title: "Forget about it"
        text: "Schedules follow the sun, so the lights are right without a thought."
  - use: "APP-02/Chapter"
    eyebrow: "Chapter two"
    heading: "Light that follows you"
    text: "Rooms brighten as you arrive and dim when you leave."`;

let site;
let baseline;
let server;
const shots = mkdtempSync(join(tmpdir(), 'forge-app02-shots-'));

before(async () => {
  if (skip) return;
  const base = scaffold('launch');
  linkModules(base.siteDir);
  const b0 = buildSite(base.siteDir, { install: 'never' });
  assert.ok(b0.ok, b0.output.slice(-2000));
  baseline = siteReport(b0.dist);

  site = scaffold('launch');
  site.applied = app02.apply(site.siteDir, { install: false });
  linkModules(site.siteDir, cache, app02.packages.map((p) => p.name));
  addSections(site.siteDir, '/', STORY);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

test('apply adds the sections, runtime, packages, licence rows and site setting', { skip }, () => {
  const { siteDir } = site;
  for (const f of ['src/sections/APP-02/ScrollStory.astro', 'src/sections/APP-02/Chapter.astro', 'src/lib/app02/cinematic.js', 'src/lib/app02/app02.css']) assert.ok(existsSync(join(siteDir, f)), f);
  const pkg = JSON.parse(readFileSync(join(siteDir, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.gsap, '3.15.0');
  assert.equal(pkg.dependencies.lenis, '1.3.27');
  assert.ok(JSON.parse(readFileSync(join(siteDir, 'src/site.json'), 'utf8')).approaches.includes('APP-02'));
  const register = JSON.parse(readFileSync(join(siteDir, '..', 'assets/register.json'), 'utf8')).assets;
  assert.equal(register.find((r) => r.package === 'gsap').status, 'uncertain', 'GSAP stays blocking until its terms are verified');
  assert.equal(register.find((r) => r.package === 'lenis').status, 'cleared');
  // Applying again changes nothing.
  app02.apply(siteDir, { install: false });
  assert.equal(JSON.parse(readFileSync(join(siteDir, '..', 'assets/register.json'), 'utf8')).assets.length, register.length);
});

test('build: the APP-02 site builds and stays within 60 KB of extra JavaScript', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const html = readFileSync(join(site.build.dist, 'index.html'), 'utf8');
  assert.match(html, /data-app02="story"/);
  assert.equal((html.match(/data-app02-step/g) ?? []).length, 3);
  const report = siteReport(site.build.dist);
  const extra = report.totalJsBytes - baseline.totalJsBytes;
  assert.ok(report.withinBudget, 'GSAP and Lenis load on demand, so the up-front JavaScript stays within the APP-01 budget');
  assert.ok(report.lazyJsBytes > 20 * 1024, 'GSAP and Lenis are lazy chunks');
  t.diagnostic(`extra JavaScript: ${(extra / 1024).toFixed(1)} KB gzip`);
  assert.ok(extra > 20 * 1024, `the GSAP and Lenis chunks are in the build (${extra} bytes)`);
  assert.ok(extra <= app02.budget.extraJsBytes, `${extra} bytes of extra JavaScript (budget ${app02.budget.extraJsBytes})`);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-02 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

// Pages are opened with a mid-range device profile unless a test says otherwise.
async function open({ reducedMotion = 'no-preference', init, block } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
  await context.addInitScript(init ?? (() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })));
  if (block) await context.route(block, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(server.url + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.app02, null, { timeout: 10_000 });
  return { context, page, errors };
}

const mode = (page) => page.evaluate(() => ({ mode: document.documentElement.dataset.app02, reason: document.documentElement.dataset.app02Reason ?? null }));

test('full mode: the story pins and scrubs, with CLS at most 0.1 and smooth frames', { skip: skip || noBrowser }, async (t) => {
  const { context, page, errors } = await open();
  assert.deepEqual(await mode(page), { mode: 'full', reason: null });
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  assert.ok(await page.$('.pin-spacer'), 'ScrollTrigger pinned the story');

  // Frame-time probe: scroll through the page and record the time between frames.
  const frames = await page.evaluate(async () => {
    const times = [];
    let last = performance.now();
    let running = true;
    const tick = (t) => {
      times.push(t - last);
      last = t;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const end = document.documentElement.scrollHeight;
    for (let y = 0; y < end; y += 120) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 16));
    }
    running = false;
    return times.slice(5).sort((a, b) => a - b);
  });
  const p95 = frames[Math.floor(frames.length * 0.95)];
  const visible = await page.$$eval('[data-app02-step]', (els) => els.map((e) => getComputedStyle(e).visibility));
  const cls = await page.evaluate(() => window.__cls);
  await page.screenshot({ path: join(shots, 'full.png') });
  await context.close();

  t.diagnostic(`CLS ${cls.toFixed(3)}, frame time p95 ${p95.toFixed(1)} ms over ${frames.length} frames`);
  assert.ok(cls <= app02.budget.cls, `CLS ${cls}`);
  assert.ok(p95 < 50, `95th percentile frame time ${p95.toFixed(1)} ms (headless; real devices are logged by hand)`);
  assert.ok(visible.includes('visible'), 'the last step is shown at the end of the scrub');
  assert.deepEqual(errors, []);
});

const FALLBACKS = [
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'low-end-device', options: { init: () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }) } },
  {
    reason: 'slow-network',
    options: {
      init: () => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '3g', saveData: false }) });
      },
    },
  },
  { reason: 'load-failed', options: { block: (url) => /ScrollTrigger|lenis/i.test(url.pathname) } },
];

for (const { reason, options } of FALLBACKS) {
  test(`fallback: ${reason} gives the static stacked layout`, { skip: skip || noBrowser }, async () => {
    const { context, page, errors } = await open(options);
    assert.deepEqual(await mode(page), { mode: 'fallback', reason });
    assert.equal(await page.$('.pin-spacer'), null, 'nothing is pinned');
    // Every step is in the page flow, one below the other, and readable once scrolled to.
    const boxes = [];
    for (const step of await page.$$('[data-app02-step]')) {
      await step.scrollIntoViewIfNeeded();
      await page.waitForTimeout(reason === 'reduced-motion' ? 0 : 400);
      boxes.push(await step.evaluate((e) => ({ top: e.getBoundingClientRect().top + scrollY, height: e.offsetHeight, opacity: Number(getComputedStyle(e).opacity) })));
    }
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top >= boxes[i - 1].top + boxes[i - 1].height, 'stacked');
    assert.ok(boxes.every((b) => b.opacity === 1), JSON.stringify(boxes));
    const shot = await page.screenshot({ path: join(shots, `fallback-${reason}.png`), fullPage: true });
    assert.ok(shot.length > 1000);
    await context.close();
    if (reason !== 'load-failed') assert.deepEqual(errors, []);
  });
}

test('fallback: without JavaScript every step is visible', { skip: skip || noBrowser }, async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(server.url + '/');
  const opacity = await page.$$eval('[data-app02-step]', (els) => els.map((e) => getComputedStyle(e).opacity));
  await context.close();
  assert.deepEqual(opacity, ['1', '1', '1']);
});

test('budget: Lighthouse mobile on the APP-02 page', { skip: skip || noBrowser || (process.env.FORGE_SLOW_TESTS ? false : 'set FORGE_SLOW_TESTS=1 to run Lighthouse'), timeout: 600_000 }, async (t) => {
  const r = await runGate('performance', site.siteDir, { thresholds: { maxPages: 1, cls: app02.budget.cls } });
  t.diagnostic(JSON.stringify(r.metrics));
  assert.equal(r.status, 'pass', JSON.stringify(r.findings));
});

// T20: the APP-06 Game-Like module. Build: a site with a Game section builds and passes the
// routes, accessibility and responsive gates. Play: keyboard and touch both collect items, each
// item opens in the explainer, progress is announced and kept for the visit, and skip opens
// everything. Fallback: no WebGL, a low-end device, a slow network and a failed load each give
// the explainer alone, by DOM assertion and screenshot. Budget: Phaser loads after the page,
// at most 400 KB gzip, and the game runs at 30 fps or more in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app06 from '../../src/approaches/app06.mjs';
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
    cache = packageCache(app06.packages);
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

const GAME = `  - use: "APP-06/Game"
    id: "festival"
    heading: "Find the three stages"
    intro: "Move the light to discover what happens on each stage."
    items:
      - title: "Main stage"
        text: "Headline sets every evening from seven."
      - title: "Garden stage"
        text: "Acoustic sessions through the afternoon."
      - title: "Kids' tent"
        text: "Workshops and stories for under-tens, all day."`;

let site;
let server;
let lazyChunks = [];
const shots = mkdtempSync(join(tmpdir(), 'forge-app06-shots-'));

before(async () => {
  if (skip) return;
  site = scaffold('event');
  site.baseline = (() => {
    const base = scaffold('event');
    linkModules(base.siteDir);
    return siteReport(buildSite(base.siteDir, { install: 'never' }).dist);
  })();
  app06.apply(site.siteDir, { install: false });
  linkModules(site.siteDir, cache, app06.packages.map((p) => p.name));
  addSections(site.siteDir, '/', GAME);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (!site.build.ok) return;
  const upFront = initialScripts(site.build.dist, 'index.html');
  lazyChunks = readdirSync(join(site.build.dist, '_astro')).filter((f) => f.endsWith('.js') && !upFront.has(`_astro/${f}`));
  server = await serveSite(site.build.dist);
});
after(async () => {
  await server?.close();
  await browser?.close();
});

test('build: the APP-06 site builds; Phaser loads on demand within 400 KB gzip', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const report = siteReport(site.build.dist);
  const extra = report.totalJsBytes - site.baseline.totalJsBytes;
  t.diagnostic(`up-front ${(report.jsBytes / 1024).toFixed(1)} KB, extra ${(extra / 1024).toFixed(1)} KB gzip`);
  assert.ok(report.withinBudget);
  assert.ok(report.lazyJsBytes > 100 * 1024, 'Phaser is a lazy chunk');
  assert.ok(extra <= app06.budget.extraJsBytes, `${extra} bytes (budget ${app06.budget.extraJsBytes})`);
  const html = readFileSync(join(site.build.dist, 'index.html'), 'utf8');
  assert.match(html, /data-app06="game"/);
  assert.equal((html.match(/<details/g) ?? []).length, 3, 'the explainer has every item');
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-06 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

const url = () => server.url + '/';
const ready = (page) => page.waitForFunction(() => document.querySelector('[data-app06="game"] canvas'), null, { timeout: 15_000 });
const state = (page) =>
  page.$eval('[data-app06="game"]', (s) => ({
    progress: s.querySelector('.game__progress').textContent,
    found: [...s.querySelectorAll('[data-item]')].map((li) => li.dataset.found === 'true'),
    open: [...s.querySelectorAll('details')].map((d) => d.open),
  }));

test('play: the keyboard collects every item, opens it and announces progress; the game runs at 30 fps or more', { skip: skip || noBrowser }, async (t) => {
  const r = await openWith(browser, url(), 'app06', { viewport: { width: 1280, height: 900 } });
  assert.deepEqual(r.mode, { mode: 'full', reason: null });
  await ready(r.page);
  await r.page.focus('.game__canvas');
  await r.page.keyboard.down('ArrowRight');
  await r.page.waitForFunction(() => document.querySelector('[data-app06="game"]').dataset.progress === '3', null, { timeout: 15_000 });
  await r.page.keyboard.up('ArrowRight');
  const fps = await r.page.$eval('[data-app06="game"]', (s) => s.game.loop.actualFps);
  t.diagnostic(`actual fps ${fps.toFixed(1)}`);
  const s = await state(r.page);
  assert.deepEqual(s.found, [true, true, true]);
  assert.deepEqual(s.open, [true, true, true]);
  assert.match(s.progress, /All 3 found/);
  assert.ok(fps >= app06.budget.minFps, `${fps} fps`);
  // Progress is kept for the visit.
  await r.page.reload({ waitUntil: 'load' });
  await ready(r.page);
  assert.deepEqual((await state(r.page)).found, [true, true, true]);
  await r.page.screenshot({ path: join(shots, 'played.png') });
  await r.context.close();
  assert.deepEqual(r.errors, []);
});

test('play: pressing on the stage moves the light there (touch and mouse share one pointer)', { skip: skip || noBrowser }, async () => {
  const r = await openWith(browser, url(), 'app06', { viewport: { width: 1280, height: 900 }, hasTouch: true });
  await ready(r.page);
  const box = await r.page.$eval('[data-app06="game"] canvas', (c) => {
    const b = c.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  // Hold the pointer at the first orb until it is collected.
  const target = { x: box.x + box.w * 0.28, y: box.y + box.h / 2 };
  await r.page.mouse.move(target.x, target.y);
  await r.page.mouse.down();
  await r.page.waitForFunction(() => Number(document.querySelector('[data-app06="game"]').dataset.progress) >= 1, null, { timeout: 15_000 });
  await r.page.mouse.up();
  assert.equal((await state(r.page)).found[0], true);
  await r.context.close();
});

test('play: skip ends the game, opens every item and moves focus to the explainer', { skip: skip || noBrowser }, async () => {
  const r = await openWith(browser, url(), 'app06');
  await ready(r.page);
  await r.page.click('.game__skip');
  const s = await state(r.page);
  assert.deepEqual(s.open, [true, true, true]);
  assert.equal(await r.page.$('[data-app06="game"] canvas'), null);
  assert.equal(await r.page.evaluate(() => document.activeElement.textContent), '3 things to find');
  await r.context.close();
});

test('play: reduced motion keeps the game, without animation', { skip: skip || noBrowser }, async () => {
  const r = await openWith(browser, url(), 'app06', { reducedMotion: 'reduce' });
  assert.deepEqual(r.mode, { mode: 'full', reason: null });
  await ready(r.page);
  const tweens = await r.page.$eval('[data-app06="game"]', (s) => s.game.scene.scenes[0].tweens.getTweens().length);
  assert.equal(tweens, 0);
  await r.context.close();
});

test('budget: Phaser is requested only after the load event', { skip: skip || noBrowser }, async () => {
  const r = await openWith(browser, url(), 'app06');
  await ready(r.page);
  const timing = await r.page.evaluate((chunks) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const lazy = performance.getEntriesByType('resource').filter((e) => chunks.some((c) => e.name.endsWith(c)));
    return { load: nav.loadEventEnd, first: Math.min(...lazy.map((e) => e.startTime)) };
  }, lazyChunks);
  await r.context.close();
  assert.ok(timing.first >= timing.load, JSON.stringify(timing));
});

const FALLBACKS = [
  { reason: 'no-webgl', options: { init: NO_WEBGL } },
  { reason: 'low-end-device', options: { init: LOW_END } },
  { reason: 'slow-network', options: { init: SLOW_NETWORK } },
  { reason: 'load-failed', options: { block: (u) => lazyChunks.some((c) => u.pathname.endsWith(c)) } },
];

for (const { reason, options } of FALLBACKS) {
  test(`fallback: ${reason} gives the explainer with every item`, { skip: skip || noBrowser }, async () => {
    const r = await openWith(browser, url(), 'app06', options);
    assert.deepEqual(r.mode, { mode: 'fallback', reason });
    assert.equal(await r.page.$eval('.game__stage', (s) => s.hidden), true, 'no game stage');
    // Every item can be opened without playing.
    for (const summary of await r.page.$$('[data-app06="game"] summary')) {
      const open = await summary.evaluate((s) => s.parentElement.open);
      if (!open) await summary.click();
    }
    assert.deepEqual((await state(r.page)).open, [true, true, true]);
    const shot = await r.page.screenshot({ path: join(shots, `fallback-${reason}.png`), fullPage: true });
    assert.ok(shot.length > 1000);
    await r.context.close();
  });
}

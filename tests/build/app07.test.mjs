// T12: the APP-07 composite. One flagship site with APP-02 (cinematic scroll), APP-03 (a 3D
// scene) and APP-05 (a shader background) on top of APP-01. Build: it builds, keeps every part
// out of the up-front JavaScript, stays within the shared budget, and passes the routes,
// accessibility and responsive gates. Shared budget: at most one WebGL canvas runs at any point
// of the scroll. Fallback: without WebGL the site drops to APP-01 + APP-02 (the scroll story keeps
// running, the 3D parts show their posters); with reduced motion every part falls back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app07, { assertComposite, checkComposite } from '../../src/approaches/app07.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { addSections, buildSkipReason, linkModules, packageCache, scaffold, tinyGlb } from './approach-helpers.mjs';
import { NO_WEBGL, openWith } from './fallback-helpers.mjs';

let skip = buildSkipReason();
let cache;
if (!skip) {
  try {
    cache = packageCache(app07.partPackages);
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
const SECTIONS = `  - use: "APP-05/ShaderBackground"
    heading: "A new kind of light"
    text: "Calm colour that moves with you."
  - use: "APP-02/ScrollStory"
    heading: "How it comes together"
    steps:
      - title: "Designed"
        text: "Every curve drawn by hand before it is made."
      - title: "Made"
        text: "Machined from one block, then finished by hand."
      - title: "Delivered"
        text: "Packed to arrive the way it left the bench."
  - use: "APP-03/Scene3D"
    heading: "Turn it over"
    model: "/models/triangle.glb"
    poster: { src: "/images/poster.svg", alt: "The lamp on a stand", width: 1200, height: 800 }`;

let site;
let baseline;
let server;

before(async () => {
  if (skip) return;
  const base = scaffold('flagship');
  linkModules(base.siteDir);
  const b0 = buildSite(base.siteDir, { install: 'never' });
  assert.ok(b0.ok, b0.output.slice(-2000));
  baseline = siteReport(b0.dist);

  site = scaffold('flagship');
  site.applied = app07.apply(site.siteDir, { install: false, shader: true });
  linkModules(site.siteDir, cache, app07.partPackages.map((p) => p.name));
  mkdirSync(join(site.siteDir, 'public/images'), { recursive: true });
  mkdirSync(join(site.siteDir, 'public/models'), { recursive: true });
  writeFileSync(join(site.siteDir, 'public/images/poster.svg'), POSTER);
  writeFileSync(join(site.siteDir, 'public/models/triangle.glb'), tinyGlb());
  addSections(site.siteDir, '/', SECTIONS);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

const url = () => server.url + '/';

test('apply puts APP-02, APP-03 and APP-05 into one site', { skip }, () => {
  assert.deepEqual(site.applied.parts, ['APP-02', 'APP-03', 'APP-05']);
  for (const f of ['src/sections/APP-02/ScrollStory.astro', 'src/sections/APP-03/Scene3D.astro', 'src/sections/APP-05/ShaderBackground.astro']) assert.ok(site.applied.files.includes(f), f);
  assert.deepEqual(site.applied.packages.sort(), ['gsap@3.15.0', 'lenis@1.3.27', 'three@0.186.1']);
});

test('build: every part loads on demand, within the shared budget', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const r = assertComposite(siteReport(site.build.dist), baseline, { shader: true });
  t.diagnostic(`extra JavaScript ${(r.extraJsBytes / 1024).toFixed(1)} KB of a shared ${(r.limit / 1024).toFixed(0)} KB`);
});

test('the shared budget check refuses a composite that grows too far or loads up front', () => {
  const base = { totalJsBytes: 100_000, withinBudget: true };
  assert.equal(checkComposite({ totalJsBytes: 100_000 + 300 * 1024, withinBudget: true }, base).ok, true);
  assert.match(checkComposite({ totalJsBytes: 100_000 + 400 * 1024, withinBudget: true }, base).problems[0], /over the shared/);
  assert.equal(checkComposite({ totalJsBytes: 100_000 + 380 * 1024, withinBudget: true }, base, { shader: true }).ok, true);
  assert.match(checkComposite({ totalJsBytes: 100_000, withinBudget: false }, base).problems[0], /up-front/);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-07 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

test('full mode: every part runs, and at most one WebGL canvas runs at any point of the scroll', { skip: skip || noBrowser }, async () => {
  const { context, page, errors } = await openWith(browser, url(), 'app02');
  // APP-03 and APP-05 start when they come near the viewport, which the scroll below does.
  const samples = await page.evaluate(async () => {
    const out = [];
    const end = document.documentElement.scrollHeight;
    for (let y = 0; y <= end; y += Math.round(innerHeight / 3)) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
      out.push((globalThis.__forgeWebglSlots?.list ?? []).filter((s) => s.running).length);
    }
    return out;
  });
  const modes = await page.evaluate(() => ({ app02: document.documentElement.dataset.app02, app03: document.documentElement.dataset.app03, app05: document.documentElement.dataset.app05 }));
  await context.close();
  assert.equal(modes.app02, 'full');
  assert.equal(modes.app03, 'full');
  assert.ok(['full', 'reduced'].includes(modes.app05), modes.app05);
  assert.ok(Math.max(...samples) <= 1, `running WebGL sections while scrolling: ${samples.join(',')}`);
  assert.ok(samples.includes(1), 'a WebGL section ran when it was in view');
  assert.deepEqual(errors, []);
});

test('fallback: without WebGL the site drops to APP-01 + APP-02', { skip: skip || noBrowser }, async () => {
  const { context, page, errors } = await openWith(browser, url(), 'app02', { init: NO_WEBGL });
  await page.evaluate(() => document.querySelector('section[data-app03]').scrollIntoView());
  await page.waitForFunction(() => document.documentElement.dataset.app03 && document.documentElement.dataset.app05, null, { timeout: 20_000 });
  const modes = await page.evaluate(() => ({ app02: document.documentElement.dataset.app02, app03: document.documentElement.dataset.app03Reason, app05: document.documentElement.dataset.app05Reason }));
  await context.close();
  assert.deepEqual(modes, { app02: 'full', app03: 'no-webgl', app05: 'no-webgl' });
  assert.deepEqual(errors, []);
});

test('fallback: with reduced motion every part falls back', { skip: skip || noBrowser }, async () => {
  const { context, page } = await openWith(browser, url(), 'app02', { reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.app03 && document.documentElement.dataset.app05, null, { timeout: 20_000 });
  const modes = await page.evaluate(() => ['app02', 'app03', 'app05'].map((a) => document.documentElement.dataset[a]));
  await context.close();
  assert.deepEqual(modes, ['fallback', 'fallback', 'fallback']);
});

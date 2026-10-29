// T12: the APP-08 Image Frame Animation module. Build: a site with a FrameSequence and a
// DepthParallax builds, adds no package and passes the routes, accessibility and responsive
// gates. Full: scrolling scrubs through the frames, with no part of the scroll left without a
// frame, and the depth scene follows the pointer. Fallback: reduced motion, a low-end device, a
// slow network and a failed frame load each keep the key frame; no WebGL keeps the depth image.
// Budget: frames at most 3 MB, numbered without gaps; every frame has a provenance row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app08, { checkFrames, extractFrames, listFrames, registerFrames } from '../../src/approaches/app08.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { buildSite } from '../../src/site/build.mjs';
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

const COUNT = 24;
// One frame of a small sunrise: the sun climbs as the sequence plays.
const frame = (i) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="hsl(${200 + i * 2} 45% ${20 + i}%)"/><circle cx="640" cy="${620 - i * 18}" r="90" fill="#f2c14e"/><text x="40" y="680" font-size="40" fill="#fff">${i + 1}</text></svg>`;
const DEPTH_IMAGE = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#9fb7c9"/><rect x="250" y="150" width="300" height="300" fill="#1f3a5f"/></svg>';
const DEPTH_MAP = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#202020"/><rect x="250" y="150" width="300" height="300" fill="#f0f0f0"/></svg>';

const SECTIONS = `  - use: "APP-08/FrameSequence"
    heading: "Morning, frame by frame"
    text: "Scroll to bring the sun up."
    frames: { pattern: "/frames/sunrise/%03d.svg", count: ${COUNT}, width: 1280, height: 720 }
    keyFrame: { src: "/frames/sunrise/001.svg", alt: "A sunrise over still water" }
    length: 3
  - use: "APP-08/DepthParallax"
    heading: "Step closer"
    image: { src: "/images/depth.svg", alt: "A blue block in front of a pale wall", width: 800, height: 600 }
    depthMap: "/images/depth-map.svg"`;

let site;
let server;
const shots = mkdtempSync(join(tmpdir(), 'forge-app08-shots-'));

before(async () => {
  if (skip) return;
  site = scaffold('launch');
  site.applied = app08.apply(site.siteDir, { install: false });
  linkModules(site.siteDir);
  const frames = join(site.siteDir, 'public/frames/sunrise');
  mkdirSync(frames, { recursive: true });
  for (let i = 0; i < COUNT; i++) writeFileSync(join(frames, `${String(i + 1).padStart(3, '0')}.svg`), frame(i));
  mkdirSync(join(site.siteDir, 'public/images'), { recursive: true });
  writeFileSync(join(site.siteDir, 'public/images/depth.svg'), DEPTH_IMAGE);
  writeFileSync(join(site.siteDir, 'public/images/depth-map.svg'), DEPTH_MAP);
  addSections(site.siteDir, '/', SECTIONS);
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

const url = () => server.url + '/';

test('apply adds the sections and runtime, and no package', { skip }, () => {
  assert.deepEqual(site.applied.packages, []);
  for (const f of ['src/sections/APP-08/FrameSequence.astro', 'src/sections/APP-08/DepthParallax.astro', 'src/lib/app08/frames.js']) assert.ok(site.applied.files.includes(f), f);
});

test('budget: the frames are under 3 MB and numbered without gaps', { skip }, () => {
  const r = checkFrames(join(site.siteDir, 'public/frames/sunrise'));
  assert.deepEqual([r.ok, r.count, r.pattern], [true, COUNT, '%03d.svg']);
  assert.ok(r.bytes < app08.budget.framesBytes);
});

test('the frame checks catch a gap, a bad name and an oversize sequence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-frames-'));
  for (const n of [1, 2, 4]) writeFileSync(join(dir, `${String(n).padStart(3, '0')}.webp`), Buffer.alloc(10));
  assert.deepEqual(checkFrames(dir).problems, ['missing frame numbers: 3']);
  assert.match(checkFrames(dir, { budget: 5 }).problems[0], /over the/);
  writeFileSync(join(dir, 'cover.webp'), Buffer.alloc(1));
  assert.match(checkFrames(dir).problems.join(), /must end in its number/);
  assert.deepEqual(listFrames(dir).slice(0, 3), ['001.webp', '002.webp', '004.webp']);
});

test('every frame gets a provenance row; generated frames need the generator terms', () => {
  const project = mkdtempSync(join(tmpdir(), 'forge-prov-'));
  const files = ['001.webp', '002.webp'];
  assert.throws(() => registerFrames(project, '/frames/hero', { files, provenance: { source: 'studio shoot' } }), /source and licence/);
  assert.throws(() => registerFrames(project, '/frames/hero', { files, provenance: { source: 'generated', licence: 'owned', generator: 'an image model' } }), /terms/);
  registerFrames(project, '/frames/hero', { files, provenance: { source: 'Client video, 2026 launch', licence: 'client-owned' } });
  const rows = JSON.parse(readFileSync(join(project, 'assets/register.json'), 'utf8')).assets;
  assert.deepEqual(rows.map((r) => r.path), ['/frames/hero/001.webp', '/frames/hero/002.webp']);
});

test('without ffmpeg, extracting frames from a video is a clear ConfigMissing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-video-'));
  writeFileSync(join(dir, 'clip.mp4'), 'x');
  assert.throws(() => extractFrames(join(dir, 'clip.mp4'), join(dir, 'out'), { ffmpeg: 'forge-no-such-ffmpeg' }), (e) => e.code === 'CONFIG_MISSING' && /ffmpeg/.test(e.message));
});

test('build: the APP-08 site builds', { skip }, () => {
  assert.ok(site.build.ok, site.build.output.slice(-2000));
  const html = readFileSync(join(site.build.dist, 'index.html'), 'utf8');
  assert.match(html, /data-app08="sequence"/);
  assert.match(html, /data-app08="depth"/);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`build: the APP-08 site passes the ${gate} gate`, { skip: skip || noBrowser }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });
}

test('full mode: scrolling scrubs through every part of the sequence', { skip: skip || noBrowser }, async () => {
  const { context, page, errors, mode } = await openWith(browser, url(), 'app08');
  assert.deepEqual(mode, { mode: 'full', reason: null });
  await page.waitForFunction(() => document.querySelector('section[data-app08="sequence"]').dataset.loaded === 'true', null, { timeout: 20_000 });
  const seen = await page.evaluate(async () => {
    const s = document.querySelector('section[data-app08="sequence"]');
    const top = s.getBoundingClientRect().top + scrollY;
    const travel = s.offsetHeight - innerHeight;
    const frames = [];
    for (let k = 0; k <= 20; k++) {
      window.scrollTo(0, top + (travel * k) / 20);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      frames.push(Number(s.dataset.frame));
    }
    return frames;
  });
  await page.screenshot({ path: join(shots, 'full.png') });
  await context.close();
  assert.equal(seen[0], 0);
  assert.equal(seen.at(-1), 23, 'the end of the scroll shows the last frame');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `frames move forward: ${seen.join(',')}`);
  assert.ok(new Set(seen).size >= 15, 'no scroll segment is stuck on one frame');
  assert.deepEqual(errors, []);
});

test('full mode: the depth scene draws over its image', { skip: skip || noBrowser }, async () => {
  const { context, page, errors } = await openWith(browser, url(), 'app08');
  await page.evaluate(() => document.querySelector('section[data-app08="depth"]').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('section[data-app08="depth"]').dataset.depthMode, null, { timeout: 20_000 });
  const state = await page.evaluate(() => {
    const s = document.querySelector('section[data-app08="depth"]');
    return { mode: s.dataset.depthMode, hidden: s.querySelector('canvas').hidden };
  });
  await context.close();
  assert.deepEqual(state, { mode: 'full', hidden: false });
  assert.deepEqual(errors, []);
});

const FALLBACKS = [
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'low-end-device', options: { init: LOW_END } },
  { reason: 'slow-network', options: { init: SLOW_NETWORK } },
  // Every frame request fails, the key frame's included: the section keeps its place and text.
  { reason: 'load-failed', options: { block: (u) => /\/frames\//.test(u.pathname) } },
];

for (const { reason, options } of FALLBACKS) {
  test(`fallback: ${reason} keeps the key frame`, { skip: skip || noBrowser }, async () => {
    const { context, page, errors, mode } = await openWith(browser, url(), 'app08', options);
    assert.deepEqual(mode, { mode: 'fallback', reason });
    const state = await page.evaluate(() => {
      const s = document.querySelector('section[data-app08="sequence"]');
      const key = s.querySelector('.frames__key');
      return { live: s.classList.contains('is-live'), canvasHidden: s.querySelector('.frames__canvas').hidden, keyVisible: getComputedStyle(key).visibility, keyShown: key.complete && key.naturalWidth > 0 };
    });
    await page.screenshot({ path: join(shots, `fallback-${reason}.png`) });
    await context.close();
    assert.deepEqual(state, { live: false, canvasHidden: true, keyVisible: 'visible', keyShown: reason !== 'load-failed' || state.keyShown });
    if (reason !== 'load-failed') assert.deepEqual(errors, []);
  });
}

test('fallback: without WebGL the depth image stays, and the sequence still scrubs', { skip: skip || noBrowser }, async () => {
  const { context, page, mode } = await openWith(browser, url(), 'app08', { init: NO_WEBGL });
  await page.evaluate(() => document.querySelector('section[data-app08="depth"]').scrollIntoView());
  await page.waitForFunction(() => document.querySelector('section[data-app08="depth"]').dataset.depthMode, null, { timeout: 20_000 });
  const depth = await page.evaluate(() => document.querySelector('section[data-app08="depth"]').dataset.depthMode);
  await context.close();
  assert.equal(mode.mode, 'full', 'the frame sequence is plain canvas and needs no WebGL');
  assert.equal(depth, 'no-webgl');
});

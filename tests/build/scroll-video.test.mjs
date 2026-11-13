// The scroll video engine (APP-02 ScrollVideo), end to end on one built site. Eight videos are
// generated on this machine (tests/fixtures/scroll-video/make-videos.mjs) with a time code in
// every frame; ten configs place them with every layout. Each test names the acceptance
// criterion it checks (docs/scroll-video/07-qa-acceptance.md). Timings are headless Chromium on
// this machine, printed as diagnostics; they are measurements, not claims about real devices.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import app02 from '../../src/approaches/app02.mjs';
import { runGate } from '../../src/gates/index.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { loadConfig, saveConfig } from '../../src/scroll-video/config.mjs';
import { CAPABLE, checkScrollVideos, driveScrollVideo, evaluateDrive, snapshot, waitForEngine } from '../../src/scroll-video/qa.mjs';
import { addVideo, checkScrollVideo, writeFrames, writeStills } from '../../src/scroll-video/project.mjs';
import { probeFile } from '../../src/scroll-video/probe.mjs';
import { buildSite, siteReport } from '../../src/site/build.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';
import { CONCEPTS, READ_FRAME, makeVideos } from '../fixtures/scroll-video/make-videos.mjs';
import { buildSkipReason, linkModules, packageCache, scaffold } from './approach-helpers.mjs';

let skip = buildSkipReason();
let browser;
try {
  browser = await launchBrowser();
  await loadTool('axe-core');
} catch (err) {
  skip ||= `browser test tools are not available: ${err.message}`;
}
// The catch-all route imports every APP-02 section, so GSAP and Lenis must resolve at build time
// even though a ScrollVideo page never loads them.
let cache;
if (!skip) {
  try {
    cache = packageCache(app02.packages);
  } catch (err) {
    skip = err.message;
  }
}
let videos;
if (!skip) {
  try {
    videos = await makeVideos(browser);
  } catch (err) {
    skip = `cannot make the test videos: ${err.message}`;
  }
}
after(() => browser?.close());

// ---- the configs: everything project-specific lives here, none of it in the engine ----
const S = (id, start, end, title, extra = {}) => ({ id, start, end, title, ...extra });
const CONFIGS = {
  pizza: {
    video: 'pizza',
    layout: { type: 'cinematic', theme: 'invert' },
    animation: { text: 'rise', progress: 'rail' },
    scroll: { length: 5 },
    scenes: [
      S('dough', 0, 1.5, 'Dough, stretched by hand', { position: 'bottom-start', description: 'Seventy-two hours of cold rise before it meets the oven.' }),
      S('sauce', 1.5, 3, 'San Marzano, crushed that morning', { position: 'top-end', animation: 'slide' }),
      S('cheese', 3, 4.5, 'Fior di latte, torn not grated', { position: 'center', animation: 'fade', overlay: { type: 'stat', value: '90 s', text: 'in a 485 °C oven' } }),
      S('basil', 4.5, 6, 'Basil last, so it stays green', { position: 'bottom-end', cta: { label: 'Order tonight', href: '/#waitlist' } }),
    ],
  },
  // R4: the same video, different markers and a different number of scenes, config only.
  'pizza-alt': {
    video: 'pizza',
    copyVideoFrom: 'pizza',
    layout: { type: 'sticky-text' },
    scroll: { length: 7 },
    scenes: [
      S('a', 0, 0.8, 'One'), S('b', 0.8, 1.9, 'Two'), S('c', 1.9, 2.6, 'Three'),
      S('d', 2.6, 3.9, 'Four'), S('e', 3.9, 5, 'Five'), S('f', 5, 6, 'Six'),
    ],
  },
  car: {
    video: 'car',
    layout: { type: 'labels', theme: 'invert', focus: '60% 50%' },
    scroll: { length: 7, render: 'video' },
    scenes: [
      S('dark', 0, 1.1, 'Lights down', { label: 'Dark' }), S('sweep', 1.1, 2.3, 'The first sweep', { label: 'Sweep' }),
      S('line', 2.3, 3.4, 'One unbroken line', { label: 'Line' }), S('wheels', 3.4, 4.6, 'Twenty-inch forged wheels', { label: 'Wheels' }),
      S('stance', 4.6, 5.7, 'A lower stance', { label: 'Stance' }), S('glass', 5.7, 6.8, 'Glass roof', { label: 'Glass' }),
      S('lamps', 6.8, 8, 'Lamps on', { label: 'Lamps', cta: { label: 'Book a drive', href: '/#waitlist' } }),
    ],
  },
  // L9: when seeks are over the budget and frames are on hand, the engine switches to them.
  'car-auto': { video: 'car', layout: { type: 'cinematic' }, scroll: { length: 5, render: 'auto', seekBudgetMs: 1 }, frames: { fps: 15, width: 640 }, scenes: [S('one', 0, 3, 'Reveal'), S('two', 3, 5.5, 'Profile'), S('three', 5.5, 8, 'Lamps')] },
  particles: {
    video: 'particles',
    layout: { type: 'split', side: 'end' },
    animation: { text: 'mask', progress: 'bar' },
    scroll: { length: 12, lengthMobile: 12 },
    scenes: Array.from({ length: 12 }, (_, i) => {
      // Custom scroll slices: the forming of the mark (scenes 7-9) gets more scroll than its time.
      const from = [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.5, 0.64, 0.78, 0.86, 0.93][i];
      const to = [0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.5, 0.64, 0.78, 0.86, 0.93, 1][i];
      return S(`p${i + 1}`, Math.round((i * 10 / 12) * 100) / 100, i === 11 ? 10 : Math.round(((i + 1) * 10 / 12) * 100) / 100, `Particle phase ${i + 1}`, { scroll: { from, to }, animation: ['mask', 'blur', 'scale'][i % 3] });
    }),
  },
  outfit: { video: 'outfit', layout: { type: 'sticky-text' }, scenes: [S('base', 0, 1.4, 'The base layer'), S('cut', 1.4, 2.8, 'A longer cut'), S('colour', 2.8, 4.2, 'Colour that shifts'), S('drape', 4.2, 5.6, 'The drape'), S('look', 5.6, 7, 'The finished look')] },
  building: {
    video: 'building',
    layout: { type: 'background', scrim: 0.6 },
    foreground: { eyebrow: 'Twelve floors', heading: 'Built floor by floor', cta: { label: 'Register interest', href: '/#waitlist' } },
    scenes: [S('ground', 0, 1.5, 'Ground works'), S('core', 1.5, 3, 'The core'), S('frame', 3, 4.5, 'Frame'), S('facade', 4.5, 6, 'Facade'), S('top', 6, 7.5, 'Topping out'), S('done', 7.5, 9, 'Handover')].map((s) => ({ ...s, position: 'bottom-end' })),
  },
  product: {
    video: 'product',
    layout: { type: 'product' },
    scenes: [
      S('base', 0, 2, 'A machined base', { overlay: { type: 'callout', text: 'Aluminium', point: { x: 0.5, y: 0.62 } } }),
      S('body', 2, 4, 'The body drops in', { overlay: { type: 'callout', text: 'Recycled shell', point: { x: 0.5, y: 0.5 } } }),
      S('top', 4, 6, 'Controls on top', { overlay: { type: 'callout', text: 'Two dials', point: { x: 0.5, y: 0.36 } } }),
      S('key', 6, 8, 'One red key', { overlay: { type: 'callout', text: 'Power', point: { x: 0.62, y: 0.28 } } }),
    ],
  },
  journey: {
    video: 'journey',
    alternate: '(max-width: 47.99em)',
    layout: { type: 'cinematic' },
    scroll: { length: 6, lengthMobile: 5, preload: 'stream' },
    scenes: [S('coast', 0, 3, 'The coast', { focus: '30% 50%' }), S('valley', 3, 6, 'Through the valley', { focus: '50% 50%' }), S('desert', 6, 9, 'Into the desert', { focus: '70% 50%' }), S('night', 9, 12, 'Arrive at night', { focus: '50% 40%' })],
  },
  heavy: { video: 'heavy', layout: { type: 'cinematic' }, scroll: { length: 4, preload: 'blob', loadTimeoutMs: 60000 }, scenes: [S('one', 0, 3, 'Loading on a slow line'), S('two', 3, 6, 'Still in sync'), S('three', 6, 8, 'Done')] },
};

let site;
let server;
let projectDir;
const addResults = {};

before(async () => {
  if (skip) return;
  site = scaffold('launch');
  site.applied = app02.apply(site.siteDir, { install: false });
  linkModules(site.siteDir, cache, app02.packages.map((p) => p.name));
  projectDir = dirname(site.siteDir);
  for (const [id, c] of Object.entries(CONFIGS)) {
    if (c.copyVideoFrom) {
      const from = loadConfig(projectDir, c.copyVideoFrom);
      saveConfig(projectDir, { version: 1, id, video: from.video, layout: c.layout, scroll: c.scroll ?? {}, scenes: c.scenes });
      continue;
    }
    const files = [{ path: videos.files[c.video] }];
    if (c.alternate) files.push({ path: videos.files[c.video], media: c.alternate });
    addResults[id] = await addVideo(projectDir, id, { files, licence: 'Generated for the test suite on this machine', tool: 'tests/fixtures/scroll-video/make-videos.mjs', posterAlt: '', pictureTool: 'browser' });
    const cfg = loadConfig(projectDir, id);
    delete cfg.storyboard;
    Object.assign(cfg, { layout: c.layout, scroll: c.scroll ?? {}, animation: c.animation ?? {}, scenes: c.scenes }, c.foreground ? { foreground: c.foreground } : {});
    saveConfig(projectDir, cfg);
    if (c.frames) await writeFrames(projectDir, id, { ...c.frames, pictureTool: 'browser' });
  }
  for (const id of Object.keys(CONFIGS)) {
    writeFileSync(
      join(site.siteDir, 'src/content/pages', `sv-${id}.md`),
      `---\ntitle: "Scroll video ${id}"\ndescription: "Scroll video engine test page (${id})."\norder: 90\nnav: false\nstatus: "scaffold"\ncta: { label: "Join the waitlist", href: "/#waitlist" }\nsections:\n  - use: "APP-01/Hero"\n    heading: "Scroll video ${id}"\n    art: false\n    cta: false\n  - use: "APP-02/ScrollVideo"\n    id: "story-${id}"\n    config: "${id}"\n---\n`,
    );
  }
  site.build = buildSite(site.siteDir, { install: 'never' });
  if (site.build.ok) server = await serveSite(site.build.dist);
});
after(() => server?.close());

async function open(path, { viewport = { width: 1280, height: 800 }, reducedMotion = 'no-preference', init = CAPABLE, block, isMobile = false, hasTouch = false, javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, isMobile, hasTouch, javaScriptEnabled });
  await context.addInitScript(init);
  await context.addInitScript(READ_FRAME);
  if (block) await context.route(block, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(server.url + path, { waitUntil: 'load' });
  return { context, page, errors, requests };
}
const cfgOf = (id) => loadConfig(projectDir, id);
const ms = (v) => `${Math.round(v)} ms`;
// How long a step may take to settle. Correctness is asserted under this cap; the timings are
// reported as diagnostics. Alone a step settles in well under a second; with every build test
// running in parallel (npm test), or other applications busy, single seeks took up to 6 s.
const SETTLE = 20_000;

test('add-video reads each clip, copies it, makes a poster and registers it (T1, T4)', { skip }, () => {
  for (const [id, r] of Object.entries(addResults)) {
    const v = r.config.video;
    const p = probeFile(videos.files[CONFIGS[id].video]);
    assert.equal(v.durationS, p.durationS, id);
    assert.deepEqual([v.width, v.height, v.aspectRatio], [p.width, p.height, p.aspectRatio], id);
    for (const s of v.sources) assert.ok(existsSync(join(projectDir, 'assets/public', s.src)), s.src);
    assert.ok(existsSync(join(projectDir, 'assets/public', v.poster.src)), v.poster.src);
    assert.ok(existsSync(join(site.siteDir, 'public', v.poster.src)), 'copied into the site too');
  }
  assert.deepEqual(addResults.journey.config.video.sources.map((s) => s.media ?? null), ['(max-width: 47.99em)', null], 'the media-specific cut comes first');
  const reg = JSON.parse(readFileSync(join(projectDir, 'assets/register.json'), 'utf8')).assets;
  assert.ok(reg.filter((r) => r.usage?.startsWith('Scroll video')).every((r) => r.status === 'cleared'));
  for (const id of Object.keys(CONFIGS)) assert.equal(checkScrollVideo(projectDir, id).findings.filter((f) => ['critical', 'serious'].includes(f.severity)).length, 0, `${id}: ${JSON.stringify(checkScrollVideo(projectDir, id).findings)}`);
});

test('stills: one picture per scene and a contact sheet (T4)', { skip }, async () => {
  const r = await writeStills(projectDir, 'pizza', { pictureTool: 'browser' });
  assert.equal(r.files.length, 4);
  for (const f of r.files) assert.ok(readFileSync(f).length > 1000, f);
  assert.match(readFileSync(join(r.dir, 'index.html'), 'utf8'), /Basil last/);
});

test('build: ten configs, one engine, inside the JavaScript budget (R1, L7)', { skip }, (t) => {
  assert.ok(site.build.ok, site.build.output.slice(-3000));
  const report = siteReport(site.build.dist);
  assert.ok(report.withinBudget, JSON.stringify(report).slice(0, 400));
  const scripts = Object.keys(CONFIGS).map((id) => {
    const html = readFileSync(join(site.build.dist, `sv-${id}`, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`data-scroll-video="${id}"`));
    assert.equal((html.match(/data-sv-scene=/g) ?? []).length, CONFIGS[id].scenes.length, `${id} renders every scene`);
    return [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => m[1]).sort().join(' ');
  });
  assert.equal(new Set(scripts).size, 1, 'every scroll video page loads the same engine file');
  const astro = join(site.build.dist, '_astro');
  const engine = readdirSync(astro).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(astro, f))).filter((b) => b.includes('requestVideoFrameCallback'));
  assert.equal(engine.length, 1);
  const gz = gzipSync(engine[0]).length;
  t.diagnostic(`engine: ${(engine[0].length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzip`);
  assert.ok(gz < 12 * 1024, `${gz} bytes gzip`);
  const svHtml = readFileSync(join(site.build.dist, 'sv-pizza', 'index.html'), 'utf8');
  assert.doesNotMatch(svHtml, /gsap|ScrollTrigger/, 'a ScrollVideo page ships no GSAP');
});

test('no project-specific code in the engine (R3)', () => {
  const root = new URL('../../skills/app02/recipes/', import.meta.url);
  const files = ['sections/ScrollVideo.astro', 'lib/scroll-video.js', 'lib/scroll-video-core.js', 'lib/scroll-video.css'];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(text, /pizza|\bcar\b|outfit|particle|construction|journey|lumen|headphone|restaurant|cafe|\blogo\b/i, f);
    assert.doesNotMatch(text, /durationS\s*:\s*\d|scenes\.length\s*===\s*\d/, `${f} hard-codes a duration or a scene count`);
  }
});

// B1-B5 on three unrelated concepts: forward and back, frame by frame against the time code.
for (const id of ['pizza', 'car', 'particles']) {
  test(`${id}: pinned, frame-accurate both ways, text in sync, scenes in order (B1-B5)`, { skip, timeout: 900_000 }, async (t) => {
    const { context, page, errors } = await open(`/sv-${id}`);
    const before = await waitForEngine(page, id);
    assert.equal(before.mode, 'full', JSON.stringify(before));
    const drive = await driveScrollVideo(page, id, { steps: 20, settleMs: SETTLE });
    const snap = await snapshot(page, id);
    await context.close();
    const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
    const lat = snap.seekLatencies;
    t.diagnostic(`${id}: ${cfgOf(id).video.width}x${cfgOf(id).video.height} ${snap.fps} fps, keyframes every ${cfgOf(id).video.keyframeIntervalS} s; settle p50/p95 forward ${ms(v.settle.forward.p50)}/${ms(v.settle.forward.p95)}, reverse ${ms(v.settle.reverse.p50)}/${ms(v.settle.reverse.p95)}; ${snap.seeks} seeks, last ${lat.length} p50 ${ms(median(lat))} max ${ms(Math.max(...lat))}`);
    assert.deepEqual(v.unpinned, [], 'pinned');
    assert.deepEqual(v.unsettled, [], 'every step settled');
    assert.deepEqual(v.frameOff, [], 'the frame on screen is the frame for the scroll position');
    assert.deepEqual(v.syncOff, [], 'the scene text matches the frame on screen');
    assert.ok(v.order.forwardOk && v.order.reverseOk, JSON.stringify(v.order));
    assert.deepEqual(new Set(v.order.forward), new Set(snap.scenes.map((s) => s.id)), `every scene appeared: ${JSON.stringify(drive.forward.map((s) => [s.progress.toFixed(3), s.frame, s.scene, s.settled]))}`);
    assert.ok(v.moved);
    assert.deepEqual(errors, []);
  });
}

test('pizza-alt: the same video with six different markers, by config alone (R4, R5)', { skip, timeout: 120_000 }, async () => {
  const { context, page } = await open('/sv-pizza-alt');
  const drive = await driveScrollVideo(page, 'pizza-alt', { steps: 18, settleMs: SETTLE });
  const snap = await snapshot(page, 'pizza-alt');
  await context.close();
  const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
  assert.deepEqual(v.order.forward, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(v.syncOff, []);
  assert.deepEqual(v.frameOff, []);
  // At the same frame the two configs show different scenes, because only the markers differ.
  const at = drive.forward.find((s) => s.frame > 2.0 && s.frame < 2.5);
  assert.equal(at.scene, 'c');
  assert.equal(snap.source, cfgOf('pizza').video.sources[0].src, 'the same file as pizza');
});

for (const id of ['outfit', 'building', 'product', 'journey']) {
  test(`${id}: the ${CONFIGS[id].layout.type} layout on a ${CONCEPTS[CONFIGS[id].video].width}x${CONCEPTS[CONFIGS[id].video].height} clip, forward and back (R2, B8)`, { skip, timeout: 180_000 }, async () => {
    const { context, page, errors } = await open(`/sv-${id}`);
    const drive = await driveScrollVideo(page, id, { steps: 12, settleMs: SETTLE });
    const snap = await snapshot(page, id);
    const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
    assert.deepEqual([v.unpinned, v.frameOff, v.syncOff], [[], [], []], JSON.stringify(v).slice(0, 600));
    assert.ok(v.order.forwardOk && v.order.reverseOk);
    const box = await page.evaluate((id) => {
      const el = document.querySelector(`[data-scroll-video="${id}"]`);
      const m = el.querySelector('[data-sv-media]').getBoundingClientRect();
      const s = el.querySelector('[data-sv-stage]').getBoundingClientRect();
      const video = el.querySelector('video');
      const fg = el.querySelector('.sv__foreground');
      const callout = el.querySelector('[data-sv-point][data-active]');
      return { media: [m.width, m.height], stage: [s.width, s.height], fit: getComputedStyle(video).objectFit, layout: el.dataset.layout, foreground: fg ? getComputedStyle(fg).visibility === 'visible' && fg.getBoundingClientRect().height > 0 : null, callout: callout ? { left: parseFloat(callout.style.left), top: parseFloat(callout.style.top), opacity: getComputedStyle(callout).opacity } : null };
    }, id);
    await context.close();
    assert.equal(box.layout, CONFIGS[id].layout.type);
    if (id === 'product') {
      assert.equal(box.fit, 'contain');
      assert.ok(box.callout && box.callout.left > 0 && box.callout.left < box.media[0] && box.callout.top > 0 && box.callout.top < box.media[1], JSON.stringify(box));
    } else assert.equal(box.fit, 'cover');
    if (id === 'building') assert.equal(box.foreground, true);
    if (id === 'journey' || id === 'building') assert.deepEqual(box.media, box.stage, 'full-bleed media fills the stage');
    assert.deepEqual(errors, []);
  });
}

test('car-auto: slow seeks on a one-keyframe clip switch to frames, exact both ways (L9)', { skip, timeout: 180_000 }, async (t) => {
  const { context, page } = await open('/sv-car-auto');
  await waitForEngine(page, 'car-auto');
  // The 1 ms budget makes the switch certain, so this tests the switch itself; what long keyframe
  // gaps really cost is measured by the car test.
  // Scrub until the engine has measured enough seeks to judge.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-scroll-video="car-auto"]');
      const r = el.querySelector('[data-sv-track]').getBoundingClientRect();
      scrollTo(0, scrollY + r.top + Math.random() * (r.height - innerHeight));
      return el.scrollVideo.snapshot().render === 'frames';
    },
    null,
    { timeout: 60_000, polling: 250 },
  );
  await page
    .waitForFunction(() => {
      const s = document.querySelector('[data-scroll-video="car-auto"]').scrollVideo.snapshot();
      return s.frames.loaded + s.frames.lost === s.frames.count;
    }, null, { timeout: 60_000 })
    .catch(async (err) => assert.fail(`frames did not finish loading: ${JSON.stringify(await snapshot(page, 'car-auto'))}
${err.message}`));
  const before = await snapshot(page, 'car-auto');
  t.diagnostic(`switched to frames after ${before.seeks} seeks; seek p50 ${ms(median(before.seekLatencies))}, budget 1 ms`);
  assert.equal(before.renderReason, 'slow-seek');
  assert.equal(before.frames.lost, 0, 'every frame loaded');
  const drive = await driveScrollVideo(page, 'car-auto', { steps: 16, settleMs: SETTLE });
  const snap = await snapshot(page, 'car-auto');
  await context.close();
  const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
  assert.equal(drive.render, 'frames');
  assert.deepEqual(v.frameOff, [], 'the drawn frame is the one for the scroll position');
  assert.deepEqual(v.syncOff, []);
  t.diagnostic(`frames: settle p95 forward ${ms(v.settle.forward.p95)}, reverse ${ms(v.settle.reverse.p95)}`);
});

test('phone: touch scrolling drives the video, the phone cut is chosen, the stage fills the screen (B7)', { skip, timeout: 120_000 }, async () => {
  const { context, page } = await open('/sv-journey', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const start = await waitForEngine(page, 'journey');
  assert.equal(start.mode, 'full');
  assert.equal(start.source, cfgOf('journey').video.sources.find((s) => s.media).src, 'the media-matched source');
  const top = await page.evaluate(() => {
    const r = document.querySelector('[data-scroll-video="journey"] [data-sv-track]').getBoundingClientRect();
    return r.top + scrollY;
  });
  await page.evaluate((y) => scrollTo(0, y + 10), top);
  const cdp = await context.newCDPSession(page);
  const s0 = await snapshot(page, 'journey');
  // Real touch drags through Chromium's input pipeline (finger moves up, page scrolls down).
  for (let drag = 0; drag < 4; drag++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 700 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 700 - i * 50 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.waitForFunction(
    (before) => {
      const s = document.querySelector('[data-scroll-video="journey"]').scrollVideo.snapshot();
      return s.progress > before.progress + 0.1 && s.shown > before.shown && s.scene !== before.scene && !s.seeking;
    },
    s0,
    { timeout: SETTLE },
  ).catch(() => {});
  const s1 = await snapshot(page, 'journey');
  const stage = await page.evaluate(() => {
    const r = document.querySelector('[data-scroll-video="journey"] [data-sv-stage]').getBoundingClientRect();
    return { top: r.top, height: r.height, vh: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  await context.close();
  assert.ok(s1.progress > s0.progress + 0.1, `touch moved the track (${s0.progress} -> ${s1.progress})`);
  assert.ok(s1.shown > s0.shown, 'and the video');
  assert.notEqual(s1.scene, s0.scene);
  assert.ok(Math.abs(stage.top) <= 1 && Math.abs(stage.height - stage.vh) <= 1, JSON.stringify(stage));
  assert.equal(stage.overflow, 0, 'no sideways scroll');
});

test('split: video and text side by side on a desktop, stacked on a phone, for either side (B8)', { skip, timeout: 60_000 }, async () => {
  const boxes = {};
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
    const { context, page } = await open('/sv-particles', { viewport, isMobile: name === 'phone', hasTouch: name === 'phone' });
    await waitForEngine(page, 'particles');
    await page.evaluate(() => {
      const r = document.querySelector('[data-scroll-video="particles"] [data-sv-track]').getBoundingClientRect();
      scrollTo(0, scrollY + r.top + (r.height - innerHeight) * 0.5);
    });
    await page.waitForTimeout(400);
    boxes[name] = await page.evaluate(() => {
      const el = document.querySelector('[data-scroll-video="particles"]');
      const m = el.querySelector('[data-sv-media]').getBoundingClientRect();
      const t = el.querySelector('[data-sv-scene][data-active]').getBoundingClientRect();
      return { media: { left: m.left, top: m.top, width: m.width, height: m.height }, text: { left: t.left, top: t.top }, vw: innerWidth, vh: innerHeight };
    });
    await context.close();
  }
  const d = boxes.desktop;
  assert.ok(Math.abs(d.media.left - d.vw / 2) <= 1 && Math.abs(d.media.width - d.vw / 2) <= 1, `side "end" puts the video on the right half: ${JSON.stringify(d)}`);
  assert.ok(d.text.left < d.vw / 2, 'text on the left half');
  const p = boxes.phone;
  assert.ok(p.media.left === 0 && Math.abs(p.media.width - p.vw) <= 1 && p.media.top === 0, `the video spans the top of the phone: ${JSON.stringify(p)}`);
  assert.ok(p.text.top >= p.media.top + p.media.height - 1, 'the text sits below the video');
});

test('resize: desktop to phone and back keeps the position and swaps the cut (B6)', { skip, timeout: 120_000 }, async () => {
  const { context, page } = await open('/sv-journey');
  await waitForEngine(page, 'journey');
  const at = await page.evaluate(() => {
    const r = document.querySelector('[data-scroll-video="journey"] [data-sv-track]').getBoundingClientRect();
    return scrollY + r.top + (r.height - innerHeight) * 0.5;
  });
  await page.evaluate((y) => scrollTo(0, y), at);
  await page.waitForTimeout(600);
  const a = await snapshot(page, 'journey');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('[data-scroll-video="journey"]').scrollVideo.snapshot().source.includes('journey-2'), null, { timeout: 10_000 });
  // The track got shorter (lengthMobile); put the reader back where they were, by progress.
  await page.evaluate((p) => {
    const r = document.querySelector('[data-scroll-video="journey"] [data-sv-track]').getBoundingClientRect();
    scrollTo(0, scrollY + r.top + (r.height - innerHeight) * p);
  }, a.progress);
  await waitForEngine(page, 'journey');
  await page.waitForTimeout(800);
  const b = await snapshot(page, 'journey');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  const c = await snapshot(page, 'journey');
  await context.close();
  assert.ok(Math.abs(b.progress - a.progress) < 0.02, `${a.progress} -> ${b.progress}`);
  assert.equal(b.scene, a.scene);
  assert.ok(!c.source.includes('journey-2'), 'back to the desktop cut');
});

test('chapters jump to a scene, and a focused CTA brings its scene in (B9, B10)', { skip, timeout: 60_000 }, async () => {
  const { context, page } = await open('/sv-car');
  await waitForEngine(page, 'car');
  await page.evaluate(() => document.querySelector('[data-scroll-video="car"]').scrollIntoView());
  await page.click('[data-scroll-video="car"] [data-sv-chapter="3"]');
  await page.waitForFunction(() => document.querySelector('[data-scroll-video="car"]').scrollVideo.snapshot().scene === 'wheels', null, { timeout: 10_000 });
  await page.focus('[data-scroll-video="car"] [data-sv-scene="lamps"] a');
  await page.waitForFunction(() => document.querySelector('[data-scroll-video="car"]').scrollVideo.snapshot().scene === 'lamps', null, { timeout: 10_000 });
  // The focused link is in view and fully shown within a second (the engine skips smoothing on focus).
  const cta = await page
    .waitForFunction(() => {
      const a = document.querySelector('[data-scroll-video="car"] [data-sv-scene="lamps"] a');
      const r = a.getBoundingClientRect();
      const opacity = Number(getComputedStyle(a.closest('[data-sv-scene]')).opacity);
      return r.top >= 0 && r.bottom <= innerHeight && opacity > 0.9 && { opacity };
    }, null, { timeout: 1000 })
    .then((h) => h.jsonValue(), (err) => ({ failed: err.message.split('\n')[0] }));
  await context.close();
  assert.ok(!cta.failed, JSON.stringify(cta));
});

test('poster first and no layout shift from choosing the mode (L1)', { skip, timeout: 60_000 }, async (t) => {
  const { context, page } = await open('/sv-pizza');
  await page.evaluate(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await waitForEngine(page, 'pizza');
  await driveScrollVideo(page, 'pizza', { steps: 6, settleMs: SETTLE });
  const cls = await page.evaluate(() => window.__cls);
  await context.close();
  t.diagnostic(`CLS ${cls.toFixed(3)}`);
  assert.ok(cls <= app02.budget.cls, `CLS ${cls}`);
});

const FALLBACKS = [
  { reason: 'reduced-motion', options: { reducedMotion: 'reduce' } },
  { reason: 'slow-network', options: { init: () => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '3g', saveData: false }) }); } } },
  { reason: 'slow-network', label: 'save-data', options: { init: () => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '4g', saveData: true }) }); } } },
  { reason: 'low-end-device', options: { init: () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }) } },
  { reason: 'load-failed', options: { block: (url) => /\.webm$/.test(url.pathname) } },
];
for (const { reason, label, options } of FALLBACKS) {
  test(`fallback: ${label ?? reason} gives the poster and every scene, readable (L2-L4)`, { skip, timeout: 60_000 }, async () => {
    const { context, page, errors, requests } = await open('/sv-pizza', options);
    const s = await waitForEngine(page, 'pizza', 30_000);
    const scenes = [];
    for (const el of await page.$$('[data-scroll-video="pizza"] [data-sv-scene]')) {
      await el.scrollIntoViewIfNeeded();
      scenes.push(await el.evaluate((e) => ({ top: e.getBoundingClientRect().top + scrollY, h: e.offsetHeight, opacity: getComputedStyle(e).opacity, visibility: getComputedStyle(e).visibility })));
    }
    const poster = await page.$eval('[data-scroll-video="pizza"] [data-sv-poster]', (i) => ({ complete: i.complete, w: i.naturalWidth }));
    await context.close();
    assert.deepEqual([s.mode, s.reason], ['fallback', reason]);
    for (let i = 1; i < scenes.length; i++) assert.ok(scenes[i].top >= scenes[i - 1].top + scenes[i - 1].h, 'stacked');
    assert.ok(scenes.every((x) => x.opacity === '1' && x.visibility === 'visible'), JSON.stringify(scenes));
    assert.ok(poster.complete && poster.w > 0, 'the poster shows');
    if (reason !== 'load-failed') {
      assert.equal(requests.filter((u) => /\.webm/.test(u)).length, 0, 'no video was downloaded');
      assert.deepEqual(errors, []);
    }
  });
}

test('without JavaScript every scene is visible (L6)', { skip }, async () => {
  const { context, page } = await open('/sv-particles', { javaScriptEnabled: false });
  const opacity = await page.$$eval('[data-sv-scene]', (els) => els.map((e) => getComputedStyle(e).opacity));
  await context.close();
  assert.equal(opacity.length, 12);
  assert.ok(opacity.every((o) => o === '1'));
});

test('a slow connection: poster and progress while the clip loads, then it scrubs (L5)', { skip, timeout: 180_000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(CAPABLE);
  await context.addInitScript(READ_FRAME);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 250_000, uploadThroughput: 100_000 });
  const t0 = Date.now();
  await page.goto(server.url + '/sv-heavy', { waitUntil: 'load' });
  const states = [];
  let ready = null;
  while (Date.now() - t0 < 60_000) {
    const s = await page.evaluate(() => {
      const el = document.querySelector('[data-scroll-video="heavy"]');
      return { state: el.dataset.svState, load: Number(getComputedStyle(el).getPropertyValue('--sv-load') || 0) };
    });
    states.push(s);
    if (s.state === 'ready') {
      ready = Date.now() - t0;
      break;
    }
    await page.waitForTimeout(250);
  }
  const bytes = cfgOf('heavy').video.bytes;
  t.diagnostic(`${(bytes / 1048576).toFixed(2)} MB at 2 Mbit/s: ready after ${ms(ready)}; progress samples ${states.filter((s) => s.load > 0 && s.load < 1).length}`);
  assert.ok(ready, 'it became ready');
  assert.ok(states.some((s) => s.state === 'loading'), 'it showed the loading state first');
  assert.ok(states.some((s) => s.load > 0 && s.load < 1), 'the load progress moved');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const drive = await driveScrollVideo(page, 'heavy', { steps: 6, settleMs: SETTLE });
  const snap = await snapshot(page, 'heavy');
  await context.close();
  const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
  assert.deepEqual([v.frameOff, v.syncOff], [[], []]);
});

for (const gate of ['routes', 'accessibility', 'responsive']) {
  test(`the scroll video site passes the ${gate} gate`, { skip, timeout: 600_000 }, async () => {
    const r = await runGate(gate, site.siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2).slice(0, 3000));
  });
}

test('the interactions gate drives every scroll video and passes (T5)', { skip, timeout: 900_000 }, async (t) => {
  const r = await runGate('interactions', site.siteDir, { browser });
  t.diagnostic(JSON.stringify(r.metrics));
  assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2).slice(0, 3000));
  assert.equal(r.metrics.scrollVideos, Object.keys(CONFIGS).length);
});

test('the interactions drive fails a scroll video whose file is missing (T5)', { skip, timeout: 120_000 }, async () => {
  rmSync(join(site.build.dist, 'video', 'outfit.webm'));
  const findings = [];
  const metrics = {};
  await checkScrollVideos(browser, server.url, '/sv-outfit', (id, severity, message) => findings.push({ id, severity, message }), metrics);
  assert.deepEqual(findings.map((f) => [f.id, f.severity]), [['scroll-video-failed', 'serious']], JSON.stringify(findings));
});

function median(v) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

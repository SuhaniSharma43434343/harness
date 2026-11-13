import { median, percentile, sceneIndexAt } from '../../skills/app02/recipes/lib/scroll-video-core.js';

// Drives a placed scroll video the way a visitor does - scroll down through its track and back
// up - and records, at every step, where the picture settled and which scene was showing. Used
// by the interactions gate (findings) and by the build tests (measurements). It reads the
// engine's snapshot() and, when the page defines window.__readFrame(section), the time (seconds)
// of the frame actually on screen (the tests stamp a time code into every frame).

// A mid-range desktop: the full experience runs (capability.js), with motion allowed.
export const CAPABLE = () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

export const listScrollVideos = (page) => page.$$eval('[data-scroll-video]', (els) => els.map((e) => e.dataset.scrollVideo));

// Waits until the engine has its first frame or has fallen back.
export async function waitForEngine(page, id, timeout = 45_000) {
  await page.waitForFunction(
    (id) => {
      const s = document.querySelector(`[data-scroll-video="${id}"]`)?.scrollVideo?.snapshot();
      return s && (s.mode === 'fallback' || s.state === 'ready' || s.state === 'buffering');
    },
    id,
    { timeout, polling: 50 },
  );
  return snapshot(page, id);
}

export const snapshot = (page, id) => page.evaluate((id) => document.querySelector(`[data-scroll-video="${id}"]`).scrollVideo.snapshot(), id);

// Runs in the page: scroll to y and wait for the picture to settle there.
async function stepTo({ id, y, settleMs }) {
  const el = document.querySelector(`[data-scroll-video="${id}"]`);
  const engine = el.scrollVideo;
  const stage = el.querySelector('[data-sv-stage]');
  const t0 = performance.now();
  scrollTo(0, y);
  return new Promise((resolve) => {
    const check = () => {
      const s = engine.snapshot();
      const tol = s.render === 'frames' ? 0.5 / s.fps + 1e-3 : 1 / s.fps + 1e-3;
      // Settled: the smoothing has reached the target's frame and that frame is on screen.
      const sameFrame = s.render === 'frames' ? Math.round(s.time * s.fps) === Math.round(s.target * s.fps) : Math.floor(s.time * s.fps + 1e-6) === Math.floor(s.target * s.fps + 1e-6);
      const settled = !s.seeking && sameFrame && Math.abs(s.shown - s.target) <= tol && s.scene === s.shownScene;
      const waited = performance.now() - t0;
      if (settled || waited > settleMs) {
        resolve({
          y,
          progress: s.progress,
          target: s.target,
          shown: s.shown,
          scene: s.scene,
          state: s.state,
          render: s.render,
          settled,
          settleMs: Math.round(waited),
          stageTop: stage.getBoundingClientRect().top,
          stageHeight: stage.getBoundingClientRect().height,
          viewport: innerHeight,
          frame: typeof window.__readFrame === 'function' ? window.__readFrame(el) : null,
        });
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

// driveScrollVideo(page, id, { steps, settleMs }) => { mode, reason, render, forward[], reverse[], snapshot }
export async function driveScrollVideo(page, id, { steps = 16, settleMs = 2500 } = {}) {
  const start = await waitForEngine(page, id);
  if (start.mode !== 'full') return { mode: start.mode, reason: start.reason, render: start.render, forward: [], reverse: [], snapshot: start };
  const geo = await page.evaluate((id) => {
    const el = document.querySelector(`[data-scroll-video="${id}"]`);
    const r = el.querySelector('[data-sv-track]').getBoundingClientRect();
    return { top: r.top + scrollY, height: r.height, vh: el.querySelector('[data-sv-stage]').offsetHeight || innerHeight };
  }, id);
  const run = geo.height - geo.vh;
  // Inside the track, a hair away from its ends, so every sample is pinned.
  const ys = Array.from({ length: steps + 1 }, (_, k) => Math.round(geo.top + Math.min(run - 1, Math.max(1, (run * k) / steps))));
  const forward = [];
  for (const y of ys) forward.push(await page.evaluate(stepTo, { id, y, settleMs }));
  const reverse = [];
  for (const y of [...ys].reverse().slice(1)) reverse.push(await page.evaluate(stepTo, { id, y, settleMs }));
  return { mode: 'full', reason: null, render: (await snapshot(page, id)).render, forward, reverse, geo, snapshot: await snapshot(page, id) };
}

// evaluateDrive(drive, { scenes, duration, fps, frameFps }) => a verdict per behaviour.
//   pinned: the stage top stays at the viewport top at every step.
//   seek: after settling, the picture is within one frame of the target.
//   frame: (with a time code) the frame on screen is within one frame of the target; false from
//          __readFrame means the code could not be read, which counts as wrong.
//   sync: the scene showing is the one whose [start, end) holds the picture's time.
//   order: scenes appear in config order going down, and in reverse going up.
export function evaluateDrive(drive, { scenes, duration, fps }) {
  const all = [...drive.forward, ...drive.reverse];
  const frameS = 1 / fps;
  const out = { steps: all.length, unpinned: [], unsettled: [], seekOff: [], frameOff: [], syncOff: [], order: {}, settle: {}, moved: false };
  for (const s of all) {
    if (Math.abs(s.stageTop) > 1 || Math.abs(s.stageHeight - s.viewport) > 1) out.unpinned.push(s.y);
    if (!s.settled) out.unsettled.push(s.y);
    if (Math.abs(s.shown - s.target) > frameS + 1e-3) out.seekOff.push({ y: s.y, target: s.target, shown: s.shown });
    const decoded = typeof s.frame === 'number';
    if (decoded && Math.abs(s.frame - s.target) > frameS + 1e-3) out.frameOff.push({ y: s.y, target: s.target, frameTime: s.frame });
    if (s.frame === false) out.frameOff.push({ y: s.y, target: s.target, frameTime: null });
    const t = decoded ? s.frame : s.shown;
    const expected = scenes[sceneIndexAt(t, scenes, duration)]?.id ?? null;
    if (expected !== s.scene) out.syncOff.push({ y: s.y, t, expected, got: s.scene });
  }
  const seq = (list) => list.map((s) => s.scene).filter((id, i, a) => id && id !== a[i - 1]);
  out.order.forward = seq(drive.forward);
  out.order.reverse = seq(drive.reverse);
  const ids = scenes.map((s) => s.id);
  const inOrder = (got, want) => got.every((id, i) => i === 0 || want.indexOf(id) > want.indexOf(got[i - 1]));
  out.order.forwardOk = inOrder(out.order.forward, ids);
  out.order.reverseOk = inOrder(out.order.reverse, [...ids].reverse());
  const settle = (list) => ({ p50: median(list.map((s) => s.settleMs)), p95: percentile(list.map((s) => s.settleMs), 0.95) });
  out.settle.forward = settle(drive.forward);
  out.settle.reverse = settle(drive.reverse);
  out.moved = new Set(drive.forward.map((s) => s.shown.toFixed(2))).size > 1;
  return out;
}

// checkScrollVideos(context, base, route, add, metrics) — the interactions gate's drive: every
// scroll video on the route, scrolled down and back up in a capable, motion-allowed context.
export async function checkScrollVideos(browser, base, route, add, metrics, { at } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  await context.addInitScript(CAPABLE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  try {
    await page.goto(base + route, { waitUntil: 'load' });
    for (const id of await listScrollVideos(page)) {
      metrics.scrollVideos = (metrics.scrollVideos ?? 0) + 1;
      let drive;
      try {
        drive = await driveScrollVideo(page, id, { steps: 10, settleMs: 3000 });
      } catch (err) {
        add('scroll-video-stuck', 'serious', `${route}: the scroll video "${id}" never showed a frame or its fallback: ${String(err.message).split('\n')[0].slice(0, 120)}`, at);
        continue;
      }
      if (drive.mode !== 'full') {
        const broken = ['load-failed', 'no-source'].includes(drive.reason);
        add(broken ? 'scroll-video-failed' : 'scroll-video-fallback', broken ? 'serious' : 'minor', `${route}: the scroll video "${id}" showed its static fallback (${drive.reason}) on a capable desktop`, at);
        continue;
      }
      const snap = drive.snapshot;
      const v = evaluateDrive(drive, { scenes: snap.scenes, duration: snap.duration, fps: snap.fps });
      metrics.scrollVideoSettleP95Ms = Math.max(metrics.scrollVideoSettleP95Ms ?? 0, v.settle.forward.p95, v.settle.reverse.p95);
      if (!v.moved) add('scroll-video-static', 'serious', `${route}: scrolling through "${id}" never moved the video`, at);
      if (v.unpinned.length) add('scroll-video-not-pinned', 'serious', `${route}: the stage of "${id}" is not pinned at ${v.unpinned.length} of ${v.steps} scroll positions`, at);
      if (v.seekOff.length > Math.ceil(v.steps * 0.1)) add('scroll-video-seek', 'serious', `${route}: "${id}" settled more than a frame away from the scroll position at ${v.seekOff.length} of ${v.steps} steps`, at);
      if (v.syncOff.length) add('scroll-video-text-sync', 'serious', `${route}: in "${id}" the scene text did not match the picture at ${v.syncOff.length} of ${v.steps} steps (first: expected ${v.syncOff[0].expected}, showed ${v.syncOff[0].got})`, at);
      if (!v.order.forwardOk || !v.order.reverseOk) add('scroll-video-order', 'serious', `${route}: "${id}" scenes came out of order (down: ${v.order.forward.join(' > ')}; up: ${v.order.reverse.join(' > ')})`, at);
    }
    for (const e of errors.slice(0, 2)) add('scroll-video-error', 'serious', `${route}: a script error while scrolling a scroll video: ${e}`, at);
  } finally {
    await context.close();
  }
}

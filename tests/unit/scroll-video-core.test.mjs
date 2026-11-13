// The scroll video engine's pure maths (skills/app02/recipes/lib/scroll-video-core.js): the same
// module the browser runs. Scroll to time, scenes, smoothing, sources, fitting, frames, config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../skills/app02/recipes/lib/scroll-video-core.js';

const scenes = (n, duration) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, start: (i * duration) / n, end: ((i + 1) * duration) / n, title: `Scene ${i + 1}` }));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('without scroll slices, time is proportional to progress, both ways', () => {
  const tl = core.buildTimeline(scenes(4, 8), 8);
  assert.deepEqual(tl, [{ p: 0, t: 0 }, { p: 1, t: 8 }]);
  for (const p of [0, 0.1, 0.5, 0.99, 1]) {
    close(core.timeAt(p, tl), p * 8);
    close(core.progressAt(core.timeAt(p, tl), tl), p);
  }
  assert.equal(core.timeAt(-1, tl), 0);
  assert.equal(core.timeAt(2, tl), 8);
});

test('scroll slices give each scene its own share of the track, gaps interpolate, the map is monotonic', () => {
  const s = [
    { id: 'a', start: 0, end: 2, scroll: { from: 0, to: 0.1 } },
    { id: 'b', start: 2, end: 4, scroll: { from: 0.1, to: 0.8 } }, // a key moment held longer
    { id: 'c', start: 5, end: 6, scroll: { from: 0.9, to: 1 } }, // a gap from 4 to 5 s
  ];
  const tl = core.buildTimeline(s, 6);
  assert.ok(core.isMonotonic(tl));
  close(core.timeAt(0.1, tl), 2);
  close(core.timeAt(0.45, tl), 3);
  close(core.timeAt(0.85, tl), 4.5);
  close(core.progressAt(3, tl), 0.45);
  assert.equal(core.isMonotonic([{ p: 0, t: 0 }, { p: 0.5, t: 3 }, { p: 1, t: 2 }]), false);
});

test('sceneIndexAt: [start, end), gaps are -1, the clip end belongs to the last scene', () => {
  const s = [{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 4, end: 6 }];
  assert.equal(core.sceneIndexAt(0, s, 6), 0);
  assert.equal(core.sceneIndexAt(1.999, s, 6), 0);
  assert.equal(core.sceneIndexAt(2, s, 6), 1);
  assert.equal(core.sceneIndexAt(3.5, s, 6), -1);
  assert.equal(core.sceneIndexAt(6, s, 6), 2);
  assert.equal(core.sceneIndexAt(6, [{ start: 0, end: 5 }], 6), -1, 'a last scene that stops early does not own the end');
});

test('sceneFactor: text animates in and out with scroll, the first is in at the top and the last stays at the bottom', () => {
  const s = { start: 2, end: 4 };
  assert.deepEqual(core.sceneFactor(1, s), { p: 0, v: 0 });
  close(core.sceneFactor(2.18, s, { enter: 0.18 }).v, 0.5);
  assert.equal(core.sceneFactor(3, s).v, 1);
  close(core.sceneFactor(3.82, s, { exit: 0.18 }).v, 0.5);
  assert.equal(core.sceneFactor(2, s, { first: true }).v, 1);
  assert.equal(core.sceneFactor(4, s, { last: true }).v, 1);
  assert.equal(core.sceneFactor(4.5, s, { last: true }).v, 1);
  assert.equal(core.sceneFactor(5, s).v, 0);
});

test('smooth follows the target independent of frame rate; 0 is a hard scrub', () => {
  assert.equal(core.smooth(0, 5, 16, 0), 5);
  // Two 8 ms frames land where one 16 ms frame does.
  close(core.smooth(core.smooth(0, 1, 8, 120), 1, 8, 120), core.smooth(0, 1, 16, 120), 1e-12);
  let v = 0;
  for (let i = 0; i < 200; i++) v = core.smooth(v, 3, 16, 120);
  assert.equal(v, 3, 'snaps to the target');
});

test('pickSource: the first source whose media matches and whose type plays', () => {
  const sources = [
    { src: '/p.webm', type: 'video/webm', media: '(max-width: 47.99em)' },
    { src: '/w.webm', type: 'video/webm', codecs: 'vp09.00.10.08' },
    { src: '/w.mp4', type: 'video/mp4' },
  ];
  const phone = { matches: () => true, canPlay: () => 'maybe' };
  const desktop = { matches: () => false, canPlay: () => 'maybe' };
  const safariOld = { matches: () => false, canPlay: (t) => (t.startsWith('video/mp4') ? 'probably' : '') };
  assert.equal(core.pickSource(sources, phone).src, '/p.webm');
  assert.equal(core.pickSource(sources, desktop).src, '/w.webm');
  assert.equal(core.pickSource(sources, safariOld).src, '/w.mp4');
  let asked;
  core.pickSource(sources, { matches: () => false, canPlay: (t) => ((asked = t), '') });
  assert.equal(core.pickSource(sources, { canPlay: () => '' }), null);
  assert.equal(asked, 'video/mp4');
});

test('fitRect: cover fills and crops at the focus point, contain letterboxes; callouts follow it', () => {
  // A 16:9 clip on a 390x844 phone.
  const cover = core.fitRect(1920, 1080, 390, 844, 'cover', [0.3, 0.5]);
  close(cover.h, 844);
  assert.ok(cover.w > 390);
  close(cover.x, (390 - cover.w) * 0.3);
  const contain = core.fitRect(1920, 1080, 390, 844, 'contain');
  close(contain.w, 390);
  close(contain.y, (844 - contain.h) / 2);
  assert.deepEqual(core.parseFocus('30% 60%'), [0.3, 0.6]);
  assert.deepEqual(core.parseFocus('bad'), [0.5, 0.5]);
});

test('trackProgress: 0 before the track, 1 after, linear while pinned', () => {
  assert.equal(core.trackProgress(100, 4000, 800), 0);
  assert.equal(core.trackProgress(-1600, 4000, 800), 0.5);
  assert.equal(core.trackProgress(-5000, 4000, 800), 1);
  assert.equal(core.trackProgress(-1, 800, 800), 1, 'a track no taller than the screen is done once passed');
});

test('frames: floor for video frames, mid-frame seeks, coarse-to-fine loading covers every frame', () => {
  assert.equal(core.frameAt(1, 24), 24);
  assert.equal(core.frameAt(1 - 1e-9, 24), 24, 'float noise at a boundary stays in the frame');
  assert.equal(core.frameAt(0.0416, 24), 0);
  close(core.frameMid(24, 24, 10), 24.5 / 24);
  close(core.frameMid(239, 24, 10), 239.5 / 24);
  assert.equal(core.frameMid(240, 24, 10), 10 - 0.001, 'never past the end');
  const order = core.coarseToFine(97);
  assert.equal(order.length, 97);
  assert.deepEqual([...order].sort((a, b) => a - b), [...Array(97).keys()]);
  assert.deepEqual(order.slice(0, 3), [0, 8, 16]);
  assert.equal(core.frameIndexAt(2.04, { fps: 12, count: 97 }), 24);
  assert.equal(core.frameUrl({ pattern: '/v/f-{i}.webp', pad: 4 }, 0), '/v/f-0001.webp');
  assert.equal(core.nearestLoaded(5, [1, 0, 0, 0, 0, 0, 0, 1].map(Boolean)), 7);
  assert.equal(core.nearestLoaded(3, [false, false]), -1);
});

test('aspectRatio names common shapes and gives a ratio for the rest', () => {
  assert.equal(core.aspectRatio(1920, 1080), '16:9');
  assert.equal(core.aspectRatio(1080, 1920), '9:16');
  assert.equal(core.aspectRatio(576, 720), '4:5');
  assert.equal(core.aspectRatio(1280, 544), '2.35:1');
  assert.equal(core.aspectRatio(2560, 1080), '2.37:1');
  assert.equal(core.aspectRatio(0, 10), null);
});

test('resolveConfig fills defaults per layout and overrides only words, by scene id', () => {
  const base = { id: 'x', video: { durationS: 6, width: 1920, height: 1080 }, layout: { type: 'product' }, scenes: scenes(3, 6) };
  const cfg = core.resolveConfig(base);
  assert.equal(cfg.layout.fit, 'contain', 'product defaults to contain');
  assert.equal(cfg.scroll.length, core.defaultLength(3, 6));
  assert.equal(cfg.scroll.lengthMobile, cfg.scroll.length);
  assert.equal(cfg.scenes[0].position, 'bottom-start');
  assert.equal(cfg.scenes[0].label, 'Scene 1');
  const words = core.resolveConfig(base, { scenes: [{ id: 's2', title: 'Locked words', start: 99 }] }, { overrides: true });
  assert.equal(words.scenes[1].title, 'Locked words');
  assert.equal(words.scenes[1].start, 2, 'timing never comes from the page');
  assert.throws(() => core.resolveConfig(base, { scenes: [{ id: 'typo', title: 'x' }] }, { overrides: true }), /does not have/);
  const inline = core.resolveConfig({}, { scenes: scenes(2, 4), layout: { type: 'split' } });
  assert.equal(inline.durationS, 4);
  assert.equal(inline.layout.type, 'split');
  assert.throws(() => core.resolveConfig({ id: 'empty', scenes: [] }), /no scenes/);
});

test('any scene count works: 1, 3, 5, 7 and 12 scenes map every moment to one scene (R5)', () => {
  for (const n of [1, 3, 5, 7, 12]) {
    const s = scenes(n, 10);
    const tl = core.buildTimeline(s, 10);
    const seen = new Set();
    for (let p = 0; p <= 1.0001; p += 0.001) seen.add(core.sceneIndexAt(core.timeAt(p, tl), s, 10));
    assert.deepEqual([...seen].sort((a, b) => a - b), [...Array(n).keys()], `${n} scenes`);
  }
});

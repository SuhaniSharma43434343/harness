// Scroll video configs: the schema, the rules beyond it (checkConfig), storyboard to scenes,
// layout recommendation, prompts, and the seven industry scenarios validating with one engine
// (docs/scroll-video/03-schema.md, 07-qa-acceptance.md T3, R2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../src/core/schemas.mjs';
import { checkConfig, newConfig, recommendLayout, rescaleScenes, scenesFromStoryboard } from '../../src/scroll-video/config.mjs';
import { buildVideoPrompts, placeholders, promptsMarkdown } from '../../src/scroll-video/prompts.mjs';

const video = (over = {}) => ({ sources: [{ src: '/video/x.webm', type: 'video/webm' }, { src: '/video/x.mp4', type: 'video/mp4' }], poster: { src: '/video/x-poster.webp', alt: '' }, durationS: 8, width: 1920, height: 1080, fps: 24, ...over });
const scene = (id, start, end, extra = {}) => ({ id, start, end, title: `The ${id} moment`, ...extra });
const config = (over = {}) => ({ version: 1, id: 'story', video: video(), layout: { type: 'cinematic' }, scroll: { length: 6 }, scenes: [scene('one', 0, 3), scene('two', 3, 5.5), scene('three', 5.5, 8)], ...over });
const ids = (r) => r.findings.map((f) => f.id);

test('a complete config passes, and the schema is registered as scrollVideo', () => {
  const r = checkConfig(config());
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
  assert.equal(check('scrollVideo', config()).valid, true);
});

test('schema: unknown layouts, javascript: links, missing titles and stray fields are refused', () => {
  const bad = (over, re) => {
    const r = checkConfig(config(over));
    assert.equal(r.ok, false);
    assert.match(r.findings.map((f) => f.message).join(' '), re);
  };
  bad({ layout: { type: 'carousel' } }, /layout\/type/);
  bad({ scenes: [scene('one', 0, 8, { cta: { label: 'Go', href: 'javascript:alert(1)' } })] }, /cta\/href/);
  bad({ scenes: [{ id: 'one', start: 0, end: 8 }] }, /title/);
  bad({ scenes: [scene('One Two', 0, 8)] }, /id/);
  bad({ extra: true }, /additional/);
  bad({ scenes: [scene('one', 0, 8, { overlay: { type: 'image', src: '/a.webp' } })] }, /overlay/);
});

test('timing: order, overlap, past the end, repeated ids and empty scenes are critical (T3)', () => {
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 3, 5), scene('b', 0, 3)] }))).includes('scene-order'));
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 0, 4), scene('b', 3, 8)] }))).includes('scene-overlap'));
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 0, 4), scene('b', 4, 9)] }))).includes('scene-past-end'));
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 0, 4), scene('a', 4, 8)] }))).includes('scene-id-repeated'));
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 2, 2), scene('b', 2, 8)] }))).includes('scene-empty'));
  const gaps = checkConfig(config({ scenes: [scene('a', 0, 2), scene('b', 3, 5), scene('c', 6, 8)] }));
  assert.equal(gaps.ok, true, 'gaps between scenes are allowed');
});

test('scroll slices: all or none, in order, never backwards; scenes get enough scroll to read', () => {
  const sliced = (a, b, c) => config({ scenes: [scene('a', 0, 3, { scroll: a }), scene('b', 3, 5.5, { scroll: b }), scene('c', 5.5, 8, { scroll: c })] });
  assert.equal(checkConfig(sliced({ from: 0, to: 0.2 }, { from: 0.2, to: 0.8 }, { from: 0.8, to: 1 })).ok, true);
  assert.ok(ids(checkConfig(sliced({ from: 0, to: 0.5 }, { from: 0.4, to: 0.8 }, { from: 0.8, to: 1 }))).includes('scroll-overlap'));
  assert.ok(ids(checkConfig(sliced({ from: 0, to: 0.5 }, undefined, { from: 0.8, to: 1 }))).includes('scroll-partial'));
  assert.ok(ids(checkConfig(sliced({ from: 0.5, to: 0.5 }, { from: 0.6, to: 0.8 }, { from: 0.8, to: 1 }))).includes('scroll-empty'));
  const fast = checkConfig(config({ scroll: { length: 2 } }));
  assert.ok(ids(fast).includes('scene-too-fast'));
  assert.equal(fast.ok, false);
  assert.ok(ids(checkConfig(config({ scroll: { length: 6, lengthMobile: 2 } }))).includes('scene-too-fast'), 'the shorter phone track counts');
});

test('words, layout fit and the scene count', () => {
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 0, 4, { title: 'TODO: write me' }), scene('b', 4, 8, { description: 'Lorem ipsum dolor' })] }))).filter((i) => i === 'placeholder').length === 2);
  assert.ok(ids(checkConfig(config({ layout: { type: 'background' } }))).includes('layout-foreground'));
  assert.equal(checkConfig(config({ layout: { type: 'background' }, foreground: { heading: 'One message' } })).ok, true);
  assert.ok(ids(checkConfig(config({ scenes: [scene('a', 0, 8, { overlay: { type: 'callout', text: 'Here', point: { x: 0.5, y: 0.5 } } })] }))).includes('callout-crop'));
  const two = checkConfig(config({ scenes: [scene('a', 0, 4), scene('b', 4, 8)] }));
  assert.ok(ids(two).includes('few-scenes'));
  assert.equal(two.ok, true, 'few scenes is advice, not a refusal');
});

test('the video against its file: duration, size, files on disk, frames, formats', () => {
  const probe = { durationS: 9.6, width: 1280, height: 720 };
  const r = checkConfig(config(), { probe, exists: (url) => url !== '/video/x.mp4' });
  assert.deepEqual(ids(r).sort(), ['duration-mismatch', 'file-missing', 'size-mismatch']);
  assert.ok(ids(checkConfig(config({ video: video({ sources: [{ src: '/video/x.webm', type: 'video/webm' }] }) }))).includes('one-format'));
  const frames = video({ frames: { pattern: '/video/x/frame-{i}.webp', count: 40, fps: 12 } });
  assert.ok(ids(checkConfig(config({ video: frames }))).includes('frames-count'));
  assert.ok(ids(checkConfig(config({ video: undefined }))).includes('no-video'));
});

test('newConfig marks what a person must write; storyboard beats become scenes timed to the clip', () => {
  const c = newConfig({ id: 'launch-film', beats: 4, durationS: 10 });
  assert.equal(c.scenes.length, 4);
  assert.equal(checkConfig(c).ok, false, 'TODO text cannot pass');
  assert.ok(placeholders(c.storyboard).length > 0);
  assert.throws(() => newConfig({ id: 'Bad Id' }), /lowercase/);
  assert.throws(() => newConfig({ id: 'x', layout: 'grid' }), /Unknown layout/);
  const sb = { durationS: 10, beats: [{ id: 'a', action: 'x', durationS: 2 }, { id: 'b', action: 'y', durationS: 6 }, { id: 'c', action: 'z', message: 'The end' }] };
  // The real clip is 8 s, not the 10 s the storyboard planned: every beat is scaled.
  const s = scenesFromStoryboard(sb, 8, [{ id: 'b', title: 'Kept words', start: 0, end: 1 }]);
  assert.deepEqual(s.map((x) => [x.id, x.start, x.end]), [['a', 0, 1.6], ['b', 1.6, 6.4], ['c', 6.4, 8]]);
  assert.equal(s[1].title, 'Kept words');
  assert.equal(s[2].title, 'The end');
  assert.deepEqual(rescaleScenes(s, 8, 12).map((x) => [x.start, x.end]), [[0, 2.4], [2.4, 9.6], [9.6, 12]]);
});

test('recommendLayout explains its choice', () => {
  const wide = { width: 1920, height: 1080 };
  assert.equal(recommendLayout({ video: { width: 1080, height: 1920 } }).type, 'split');
  assert.equal(recommendLayout({ video: { width: 1080, height: 1080 } }).type, 'split');
  assert.equal(recommendLayout({ video: wide, scenes: [{ overlay: { type: 'callout' } }] }).type, 'product');
  assert.equal(recommendLayout({ video: wide, brief: { projectType: 'showroom' } }).type, 'product');
  assert.equal(recommendLayout({ video: wide, foreground: { heading: 'x' } }).type, 'background');
  assert.equal(recommendLayout({ video: wide, scenes: Array(7).fill({}) }).type, 'labels');
  assert.equal(recommendLayout({ video: wide, scenes: [{ description: 'x'.repeat(200) }] }).type, 'sticky-text');
  const plain = recommendLayout({ video: wide, scenes: [{}, {}, {}] });
  assert.equal(plain.type, 'cinematic');
  assert.ok(plain.reasons.length > 0);
});

const storyboard = {
  durationS: 12,
  aspectRatio: '16:9',
  subject: 'a hand-built wooden chair',
  setting: 'a sunlit workshop',
  style: { camera: 'a slow dolly around the chair', lighting: 'warm window light', mood: 'calm, crafted', palette: ['#6b4f3a', '#e8dcc8'] },
  beats: [
    { id: 'legs', action: 'Four turned legs stand on the bench', durationS: 3 },
    { id: 'seat', action: 'The woven seat drops onto them', durationS: 3 },
    { id: 'back', action: 'The back slides into its joints', durationS: 3 },
    { id: 'oil', action: 'Oil darkens the grain', durationS: 3 },
  ],
};

test('prompts: one continuous take, timed beats, scrub rules, shots no longer than the generator allows', () => {
  const c = { ...config({ storyboard }), video: undefined };
  const p = buildVideoPrompts(c, { brief: { brand: { tone: ['warm'] } }, maxShotS: 6, now: () => new Date('2026-11-13T00:00:00Z') });
  assert.match(p.master, /single continuous 12-second video shot, aspect ratio 16:9/);
  assert.match(p.master, /From 3 to 6 s: The woven seat drops onto them/);
  assert.match(p.master, /no cuts/);
  assert.match(p.master, /Mood: calm, crafted; warm/);
  assert.match(p.negative, /jump cuts/);
  assert.deepEqual(p.shots.map((s) => [s.from, s.to, s.beats]), [[0, 6, ['legs', 'seat']], [6, 12, ['back', 'oil']]]);
  assert.match(p.shots[1].prompt, /Continue exactly from the previous shot's last frame/);
  assert.equal(p.settings.resolution, '1920x1080');
  assert.ok(p.checklist.length >= 5);
  assert.deepEqual(buildVideoPrompts(c, { maxShotS: 6, now: () => new Date('2026-11-13T00:00:00Z') }).master.length > 0, true);
  assert.equal(check('scrollVideo', { ...c, prompts: p }).valid, true);
  const md = promptsMarkdown({ ...c, prompts: p });
  assert.match(md, /## Master prompt/);
  assert.match(md, /- \[ \] One continuous take/);
  assert.throws(() => buildVideoPrompts(newConfig({ id: 'x' })), /TODO text/);
  assert.equal(buildVideoPrompts({ ...c, storyboard: { ...storyboard, aspectRatio: '9:16' } }).settings.resolution, '1080x1920');
});

// R2: seven unrelated industries, one schema and one rule set, different layouts and counts.
const SCENARIOS = {
  'pizza-assembly': { layout: { type: 'cinematic' }, duration: 6, n: 4, w: 1920, h: 1080 },
  'car-reveal': { layout: { type: 'labels', theme: 'invert' }, duration: 8, n: 7, w: 2560, h: 1080 },
  'outfit-transformation': { layout: { type: 'split', side: 'end' }, duration: 7, n: 5, w: 1080, h: 1350 },
  'building-construction': { layout: { type: 'background' }, foreground: { heading: 'Twelve floors in a year' }, duration: 9, n: 6, w: 1080, h: 1080 },
  'particles-logo': { layout: { type: 'sticky-text' }, duration: 10, n: 12, w: 1080, h: 1920, length: 14 },
  'product-assembly': { layout: { type: 'product' }, duration: 8, n: 4, w: 1920, h: 1080, callouts: true },
  'journey-locations': { layout: { type: 'cinematic', focus: '40% 50%' }, duration: 12, n: 5, w: 1920, h: 1080 },
};
for (const [id, s] of Object.entries(SCENARIOS)) {
  test(`industry scenario ${id}: ${s.n} scenes, ${s.layout.type}, ${s.w}x${s.h}, valid with no engine change (R2)`, () => {
    const scenes = Array.from({ length: s.n }, (_, i) => ({
      id: `scene-${i + 1}`,
      start: Math.round(((i * s.duration) / s.n) * 100) / 100,
      end: i === s.n - 1 ? s.duration : Math.round((((i + 1) * s.duration) / s.n) * 100) / 100,
      title: `Moment ${i + 1} of the ${id.replace('-', ' ')}`,
      ...(s.callouts ? { overlay: { type: 'callout', text: `Part ${i + 1}`, point: { x: 0.3 + i * 0.1, y: 0.5 } } } : {}),
    }));
    const c = { version: 1, id, video: video({ durationS: s.duration, width: s.w, height: s.h }), layout: s.layout, scroll: { length: s.length ?? Math.max(5, s.n * 1.2) }, scenes, ...(s.foreground ? { foreground: s.foreground } : {}) };
    const r = checkConfig(c);
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });
}

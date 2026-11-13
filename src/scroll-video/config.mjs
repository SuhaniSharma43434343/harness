import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from '../core/schemas.mjs';
import { LAYOUTS, buildTimeline, isMonotonic, progressAt, resolveConfig } from '../../skills/app02/recipes/lib/scroll-video-core.js';

// Scroll video configs: design/scroll-video/<id>.json in a project. This module creates them,
// checks them (schema, then the timing, file, word and layout rules the schema cannot express)
// and turns a storyboard into scenes. See docs/scroll-video/03-schema.md.

export const CONFIG_DIR = join('design', 'scroll-video');
export const configPath = (projectDir, id) => join(projectDir, CONFIG_DIR, `${id}.json`);
export const reportPath = (projectDir, id) => join(projectDir, CONFIG_DIR, `${id}.report.json`);
export const isConfigFile = (name) => /^[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(name) && !name.endsWith('.report.json');

export function listConfigs(projectDir) {
  const dir = join(projectDir, CONFIG_DIR);
  return existsSync(dir) ? readdirSync(dir).filter(isConfigFile).map((f) => f.replace(/\.json$/, '')).sort() : [];
}

export function loadConfig(projectDir, id) {
  const file = configPath(projectDir, id);
  if (!existsSync(file)) throw new Error(`No scroll video config ${id}: expected ${CONFIG_DIR}/${id}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function saveConfig(projectDir, config) {
  const file = configPath(projectDir, config.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return file;
}

export const LAYOUT_CATALOG = [
  { type: 'cinematic', composition: 'Full-bleed video; scene text over a wash at its position.', bestFor: 'Brand films, journeys, reveals.' },
  { type: 'sticky-text', composition: 'A framed video pinned beside a caption panel whose text changes with each scene.', bestFor: 'Explaining a process; scenes with more words.' },
  { type: 'split', composition: 'Video on one half edge to edge, the scene text column on the other.', bestFor: 'Portrait or square clips on desktop; editorial pages.' },
  { type: 'product', composition: 'The whole frame on the surface colour, with callouts pinned to points on the video.', bestFor: 'Product assembly, feature tours.' },
  { type: 'background', composition: 'A dimmed video behind content and a call to action that stay; scenes are captions.', bestFor: 'A hero that must keep one message and one button.' },
  { type: 'labels', composition: 'Cinematic, with a chapter rail that shows and jumps to every scene label.', bestFor: 'Many scenes, timelines, stages of construction.' },
];

const PLACEHOLDER = /\b(TODO|TBD|lorem ipsum|lorem|placeholder)\b|\[\.\.\.\]|\{\{/i;
const r2 = (v) => Math.round(v * 100) / 100;

// newConfig({ id, title, beats, layout, durationS, aspectRatio, summary }) => a config whose
// storyboard and scenes are marked TODO, so `check` fails until a person fills them in.
export function newConfig({ id, title, beats = 5, layout = 'cinematic', durationS = 8, aspectRatio = '16:9', summary } = {}) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id ?? '')) throw new Error(`The id "${id}" must be lowercase words joined by hyphens.`);
  if (!LAYOUTS.includes(layout)) throw new Error(`Unknown layout "${layout}". Layouts: ${LAYOUTS.join(', ')}`);
  const n = Math.max(1, Math.min(40, Math.round(beats)));
  const storyboard = {
    durationS,
    aspectRatio,
    subject: 'TODO: what stays in frame for the whole take',
    setting: 'TODO: where it happens',
    style: { camera: 'TODO: one continuous camera move', lighting: 'TODO', mood: 'TODO' },
    beats: Array.from({ length: n }, (_, i) => ({ id: `beat-${i + 1}`, action: `TODO: what visibly happens in beat ${i + 1}`, durationS: r2(durationS / n), message: 'TODO: what this scene says' })),
  };
  const config = { version: 1, id, title: title ?? id, ...(summary ? { concept: { summary } } : {}), storyboard, layout: { type: layout }, scroll: {}, animation: {}, scenes: [] };
  config.scenes = scenesFromStoryboard(storyboard, durationS);
  return config;
}

// scenesFromStoryboard(storyboard, durationS, existing?) => scenes. Each beat becomes a scene;
// beat durations are scaled to the real clip, beats without one share what is left. Words and
// settings of an existing scene with the same id are kept, so re-timing never loses copy.
export function scenesFromStoryboard(storyboard, durationS, existing = []) {
  const beats = storyboard.beats;
  const given = beats.reduce((s, b) => s + (b.durationS ?? 0), 0);
  const unset = beats.filter((b) => !b.durationS).length;
  const target = storyboard.durationS ?? durationS;
  const share = unset ? Math.max(0, target - given) / unset : 0;
  const lengths = beats.map((b) => b.durationS ?? (share || target / beats.length));
  const total = lengths.reduce((a, b) => a + b, 0);
  const k = total > 0 ? durationS / total : 0;
  let t = 0;
  return beats.map((b, i) => {
    const start = r2(t);
    t += lengths[i] * k;
    const end = i === beats.length - 1 ? r2(durationS) : r2(t);
    const prev = existing.find((s) => s.id === b.id);
    return { ...(prev ?? {}), id: b.id, start, end, title: prev?.title ?? (b.message && !PLACEHOLDER.test(b.message) ? b.message : `TODO: title for ${b.id}`) };
  });
}

// rescaleScenes(scenes, from, to) => the same scenes stretched to a new clip length (and their
// scroll slices untouched), for a replaced video of a different duration.
export function rescaleScenes(scenes, from, to) {
  const k = to / from;
  return scenes.map((s) => ({ ...s, start: r2(s.start * k), end: Math.abs(s.end - from) < 0.05 ? r2(to) : r2(s.end * k) }));
}

// recommendLayout({ video, scenes, brief, foreground }) => { type, reasons[] }
export function recommendLayout({ video, scenes = [], brief = {}, foreground } = {}) {
  const reasons = [];
  const portrait = video && video.height > video.width;
  const square = video && Math.abs(video.width - video.height) / Math.max(video.width, video.height) < 0.15;
  const callouts = scenes.some((s) => s.overlay?.type === 'callout');
  const longText = scenes.some((s) => (s.description ?? '').length > 180);
  const type = brief.projectType;
  if (portrait || square) {
    reasons.push(`The clip is ${portrait ? 'upright' : 'square'}, so it fills half a wide screen, not all of it.`);
    return { type: 'split', reasons };
  }
  if (callouts || type === 'showroom' || /product|retail|ecommerce/i.test(brief.client?.industry ?? '')) {
    reasons.push(callouts ? 'Scenes point at parts of the picture, which needs the whole frame visible.' : 'A product story shows the whole object, on the surface colour.');
    return { type: 'product', reasons };
  }
  if (foreground) {
    reasons.push('One message and one button must stay on screen for the whole video.');
    return { type: 'background', reasons };
  }
  if (scenes.length >= 6) {
    reasons.push(`${scenes.length} scenes are easier to follow with every chapter named on screen.`);
    return { type: 'labels', reasons };
  }
  if (longText) {
    reasons.push('Some scenes have long descriptions, which read better beside the video than over it.');
    return { type: 'sticky-text', reasons };
  }
  reasons.push('A wide clip with short scene text works best full-bleed.');
  return { type: 'cinematic', reasons };
}

// checkConfig(config, { probe, exists }) => { ok, findings[{ id, severity, message, field }] }
//   probe: the probed file (probe.mjs), to compare the duration and size.
//   exists(urlPath) => whether a public file exists (the CLI maps /video/x to assets/public/video/x).
export function checkConfig(config, { probe = null, exists = null } = {}) {
  const findings = [];
  const add = (id, severity, message, field) => findings.push({ id, severity, message, ...(field ? { field } : {}) });
  const schema = check('scrollVideo', config);
  if (!schema.valid) {
    for (const e of schema.errors) add('schema', 'critical', `Schema: ${e}`, e.split(' ')[0]);
    return { ok: false, findings };
  }
  const scenes = config.scenes;
  const v = config.video;
  const duration = v?.durationS ?? config.storyboard?.durationS ?? Math.max(...scenes.map((s) => s.end));

  // Ids, order, overlap, the clip's length.
  const ids = new Set();
  scenes.forEach((s, i) => {
    const at = `scenes[${i}]`;
    if (ids.has(s.id)) add('scene-id-repeated', 'critical', `Scene id "${s.id}" is used twice.`, `${at}.id`);
    ids.add(s.id);
    if (!(s.end > s.start)) add('scene-empty', 'critical', `Scene "${s.id}" ends (${s.end} s) before it starts (${s.start} s).`, at);
    if (s.end > duration + 0.05) add('scene-past-end', 'critical', `Scene "${s.id}" ends at ${s.end} s, after the clip ends (${duration} s).`, `${at}.end`);
    const prev = scenes[i - 1];
    if (prev && s.start < prev.start) add('scene-order', 'critical', `Scene "${s.id}" starts before "${prev.id}"; scenes must be in time order.`, `${at}.start`);
    else if (prev && s.start < prev.end - 0.01) add('scene-overlap', 'critical', `Scene "${s.id}" starts at ${s.start} s, before "${prev.id}" ends (${prev.end} s).`, `${at}.start`);
  });
  if (scenes.length < 3) add('few-scenes', 'moderate', `${scenes.length} scene${scenes.length === 1 ? '' : 's'}: a scroll story usually needs at least 3 beats.`, 'scenes');
  if (scenes.length > 16) add('many-scenes', 'moderate', `${scenes.length} scenes make a very long scroll; consider two sections.`, 'scenes');

  // Scroll slices: all or none, in order, inside the track, monotonic.
  const sliced = scenes.filter((s) => s.scroll).length;
  if (sliced && sliced !== scenes.length) add('scroll-partial', 'critical', `${sliced} of ${scenes.length} scenes have a scroll slice; give every scene one, or none.`, 'scenes');
  if (sliced === scenes.length) {
    scenes.forEach((s, i) => {
      if (!(s.scroll.to > s.scroll.from)) add('scroll-empty', 'critical', `Scene "${s.id}" has an empty scroll slice.`, `scenes[${i}].scroll`);
      if (i && s.scroll.from < scenes[i - 1].scroll.to - 1e-6) add('scroll-overlap', 'critical', `Scene "${s.id}" scroll slice starts before the previous one ends.`, `scenes[${i}].scroll`);
    });
    if (!isMonotonic(buildTimeline(scenes, duration))) add('scroll-backwards', 'critical', 'The scroll slices would play the video backwards while scrolling down.', 'scenes');
  }

  // Readability: every scene gets at least 0.6 viewport heights of scroll on the shortest track.
  try {
    const cfg = resolveConfig(config);
    const timeline = buildTimeline(cfg.scenes, duration);
    const shortest = Math.min(cfg.scroll.length, cfg.scroll.lengthMobile);
    for (const s of cfg.scenes) {
      const span = (progressAt(s.end, timeline) - progressAt(s.start, timeline)) * (shortest - 1);
      if (span < 0.6) add('scene-too-fast', 'serious', `Scene "${s.id}" gets ${span.toFixed(2)} viewport heights of scroll; under 0.6 its text flashes by. Lengthen the scroll or the scene.`, 'scroll.length');
    }
  } catch (err) {
    add('config', 'critical', err.message);
  }

  // Words.
  const words = (s, at) => {
    for (const k of ['eyebrow', 'title', 'description', 'label']) if (s[k] && PLACEHOLDER.test(s[k])) add('placeholder', 'serious', `${at}.${k} is placeholder text: "${s[k].slice(0, 60)}"`, `${at}.${k}`);
  };
  scenes.forEach((s, i) => words(s, `scenes[${i}]`));
  if (config.foreground) words(config.foreground, 'foreground');

  // Layout fit.
  const layout = config.layout.type;
  if (layout === 'background' && !config.foreground) add('layout-foreground', 'serious', 'The background layout needs foreground content (a heading and usually a call to action).', 'foreground');
  const callouts = scenes.filter((s) => s.overlay?.type === 'callout');
  if (callouts.length && layout !== 'product' && config.layout.fit !== 'contain') add('callout-crop', 'moderate', 'Callouts point at the frame; with fit "cover" the point can be cropped off a phone screen. Use the product layout or fit "contain".', 'layout');
  scenes.forEach((s, i) => {
    if (s.overlay?.type === 'image' && !s.overlay.alt && s.overlay.alt !== '') add('overlay-alt', 'serious', `Scene "${s.id}" image overlay has no alt text.`, `scenes[${i}].overlay.alt`);
  });

  // The video, against the file.
  if (!v) add('no-video', 'serious', 'No video yet: run forge scroll-video add-video. The section shows the static layout until then.', 'video');
  else {
    if (!v.poster.alt && v.poster.alt !== '') add('poster-alt', 'serious', 'The poster needs alt text (or an explicit empty alt).', 'video.poster.alt');
    const types = new Set(v.sources.map((s) => s.type));
    if (types.size === 1) add('one-format', 'minor', `Only ${[...types][0]}: add ${types.has('video/webm') ? 'an H.264 MP4 for Safari and older iPhones' : 'a VP9 WebM, smaller for Chrome, Edge and Firefox'}.`, 'video.sources');
    if (v.frames && v.durationS) {
      const expected = Math.floor(v.durationS * v.frames.fps) + 1;
      if (Math.abs(v.frames.count - expected) > 2) add('frames-count', 'serious', `The frame sequence has ${v.frames.count} frames; ${v.durationS} s at ${v.frames.fps} fps needs about ${expected}.`, 'video.frames.count');
    }
    if (probe) {
      if (Math.abs(probe.durationS - v.durationS) > 0.1) add('duration-mismatch', 'critical', `The config says the clip is ${v.durationS} s, the file is ${probe.durationS} s. Run add-video again (with --rescale to stretch the scenes).`, 'video.durationS');
      if (probe.width !== v.width || probe.height !== v.height) add('size-mismatch', 'serious', `The config says ${v.width}x${v.height}, the file is ${probe.width}x${probe.height}.`, 'video.width');
    }
    if (exists) {
      for (const [i, s] of v.sources.entries()) if (!exists(s.src)) add('file-missing', 'critical', `${s.src} is not in assets/public.`, `video.sources[${i}].src`);
      if (!exists(v.poster.src)) add('file-missing', 'critical', `The poster ${v.poster.src} is not in assets/public.`, 'video.poster.src');
      if (v.frames) for (const i of [0, v.frames.count - 1]) {
        const url = v.frames.pattern.replace('{i}', String(i + 1).padStart(v.frames.pad ?? 4, '0'));
        if (!exists(url)) add('file-missing', 'critical', `Frame ${url} is not in assets/public.`, 'video.frames');
      }
      scenes.forEach((s, i) => {
        if (s.overlay?.type === 'image' && !exists(s.overlay.src)) add('file-missing', 'critical', `${s.overlay.src} is not in assets/public.`, `scenes[${i}].overlay.src`);
      });
    }
  }
  const ok = !findings.some((f) => f.severity === 'critical' || f.severity === 'serious');
  return { ok, findings };
}


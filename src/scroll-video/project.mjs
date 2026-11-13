import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { assessVideo } from './assess.mjs';
import { checkConfig, configPath, listConfigs, loadConfig, newConfig, reportPath, rescaleScenes, saveConfig, scenesFromStoryboard } from './config.mjs';
import { extractFrames, makePoster, stillsAt } from './frames.mjs';
import { probeFile } from './probe.mjs';
import { buildVideoPrompts, promptsMarkdown } from './prompts.mjs';

// Project-side operations of the scroll video pipeline, behind `forge scroll-video`. Each writes
// only inside the project folder: the config in design/scroll-video/, files in assets/public/
// (copied to site/public/ when the site exists, so a rebuild picks them up), licence rows in
// assets/register.json. None needs a model or the network.

const PUBLIC = join('assets', 'public');
const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback);

// The file behind a public URL path (/video/x.webm), in the project's assets or the built site.
export function publicFile(projectDir, url) {
  const rel = decodeURIComponent(url.replace(/^\//, ''));
  for (const base of [join(projectDir, PUBLIC), join(projectDir, 'site', 'public')]) {
    const f = join(base, rel);
    if (existsSync(f)) return f;
  }
  return null;
}

function publish(projectDir, from, rel) {
  const dest = join(projectDir, PUBLIC, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (from !== dest) copyFileSync(from, dest);
  const site = join(projectDir, 'site', 'public');
  if (existsSync(join(projectDir, 'site'))) {
    mkdirSync(dirname(join(site, rel)), { recursive: true });
    copyFileSync(dest, join(site, rel));
  }
  return `/${rel.split('\\').join('/')}`;
}

function unpublish(projectDir, url) {
  const rel = url.replace(/^\//, '');
  for (const base of [join(projectDir, PUBLIC), join(projectDir, 'site', 'public')]) rmSync(join(base, rel), { force: true, recursive: true });
}

// Licence rows: cleared only with the operator's licence statement; otherwise uncertain, which
// the licences gate blocks until Asset Rights records evidence.
function register(projectDir, urls, { licence, source, usage }) {
  const file = join(projectDir, 'assets', 'register.json');
  const reg = readJson(file, { assets: [] });
  reg.assets ??= [];
  for (const url of urls) {
    const path = url.replace(/^\//, '');
    const row = { path, usage, source, licence: licence ?? 'Not yet recorded', status: licence ? 'cleared' : 'uncertain', ...(licence ? { evidence: 'operator statement (forge scroll-video add-video --licence)' } : {}) };
    const i = reg.assets.findIndex((r) => r.path === path);
    if (i >= 0) reg.assets[i] = { ...reg.assets[i], ...row };
    else reg.assets.push(row);
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(reg, null, 2) + '\n');
}

export function createScrollVideo(projectDir, opts) {
  if (existsSync(configPath(projectDir, opts.id)) && !opts.force) throw new Error(`design/scroll-video/${opts.id}.json already exists (use --force to start it again).`);
  const config = newConfig(opts);
  return { config, file: saveConfig(projectDir, config) };
}

// addVideo(projectDir, id, { files: [{ path, media }], poster, posterAlt, posterAt, licence, tool, rescale, pictureTool })
// Probes and assesses every file and refuses the upload if any is unusable. The first file
// without a media query sets the duration and size; others are alternative cuts (a portrait or
// smaller version) and must be the same length.
export async function addVideo(projectDir, id, opts = {}) {
  const files = opts.files ?? [];
  if (!files.length) throw new Error('Give at least one --video <file>.');
  const reports = [];
  for (const f of files) {
    const info = probeFile(f.path);
    const assessment = assessVideo(info, { name: basename(f.path) });
    reports.push({ file: basename(f.path), media: f.media ?? null, probe: info, assessment });
  }
  const refused = reports.filter((r) => !r.assessment.ok);
  if (refused.length) {
    const err = new Error(`Cannot use ${refused.map((r) => `${r.file}: ${r.assessment.errors.join(' ')}`).join(' | ')}`);
    err.reports = reports;
    throw err;
  }
  const primary = reports.find((r) => !r.media) ?? reports[0];
  const p = primary.probe;
  for (const r of reports) {
    if (Math.abs(r.probe.durationS - p.durationS) > 0.1) throw new Error(`${r.file} is ${r.probe.durationS} s but ${primary.file} is ${p.durationS} s; alternative cuts must be the same length so the scenes line up.`);
  }

  let config = existsSync(configPath(projectDir, id)) ? loadConfig(projectDir, id) : newConfig({ id, beats: 5, durationS: p.durationS, aspectRatio: p.aspectRatio });
  const previous = config.video;

  // Copy the files under stable names: <id>.<ext>, and <id>-2.<ext> ... for alternative cuts.
  const used = new Set();
  const sources = reports.map((r, i) => {
    const ext = r.probe.container === 'webm' ? 'webm' : 'mp4';
    let name = `${id}${i ? `-${i + 1}` : ''}.${ext}`;
    while (used.has(name)) name = `${id}-${used.size + 1}.${ext}`;
    used.add(name);
    const src = publish(projectDir, files[i].path, join('video', name));
    return { src, type: `video/${ext}`, ...(r.media ? { media: r.media } : {}), width: r.probe.width, height: r.probe.height, bytes: r.probe.bytes };
  });
  // Media-specific cuts first, then WebM before MP4: the engine takes the first that fits.
  sources.sort((a, b) => Number(Boolean(b.media)) - Number(Boolean(a.media)) || (a.type === b.type ? 0 : a.type === 'video/webm' ? -1 : 1));
  for (const old of previous?.sources ?? []) if (!sources.some((s) => s.src === old.src)) unpublish(projectDir, old.src);

  // The poster: the operator's image, or a frame of the clip.
  let poster;
  if (opts.poster) {
    const ext = extname(opts.poster).toLowerCase() || '.jpg';
    poster = { src: publish(projectDir, opts.poster, join('video', `${id}-poster${ext}`)), alt: opts.posterAlt ?? previous?.poster?.alt ?? '', width: p.width, height: p.height };
  } else {
    const source = reports.find((r) => r.probe.container === 'webm') ?? primary;
    const tmp = join(projectDir, PUBLIC, 'video', `${id}-poster.webp`);
    const shot = await makePoster(files[reports.indexOf(source)].path, tmp, { at: opts.posterAt ?? 0, width: Math.min(1600, p.width), tool: opts.pictureTool });
    poster = { src: publish(projectDir, tmp, join('video', `${id}-poster.webp`)), alt: opts.posterAlt ?? previous?.poster?.alt ?? '', width: shot.width ?? p.width, height: shot.height ?? p.height };
  }
  if (previous?.poster?.src && previous.poster.src !== poster.src) unpublish(projectDir, previous.poster.src);

  // Scenes: retimed from the storyboard on the first upload; stretched on a replacement with
  // --rescale; otherwise kept, and `check` reports any that no longer fit.
  if (!previous && config.storyboard) config.scenes = scenesFromStoryboard(config.storyboard, p.durationS, config.scenes);
  else if (previous && opts.rescale && Math.abs(previous.durationS - p.durationS) > 0.01) config.scenes = rescaleScenes(config.scenes, previous.durationS, p.durationS);

  config.video = {
    sources,
    poster,
    durationS: p.durationS,
    width: p.width,
    height: p.height,
    aspectRatio: p.aspectRatio,
    ...(p.fps ? { fps: p.fps } : {}),
    bytes: p.bytes,
    ...(p.keyframeIntervalS !== null ? { keyframeIntervalS: p.keyframeIntervalS } : {}),
    origin: { ...(opts.tool ? { tool: opts.tool } : {}), file: basename(files[0].path), generatedAt: new Date().toISOString() },
  };
  if (previous?.frames) unpublish(projectDir, dirname(previous.frames.pattern));
  saveConfig(projectDir, config);
  register(projectDir, [...sources.map((s) => s.src), poster.src], { licence: opts.licence, source: opts.tool ? `Generated with ${opts.tool}, supplied by the operator` : 'Supplied by the operator', usage: `Scroll video ${id}` });
  writeFileSync(reportPath(projectDir, id), JSON.stringify({ id, at: new Date().toISOString(), files: reports }, null, 2) + '\n');
  return { config, reports, replaced: Boolean(previous) };
}

// configFromPrepared(projectDir, id, prepared) => config. The media step's scroll-scrub clip
// (already encoded into assets/public/video/ by prepareVideo) becomes a config's video block;
// the storyboard and scenes stay to be written (or are retimed if a storyboard exists).
export function configFromPrepared(projectDir, id, { webm, mp4, poster, alt = '' }) {
  const files = [webm, mp4].filter(Boolean).map((rel) => ({ rel, file: join(projectDir, PUBLIC, rel) })).filter((x) => existsSync(x.file));
  if (!files.length) throw new Error(`No prepared video for ${id} in assets/public.`);
  const probes = files.map((x) => ({ ...x, probe: probeFile(x.file) }));
  const p = probes[0].probe;
  let config = existsSync(configPath(projectDir, id)) ? loadConfig(projectDir, id) : newConfig({ id, beats: 5, durationS: p.durationS, aspectRatio: p.aspectRatio });
  if (!config.video && config.storyboard) config.scenes = scenesFromStoryboard(config.storyboard, p.durationS, config.scenes);
  config.video = {
    sources: probes.map((x) => ({ src: `/${x.rel}`, type: `video/${x.probe.container}`, width: x.probe.width, height: x.probe.height, bytes: x.probe.bytes })),
    poster: { src: `/${poster}`, alt, width: p.width, height: p.height },
    durationS: p.durationS,
    width: p.width,
    height: p.height,
    aspectRatio: p.aspectRatio,
    ...(p.fps ? { fps: p.fps } : {}),
    bytes: p.bytes,
    ...(p.keyframeIntervalS !== null ? { keyframeIntervalS: p.keyframeIntervalS } : {}),
    origin: { file: 'forge go (media step)', generatedAt: new Date().toISOString() },
  };
  saveConfig(projectDir, config);
  return config;
}

export function writePrompts(projectDir, id, { brief, tokens } = {}) {
  const config = loadConfig(projectDir, id);
  brief ??= readJson(join(projectDir, 'intake', 'brief.json'), {});
  tokens ??= readJson(join(projectDir, 'design', 'tokens.json'), null);
  config.prompts = buildVideoPrompts(config, { brief, tokens });
  saveConfig(projectDir, config);
  const md = join(projectDir, 'design', 'scroll-video', `${id}-prompts.md`);
  writeFileSync(md, promptsMarkdown(config));
  return { config, file: md };
}

// The primary file on disk, for stills, frames and probing.
function primaryFile(projectDir, config, { decodable = false } = {}) {
  const sources = config.video?.sources ?? [];
  const ordered = decodable ? [...sources.filter((s) => s.type === 'video/webm'), ...sources] : [...sources.filter((s) => !s.media), ...sources];
  for (const s of ordered) {
    const f = publicFile(projectDir, s.src);
    if (f) return f;
  }
  throw new Error(`${config.id} has no video file on disk yet: run forge scroll-video add-video.`);
}

// writeStills: one still at the start of each scene and a contact sheet, to check markers by eye.
export async function writeStills(projectDir, id, { pictureTool } = {}) {
  const config = loadConfig(projectDir, id);
  const file = primaryFile(projectDir, config, { decodable: true });
  const dir = join(projectDir, 'design', 'scroll-video', `${id}-stills`);
  rmSync(dir, { recursive: true, force: true });
  const fps = config.video.fps || 30;
  const times = config.scenes.map((s) => Math.min(s.start + 0.5 / fps, config.video.durationS - 0.01));
  const out = config.scenes.map((s) => join(dir, `${s.id}.webp`));
  await stillsAt(file, times, out, { width: 640, tool: pictureTool });
  const rows = config.scenes.map((s) => `<figure><img src="${s.id}.webp" alt="" width="320"><figcaption><b>${esc(s.title)}</b><br>${s.start} to ${s.end} s &middot; ${esc(s.position ?? 'bottom-start')}${s.description ? `<br>${esc(s.description)}` : ''}</figcaption></figure>`).join('\n');
  writeFileSync(join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${esc(id)}: scene stills</title><style>body{font:14px system-ui;margin:2rem}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1.5rem}img{width:100%;height:auto;display:block}figure{margin:0}</style><h1>${esc(config.title ?? id)}: one still at the start of each scene</h1><main>\n${rows}\n</main>\n`);
  return { dir, files: out };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function writeFrames(projectDir, id, { fps = 12, width = 960, pictureTool } = {}) {
  const config = loadConfig(projectDir, id);
  const file = primaryFile(projectDir, config, { decodable: true });
  const rel = join('video', `${id}-frames`);
  const dir = join(projectDir, PUBLIC, rel);
  rmSync(dir, { recursive: true, force: true });
  const r = await extractFrames(file, dir, { durationS: config.video.durationS, fps, width: Math.min(width, config.video.width), tool: pictureTool });
  for (const f of r.files) publish(projectDir, join(dir, f), join(rel, f));
  const height = Math.round((Math.min(width, config.video.width) * config.video.height) / config.video.width / 2) * 2;
  config.video.frames = { pattern: `/${rel.split('\\').join('/')}/frame-{i}.${r.ext}`, pad: 4, count: r.count, fps, width: Math.min(width, config.video.width), height, bytes: r.bytes };
  saveConfig(projectDir, config);
  return { config, count: r.count, bytes: r.bytes };
}

// checkScrollVideo(projectDir, id) => { id, ok, findings }: the config against its files.
export function checkScrollVideo(projectDir, id) {
  let config;
  try {
    config = loadConfig(projectDir, id);
  } catch (err) {
    return { id, ok: false, findings: [{ id: 'config', severity: 'critical', message: err.message }] };
  }
  let probe = null;
  const extra = [];
  try {
    if (config.video) probe = probeFile(primaryFile(projectDir, config));
  } catch (err) {
    extra.push({ id: 'probe', severity: 'critical', message: err.message });
  }
  const r = checkConfig(config, { probe, exists: (url) => Boolean(publicFile(projectDir, url)) });
  const findings = [...extra, ...r.findings];
  return { id, ok: r.ok && !extra.length, findings };
}

export const checkAll = (projectDir) => listConfigs(projectDir).map((id) => checkScrollVideo(projectDir, id));

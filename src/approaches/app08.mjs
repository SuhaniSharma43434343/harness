import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { ConfigInvalid, ConfigMissing, Unavailable } from '../core/errors.mjs';
import { applyApproach } from './apply.mjs';

// APP-08 AI Image Frame Animation (T12): a scroll-scrubbed frame sequence from owned or
// licensed frames, plus a 2.5D depth-map parallax scene. No package: the player is plain canvas
// and WebGL. ffmpeg (a system tool, not a dependency) turns a video into 720p WebP frames.
// Fallback: the static key frame.

const FRAME_EXT = new Set(['.webp', '.avif', '.jpg', '.jpeg', '.png', '.svg']);

const app08 = {
  id: 'APP-08',
  name: 'Image Frame Animation',
  recipes: 'skills/app08/recipes',
  sections: ['FrameSequence', 'DepthParallax'],
  packages: [],
  fallback: { approach: 'APP-01', description: 'Static key frame', triggers: ['reduced-motion', 'no-webgl', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: mobile frames at most 3 MB in total (WebP or AVIF, 720p), and no scroll segment
  // left without a frame.
  budget: { framesBytes: 3 * 1024 * 1024, maxFrameHeight: 720 },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },
};
export default app08;

// The frames of one sequence in a folder, in order.
export function listFrames(dir) {
  if (!existsSync(dir)) throw new ConfigMissing(`No frames in ${dir}`);
  return readdirSync(dir)
    .filter((f) => FRAME_EXT.has(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// Checks a frame folder against the budget: total size, and a gap-free numbered run.
export function checkFrames(dir, { budget = app08.budget.framesBytes } = {}) {
  const files = listFrames(dir);
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const numbers = files.map((f) => Number(f.match(/(\d+)(?=\.[^.]+$)/)?.[1]));
  const gaps = [];
  numbers.forEach((n, i) => {
    if (i && n !== numbers[i - 1] + 1) gaps.push(numbers[i - 1] + 1);
  });
  const problems = [];
  if (!files.length) problems.push('no frames');
  if (bytes > budget) problems.push(`frames are ${(bytes / 1048576).toFixed(2)} MB, over the ${(budget / 1048576).toFixed(0)} MB budget`);
  if (numbers.some((n) => !Number.isFinite(n))) problems.push('every frame name must end in its number, for example 001.webp');
  else if (numbers[0] !== 1) problems.push('frames must be numbered from 1');
  if (gaps.length) problems.push(`missing frame numbers: ${gaps.slice(0, 10).join(', ')}`);
  return { count: files.length, bytes, ok: problems.length === 0, problems, pattern: patternFor(files) };
}

function patternFor(files) {
  const m = files[0]?.match(/^(.*?)(\d+)(\.[^.]+)$/);
  return m ? `${m[1]}%0${m[2].length}d${m[3]}` : null;
}

// Turns a video into numbered WebP frames at most 720 px high with ffmpeg.
export function extractFrames(video, outDir, { fps = 24, height = app08.budget.maxFrameHeight, quality = 70, ffmpeg = 'ffmpeg' } = {}) {
  if (!existsSync(video)) throw new ConfigMissing(`No video at ${video}`);
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${fps},scale=-2:'min(${height},ih)'`, '-c:v', 'libwebp', '-quality', String(quality), join(outDir, '%03d.webp')], { encoding: 'utf8', windowsHide: true });
  if (r.error?.code === 'ENOENT') throw new ConfigMissing('ffmpeg is not installed', { hint: 'Install ffmpeg (a system tool) to turn a video into frames, or supply the frames yourself.' });
  if (r.status !== 0) throw new Unavailable(`ffmpeg could not extract frames: ${(r.stderr || '').trim().split('\n').pop()}`);
  return checkFrames(outDir);
}

// Adds a provenance row for every frame (and a depth map) to assets/register.json. The plan
// needs one per frame: its source, licence and, for generated frames, the generator's terms.
// provenance: { source, licence, generator?, generatorTerms? }
export function registerFrames(projectDir, publicDir, { files, provenance }) {
  if (!provenance?.source || !provenance?.licence) {
    throw new ConfigInvalid('Every frame needs its source and licence', { hint: 'Pass provenance: { source, licence }, and generator and generatorTerms for generated frames.' });
  }
  if (provenance.generator && !provenance.generatorTerms) {
    throw new ConfigInvalid(`Generated frames need the terms of ${provenance.generator}`, { hint: 'Record where the generator’s terms are (a URL or a file).' });
  }
  const file = join(projectDir, 'assets', 'register.json');
  const register = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { assets: [] };
  register.assets ??= [];
  for (const f of files) {
    const path = `${publicDir.replace(/\/$/, '')}/${f}`;
    if (register.assets.some((r) => r.path === path)) continue;
    register.assets.push({
      path,
      usage: 'APP-08 frame',
      source: provenance.source,
      licence: provenance.licence,
      status: 'cleared',
      evidence: provenance.evidence ?? provenance.source,
      ...(provenance.generator ? { generator: provenance.generator, generatorTerms: provenance.generatorTerms } : {}),
    });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(register, null, 2) + '\n');
  return register.assets.length;
}

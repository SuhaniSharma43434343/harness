import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Video the site will use: a clip the client supplies, or a free clip from Pexels. Both go through
// the same careful step: look at the clip, decide where on the site it belongs and why, make a
// small web version, and record where it came from.

export const HERO_LOOP_MAX_BYTES = 1.5 * 1024 * 1024;

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', shell: false });
export function toolAvailable(cmd) {
  const r = run(cmd, ['-version']);
  return !r.error && r.status === 0;
}

// probeVideo(file) => { durationS, width, height, fps, hasAudio, codec, bytes }
export function probeVideo(file, { ffprobe = 'ffprobe' } = {}) {
  if (!existsSync(file)) throw new Error(`There is no video at ${file}`);
  const r = run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.error || r.status !== 0) throw new Error('ffprobe is needed to read the video. Install ffmpeg (winget install Gyan.FFmpeg) and try again.');
  const info = JSON.parse(r.stdout);
  const v = info.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('That file has no video stream.');
  const [n, d] = String(v.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    durationS: Math.round(Number(info.format.duration) * 10) / 10,
    width: v.width,
    height: v.height,
    fps: d ? Math.round((n / d) * 10) / 10 : null,
    hasAudio: info.streams.some((s) => s.codec_type === 'audio'),
    codec: v.codec_name,
    bytes: statSync(file).size,
  };
}

// placeVideo(info, brief, opts?) => { role, page, section, reasons[], warnings[], alternatives[] }
// Decides where a supplied clip belongs. The rules, in order, and the reason for each:
//  - A portrait clip is made for a phone screen, so it cannot be a wide background. It goes in a
//    framed "story" block beside text.
//  - A short landscape clip (up to 15 s) is a loop: a hero background behind a dark scrim, silent,
//    with a poster first. If the hero must carry a booking or order button, the scrim and the
//    button position are fixed by the plan so the button stays readable.
//  - A medium clip (15 to 60 s) is a story: it sits mid-page, plays only when the visitor taps,
//    and is never the hero (a long clip behind a headline distracts and costs data).
//  - A long clip (over 60 s) is trimmed into a short one for the page and the full one is linked.
export function placeVideo(info, brief = {}, { role: forced, sound = false } = {}) {
  const reasons = [];
  const warnings = [];
  const alternatives = [];
  const primary = brief.business?.primaryConversion;
  const portrait = info.height > info.width;
  let role;
  let page = '/';
  let section;

  if (portrait) {
    role = 'story-clip';
    section = 'a framed phone-shaped block beside text, mid-page';
    reasons.push('The clip is upright (made for a phone), so it cannot fill a wide hero. It sits in a phone-shaped frame next to the words.');
    alternatives.push({ role: 'hero-loop', why: 'Only if you re-export it wide (16:9).' });
  } else if (info.durationS <= 15) {
    role = 'hero-loop';
    section = 'the background of the home page hero, behind a dark scrim, silent, poster first';
    reasons.push(`It is ${info.durationS} seconds and wide, which suits a looping hero background.`);
    if (primary) reasons.push(`The scrim keeps the headline and the "${primary.label}" button readable on top of it.`);
    alternatives.push({ role: 'story-clip', why: 'Use it mid-page as a tap-to-play block if you want the hero to stay still.' });
  } else if (info.durationS <= 60) {
    role = 'story-clip';
    section = 'a mid-page block on the home page (after the first proof section) that plays when tapped';
    reasons.push(`At ${info.durationS} seconds it is a story, not a loop. It plays only when the visitor taps, and never sits behind the headline.`);
    alternatives.push({ role: 'hero-loop', why: 'Trim it to 6 to 12 seconds first.' });
  } else {
    role = 'story-clip';
    section = 'a mid-page block with a short cut-down, linking to the full video';
    reasons.push(`At ${info.durationS} seconds it is too long for a page. The harness uses the first 20 seconds and links the rest.`);
    warnings.push('Trim a 10 to 20 second highlight yourself for the best result.');
  }
  if (forced) {
    reasons.unshift(`You asked for it to be the ${forced}.`);
    role = forced;
    if (forced === 'hero-loop' && info.durationS > 15) warnings.push('A hero loop over 15 seconds costs data and distracts. It will be cut to the first 12 seconds.');
  }
  if (info.width < 1280 && !portrait) warnings.push(`The clip is only ${info.width} px wide; it may look soft on a large screen.`);
  if (info.hasAudio) warnings.push(sound ? 'The sound plays only after the visitor taps the clip; it never plays on its own.' : 'The sound is removed on the site; a looping or tapped clip is silent by default.');
  if (info.bytes > 30 * 1024 * 1024) warnings.push('The file is large; it will be compressed to a small web version.');
  return { role, page, section, reasons, warnings, alternatives };
}

// prepareVideo(file, destDir, id, opts) => { mp4, webm, poster, bytes }
// Makes the web versions: H.264 MP4 and VP9 WebM, no sound, fast start, 720p for a hero loop, and a
// poster frame. A hero loop is cut to 12 seconds; a story clip to 20 s at most.
export function prepareVideo(file, destDir, id, { role = 'hero-loop', ffmpeg = 'ffmpeg', keepAudio = false } = {}) {
  const out = join(destDir, 'video');
  mkdirSync(out, { recursive: true });
  const limit = role === 'hero-loop' ? 12 : 60;
  const scale = role === 'hero-loop' ? 'scale=-2:720' : 'scale=-2:720';
  const base = ['-y', '-i', file, '-t', String(limit), ...(keepAudio ? [] : ['-an']), '-vf', scale];
  const mp4 = join(out, `${id}.mp4`);
  const webm = join(out, `${id}.webm`);
  const poster = join(out, `${id}-poster.webp`);
  const steps = [
    [...base, '-c:v', 'libx264', '-crf', role === 'hero-loop' ? '30' : '27', '-preset', 'slow', '-pix_fmt', 'yuv420p', ...(keepAudio ? ['-c:a', 'aac', '-b:a', '96k'] : []), '-movflags', '+faststart', mp4],
    [...base, '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-row-mt', '1', ...(keepAudio ? ['-c:a', 'libopus', '-b:a', '64k'] : []), webm],
    ['-y', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-quality', '80', poster],
  ];
  for (const args of steps) {
    const r = run(ffmpeg, args);
    if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? r.error?.message ?? '').slice(-300)}`);
  }
  const bytes = statSync(mp4).size;
  const warn = role === 'hero-loop' && bytes > HERO_LOOP_MAX_BYTES ? `The hero loop came out at ${(bytes / 1048576).toFixed(1)} MB (target 1.5 MB). Trim it or lower the quality.` : null;
  return { mp4: `video/${id}.mp4`, webm: `video/${id}.webm`, poster: `video/${id}-poster.webp`, bytes, warn };
}

// Records a prepared clip in the project's licence register.
export function registerVideo(projectDir, row) {
  const file = join(projectDir, 'assets', 'register.json');
  const register = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { assets: [] };
  register.assets ??= [];
  for (const path of row.paths) {
    if (register.assets.some((r) => r.path === path)) continue;
    register.assets.push({ path, usage: `Video ${row.role}`, source: row.source, licence: row.licence, status: 'cleared', evidence: row.evidence });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(register, null, 2) + '\n');
}

// searchPexels(query, { key, fetch }) => up to 3 clips. Pexels is free for commercial use with no
// credit; an API key is needed (set PEXELS_API_KEY in .env; it is read here, never by an agent).
export async function searchPexels(query, { key, fetch: fetchImpl = globalThis.fetch, count = 3 } = {}) {
  if (!key) return { needsKey: true, clips: [] };
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=15`;
  const res = await fetchImpl(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels answered ${res.status}`);
  const data = await res.json();
  const clips = [];
  for (const v of data.videos ?? []) {
    if (v.duration < 5 || v.duration > 30) continue;
    const files = (v.video_files ?? []).filter((f) => f.file_type === 'video/mp4' && f.width >= 1280 && f.width <= 1920).sort((a, b) => a.width - b.width);
    if (!files.length) continue;
    clips.push({
      id: `pexels-${v.id}`,
      title: v.url.split('/').filter(Boolean).pop().replace(/-\d+$/, '').replace(/-/g, ' '),
      creator: v.user?.name ?? 'Pexels contributor',
      licence: 'Pexels licence (free for commercial use, no credit needed)',
      source: 'pexels',
      url: v.url,
      durationS: v.duration,
      width: files[0].width,
      height: files[0].height,
      previewImage: v.image,
      downloadUrl: files[0].link,
    });
    if (clips.length >= count) break;
  }
  return { needsKey: false, clips };
}

export async function downloadClip(clip, destFile, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(clip.downloadUrl);
  if (!res.ok) throw new Error(`${clip.downloadUrl} answered ${res.status}`);
  mkdirSync(dirname(destFile), { recursive: true });
  writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
  return destFile;
}

export { copyFileSync };

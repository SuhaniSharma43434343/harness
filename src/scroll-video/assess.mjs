// Is this video usable for a scroll-controlled section, and how should it be encoded? Pure: it
// reads a probe result (probe.mjs or ffprobe) and returns errors that refuse the file, warnings,
// and recommendations with the exact ffmpeg command for each.
//
// The rules and why:
// - Scrubbing seeks. A browser decodes from the previous keyframe to the frame asked for, so a
//   clip with a keyframe every 2-10 s (what cameras and AI generators deliver) stutters, and
//   worst in reverse. A keyframe every 0.2 s (`-g fps/5`) makes every seek short.
// - The engine fetches clips up to 12 MB whole, so seeking never waits for the network.
// - Scroll video is silent and needs no more than 30 frames a second.

export const LIMITS = Object.freeze({
  minDurationS: 1,
  maxDurationS: 120,
  longDurationS: 20,
  shortDurationS: 3,
  minSide: 320,
  maxLongSide: 1920,
  maxFps: 30,
  maxKeyframeIntervalS: 0.5,
  blobMaxBytes: 12 * 1024 * 1024,
  hardMaxBytes: 100 * 1024 * 1024,
});

const PLAYABLE = { mp4: new Set(['h264', 'av1', 'vp9']), webm: new Set(['vp8', 'vp9', 'av1']) };

// Bitrate that looks clean for a scrubbed clip at a given short side, in kbit/s.
export function targetKbps(shortSide) {
  if (shortSide <= 540) return 1500;
  if (shortSide <= 720) return 2500;
  if (shortSide <= 1080) return 4500;
  return 8000;
}

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const q = (p) => (/[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);

// encodeArgs(input, output, opts) => ffmpeg arguments for a scroll-tuned web version.
// opts: { format: 'mp4'|'webm', fps, height (short side), width, gop, crop }
export function encodeArgs(input, output, { format = 'mp4', fps = 30, height = 1080, width = null, gop = null, crop = null } = {}) {
  const g = gop ?? Math.max(2, Math.round(fps / 5));
  const scale = width ? `scale=${width}:-2` : `scale=-2:${height}`;
  const vf = [crop, scale, `fps=${fps}`].filter(Boolean).join(',');
  const common = ['-y', '-i', input, '-an', '-vf', vf, '-g', String(g), '-keyint_min', String(g), '-pix_fmt', 'yuv420p'];
  if (format === 'webm') return [...common, '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', output];
  return [...common, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-sc_threshold', '0', '-bf', '0', '-movflags', '+faststart', output];
}
const command = (args) => ['ffmpeg', ...args.map(q)].join(' ');

// assessVideo(info, { name }) => { ok, errors[], warnings[], recommendations[{ id, why, command? }], targets }
export function assessVideo(info, { name = 'input' } = {}) {
  const errors = [];
  const warnings = [];
  const recs = [];
  const add = (id, why, cmd) => recs.push({ id, why, ...(cmd ? { command: cmd } : {}) });
  const portrait = info.height > info.width;
  const longSide = Math.max(info.width, info.height);
  const shortSide = Math.min(info.width, info.height);
  const fps = Math.min(LIMITS.maxFps, Math.round(info.fps || 30));
  const outShort = Math.min(shortSide, 1080);
  const stem = name.replace(/\.[^.]+$/, '');

  if (!['mp4', 'webm'].includes(info.container)) errors.push(`The container is ${info.container ?? 'unknown'}; use MP4 or WebM.`);
  if (!(info.durationS >= LIMITS.minDurationS)) errors.push(`The clip is ${info.durationS ?? 0} s long; a scroll video needs at least ${LIMITS.minDurationS} s.`);
  if (info.durationS > LIMITS.maxDurationS) errors.push(`The clip is ${info.durationS} s long; over ${LIMITS.maxDurationS} s is too long to scroll through. Cut it into separate sections.`);
  if (!(shortSide >= LIMITS.minSide)) errors.push(`The frame is ${info.width}x${info.height}; the short side must be at least ${LIMITS.minSide} px.`);
  if (info.bytes > LIMITS.hardMaxBytes) errors.push(`The file is ${mb(info.bytes)}; over ${mb(LIMITS.hardMaxBytes)} cannot be served to phones. Re-encode it (see the recommendations).`);
  const playable = PLAYABLE[info.container]?.has(info.codec);
  if (info.container && !playable) {
    const msg = `The ${info.codec} codec does not play in every browser.`;
    if (['prores', 'mpeg4', 'mjpeg', 'hevc'].includes(info.codec)) errors.push(`${msg} Re-encode to H.264 MP4 and VP9 WebM.`);
    else warnings.push(msg);
    add('reencode', 'Make the two web versions every browser plays.', command(encodeArgs(name, `${stem}.mp4`, { fps, height: outShort })));
  }

  if (info.keyframeIntervalS === null || info.keyframeIntervalS > LIMITS.maxKeyframeIntervalS) {
    const gap = info.keyframeIntervalS === null ? 'unknown' : `${info.keyframeIntervalS} s`;
    warnings.push(`Keyframes are ${gap} apart; scrubbing (worst in reverse) will stutter above ${LIMITS.maxKeyframeIntervalS} s.`);
    add('keyframes', `Re-encode with a keyframe every ${Math.max(2, Math.round(fps / 5))} frames (0.2 s) so every seek is short.`, command(encodeArgs(name, `${stem}.mp4`, { fps, height: outShort })));
  }
  if (info.hasAudio) {
    warnings.push('The clip has sound; a scrubbed video is always silent.');
    add('audio', 'Drop the audio track (-an); it only adds bytes.');
  }
  if (info.fps > LIMITS.maxFps + 0.5) {
    warnings.push(`${info.fps} frames a second is more than scrolling can show.`);
    add('fps', `Re-encode at ${fps} fps (fps=${fps}); half the frames, the same look when scrubbed.`);
  }
  if (longSide > LIMITS.maxLongSide) {
    warnings.push(`${info.width}x${info.height} is larger than any screen needs.`);
    add('size', 'Scale to 1080 on the short side for desktop.', command(encodeArgs(name, `${stem}.mp4`, { fps, height: outShort })));
  }
  const budgetKbps = targetKbps(outShort);
  if (info.bitrateKbps > budgetKbps * 1.5) {
    warnings.push(`${info.bitrateKbps} kbit/s is heavy for ${outShort}p (about ${budgetKbps} kbit/s looks clean).`);
    add('bitrate', `Compress to about ${budgetKbps} kbit/s, around ${mb((budgetKbps * 1000 * info.durationS) / 8)} for this clip.`, command(encodeArgs(name, `${stem}.webm`, { format: 'webm', fps, height: outShort })));
  }
  if (info.bytes > LIMITS.blobMaxBytes) {
    warnings.push(`At ${mb(info.bytes)} the clip streams instead of loading whole, so seeking depends on the host's byte-range support and the connection.`);
  }
  if (info.container === 'mp4' && info.fastStart === false) {
    warnings.push('The MP4 index is at the end of the file, so nothing shows until it has all downloaded.');
    add('faststart', 'Move the index to the front.', command(['-y', '-i', name, '-c', 'copy', '-movflags', '+faststart', `${stem}-faststart.mp4`]));
  }
  if (info.fragmented) warnings.push('The MP4 is fragmented; some browsers seek it slowly. Re-encode with +faststart.');
  if (info.container === 'webm' && (info.hasCues === false || info.hasDuration === false)) {
    warnings.push('The WebM has no seek index (cues) or no duration, as screen and browser recordings do; seeking will be slow.');
    add('remux', 'Re-encode to add the index.', command(encodeArgs(name, `${stem}.webm`, { format: 'webm', fps, height: outShort })));
  }
  if (info.durationS > LIMITS.longDurationS) warnings.push(`${info.durationS} s makes a long scroll; 6 to 15 s suits most stories.`);
  if (info.durationS > 0 && info.durationS < LIMITS.shortDurationS) warnings.push(`${info.durationS} s is short; scenes will pass quickly unless the scroll length is small.`);

  // Always: the two formats, a phone version, and a frame sequence for the frames renderer.
  add('formats', 'Serve VP9 WebM first (smaller) and H.264 MP4 second (Safari and older iPhones).', `${command(encodeArgs(name, `${stem}.webm`, { format: 'webm', fps, height: outShort }))}\n${command(encodeArgs(name, `${stem}.mp4`, { fps, height: outShort }))}`);
  if (!portrait && shortSide >= 720) {
    add('mobile', 'A 720p cut for phones, used with media "(max-width: 47.99em)"; or a portrait crop that keeps the subject.', command(encodeArgs(name, `${stem}-720.webm`, { format: 'webm', fps, height: 720 })));
  }
  add('frames', 'Optional: an image sequence for the frames renderer (exact in reverse, more bytes).', command(['-y', '-i', name, '-vf', `fps=12,scale=${portrait ? '-2:960' : '960:-2'}`, '-q:v', '4', `${stem}-frames/frame-%04d.jpg`]));

  const targets = { fps, shortSide: outShort, kbps: budgetKbps, bytes: Math.round((budgetKbps * 1000 * info.durationS) / 8), keyframeIntervalS: Math.round(100 / fps * Math.max(2, Math.round(fps / 5))) / 100 };
  return { ok: errors.length === 0, errors, warnings, recommendations: recs, targets };
}

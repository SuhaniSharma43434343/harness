// The scroll video container reader and asset checks (src/scroll-video/probe.mjs, assess.mjs),
// without ffprobe: synthetic MP4 and WebM files with known headers (T1, T2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, assessVideo, encodeArgs } from '../../src/scroll-video/assess.mjs';
import { probeFile, sniff } from '../../src/scroll-video/probe.mjs';
import { placeVideo, probeVideo } from '../../src/media/video.mjs';
import { mp4, webm } from './scroll-video-media.mjs';

const dir = mkdtempSync(join(tmpdir(), 'forge-sv-probe-'));
const file = (name, buf) => {
  const f = join(dir, name);
  writeFileSync(f, buf);
  return f;
};

test('MP4: duration, size, aspect ratio, codec, frame rate, keyframe spacing, fast start', () => {
  const p = probeFile(file('a.mp4', mp4({ fps: 24, frames: 240, keyEvery: 48 })));
  assert.equal(p.container, 'mp4');
  assert.equal(p.codec, 'h264');
  assert.deepEqual([p.width, p.height, p.aspectRatio], [1920, 1080, '16:9']);
  assert.equal(p.durationS, 10);
  assert.equal(p.fps, 24);
  assert.equal(p.frameCount, 240);
  assert.equal(p.keyframes, 5);
  assert.equal(p.keyframeIntervalS, 2);
  assert.equal(p.fastStart, true);
  assert.equal(p.hasAudio, false);
  assert.equal(p.allIntra, false);
  assert.ok(p.bitrateKbps > 0);
});

test('MP4: rotation swaps width and height; audio, a late index and all-intra are reported', () => {
  const rotated = probeFile(file('r.mp4', mp4({ width: 1920, height: 1080, rotation: 90 })));
  assert.deepEqual([rotated.width, rotated.height, rotated.rotation, rotated.aspectRatio], [1080, 1920, 90, '9:16']);
  const late = probeFile(file('late.mp4', mp4({ fastStart: false, audio: true })));
  assert.equal(late.fastStart, false);
  assert.ok(late.issues.includes('no-fast-start'));
  assert.equal(late.hasAudio, true);
  const intra = probeFile(file('intra.mp4', mp4({ keyEvery: 0, fps: 30, frames: 90 })));
  assert.equal(intra.allIntra, true);
  assert.equal(intra.keyframeIntervalS, 0.033);
  assert.equal(probeFile(file('hevc.mp4', mp4({ codec: 'hvc1' }))).codec, 'hevc');
});

test('WebM: duration, size, codec, frame rate and keyframes from the clusters', () => {
  const p = probeFile(file('a.webm', webm({ width: 1280, height: 720, fps: 25, frames: 100, keyEvery: 5 })));
  assert.equal(p.container, 'webm');
  assert.equal(p.codec, 'vp9');
  assert.deepEqual([p.width, p.height, p.aspectRatio], [1280, 720, '16:9']);
  assert.equal(p.durationS, 4);
  assert.equal(p.fps, 25);
  assert.equal(p.frameCount, 100);
  assert.equal(p.keyframes, 20);
  assert.equal(p.keyframeIntervalS, 0.2);
  assert.equal(p.hasCues, true);
  assert.equal(p.hasDuration, true);
  assert.equal(probeFile(file('av1.webm', webm({ codec: 'V_AV1' }))).codec, 'av1');
  assert.equal(probeFile(file('audio.webm', webm({ audio: true }))).hasAudio, true);
});

test('WebM from a live recording: unknown sizes, no duration, no cues', () => {
  const p = probeFile(file('live.webm', webm({ live: true, fps: 30, frames: 90, keyEvery: 90 })));
  assert.equal(p.frameCount, 90);
  assert.ok(Math.abs(p.durationS - 3) < 0.05, `${p.durationS}`);
  assert.equal(p.hasDuration, false);
  assert.equal(p.hasCues, false);
  assert.deepEqual(p.issues.sort(), ['no-cues', 'no-duration']);
  assert.equal(p.keyframes, 1);
});

test('not a video: a clear refusal, and sniff tells containers apart', () => {
  assert.throws(() => probeFile(file('x.mov', Buffer.from('this is not a video file at all'))), /not an MP4 or WebM/);
  assert.throws(() => probeFile(join(dir, 'missing.mp4')), /no video at/);
  assert.equal(sniff(mp4()), 'mp4');
  assert.equal(sniff(webm()), 'webm');
  assert.equal(sniff(Buffer.from('GIF89a......')), null);
});

const good = { container: 'webm', codec: 'vp9', durationS: 8, width: 1920, height: 1080, fps: 24, bytes: 4 * 1048576, bitrateKbps: 4200, keyframeIntervalS: 0.2, hasAudio: false, hasCues: true, hasDuration: true };

test('assess: a scroll-ready clip passes with only the standing advice', () => {
  const a = assessVideo(good, { name: 'story.webm' });
  assert.equal(a.ok, true);
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(a.recommendations.map((r) => r.id), ['formats', 'mobile', 'frames']);
  assert.match(a.recommendations[0].command, /libvpx-vp9.*story\.webm[\s\S]*libx264/);
  assert.equal(a.targets.fps, 24);
});

test('assess: long keyframe gaps, sound, high frame rate, oversize, heavy bitrate and a late index get commands (T2)', () => {
  const a = assessVideo({ ...good, container: 'mp4', codec: 'h264', keyframeIntervalS: 4, hasAudio: true, fps: 60, width: 3840, height: 2160, bitrateKbps: 40000, bytes: 40 * 1048576, fastStart: false }, { name: 'gen out.mp4' });
  assert.equal(a.ok, true, 'all fixable');
  const ids = a.recommendations.map((r) => r.id);
  for (const id of ['keyframes', 'audio', 'fps', 'size', 'bitrate', 'faststart']) assert.ok(ids.includes(id), id);
  const key = a.recommendations.find((r) => r.id === 'keyframes').command;
  assert.match(key, /"gen out\.mp4"/, 'a path with a space is quoted');
  assert.match(key, /-g 6 -keyint_min 6/);
  assert.match(key, /scale=-2:1080,fps=30/);
  assert.match(a.warnings.join(' '), /stutter/);
  assert.match(a.warnings.join(' '), /streams instead of loading whole/);
});

test('assess: refuses what cannot work, and says why (T2)', () => {
  const refuse = (info, re) => {
    const a = assessVideo({ ...good, ...info });
    assert.equal(a.ok, false);
    assert.match(a.errors.join(' '), re);
  };
  refuse({ codec: 'prores', container: 'mp4' }, /prores codec/);
  refuse({ durationS: 0.5 }, /at least 1 s/);
  refuse({ durationS: 400 }, /too long to scroll/);
  refuse({ width: 200, height: 112 }, /at least 320/);
  refuse({ bytes: LIMITS.hardMaxBytes + 1 }, /cannot be served/);
  const live = assessVideo({ ...good, hasCues: false, hasDuration: false });
  assert.ok(live.recommendations.some((r) => r.id === 'remux'));
});

test('encodeArgs: short keyframe gaps, no sound, fast start for MP4, VP9 for WebM', () => {
  const mp4Args = encodeArgs('in.mov', 'out.mp4', { fps: 24, height: 720 });
  assert.deepEqual(mp4Args.slice(mp4Args.indexOf('-g'), mp4Args.indexOf('-g') + 4), ['-g', '5', '-keyint_min', '5']);
  assert.ok(mp4Args.includes('-an') && mp4Args.includes('+faststart') && mp4Args.includes('libx264'));
  const w = encodeArgs('in.mov', 'out.webm', { format: 'webm', gop: 2, width: 960 });
  assert.ok(w.includes('libvpx-vp9') && w.includes('scale=960:-2,fps=30'));
  assert.equal(w[w.indexOf('-g') + 1], '2');
});

test('the media step reads a clip without ffprobe and can place it as a scroll video', () => {
  const f = file('step.mp4', mp4({ fps: 30, frames: 300, keyEvery: 6 }));
  const info = probeVideo(f, { ffprobe: 'forge-no-such-ffprobe' });
  assert.deepEqual([info.durationS, info.width, info.height, info.fps, info.codec], [10, 1920, 1080, 30, 'h264']);
  assert.equal(info.keyframeIntervalS, 0.2);
  const placed = placeVideo(info, { business: {} }, { role: 'scroll-scrub' });
  assert.equal(placed.role, 'scroll-scrub');
  assert.match(placed.section, /APP-02 ScrollVideo/);
  assert.match(placed.reasons.join(' '), /scroll/);
});

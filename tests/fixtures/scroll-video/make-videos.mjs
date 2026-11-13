// Test videos for the scroll video engine, made on this machine: each concept is drawn frame by
// frame on a canvas in Chromium, a 16-bit time code is stamped into the top of every frame, and
// the frames are encoded to VP9 WebM with ffmpeg (a system ffmpeg, or the one Playwright
// installs next to its browsers). The time code lets a test read which frame is on screen, so
// seek accuracy and text sync are measured, not assumed. Results are cached in the temp folder
// by a hash of this file.
//
// The concepts differ in everything the engine must not depend on: subject, duration, frame
// rate, aspect ratio and keyframe spacing (car has one keyframe, the rest one every 4-6 frames).
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONCEPTS = {
  pizza: { width: 960, height: 540, fps: 24, durationS: 6, gop: 4 },
  car: { width: 1280, height: 544, fps: 30, durationS: 8, gop: 300 },
  particles: { width: 540, height: 960, fps: 25, durationS: 10, gop: 5 },
  outfit: { width: 576, height: 720, fps: 24, durationS: 7, gop: 6 },
  building: { width: 720, height: 720, fps: 24, durationS: 9, gop: 6 },
  product: { width: 960, height: 540, fps: 30, durationS: 8, gop: 6 },
  journey: { width: 1280, height: 720, fps: 24, durationS: 12, gop: 6 },
  // The same journey with film grain at a high quality: a heavy file for the slow-network test.
  heavy: { width: 640, height: 360, fps: 24, durationS: 8, gop: 6, grain: 0.06, crf: 38, draw: 'journey' },
};

// Time code geometry, shared by the stamp (here) and the reader (tests).
export const CODE = { bits: 16, x: 0.1, y: 0.02, w: 0.8, h: 0.035, minH: 14 };
export const checksum = (i) => (i * 7 + 3) & 15;

// Where Playwright keeps its ffmpeg build, per platform.
export function findFfmpeg() {
  const sys = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (!sys.error && sys.status === 0 && /libvpx-vp9/.test(sys.stdout)) return 'ffmpeg';
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright') : null,
    process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : null,
    join(homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((d) => d.startsWith('ffmpeg')).sort().reverse()) {
      for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-linux', 'ffmpeg-mac', 'ffmpeg']) if (existsSync(join(root, dir, exe))) return join(root, dir, exe);
    }
  }
  return null;
}

// Runs in the page: draws one frame of a concept at time t, then the time code.
const DRAW = `
window.drawFrame = function (name, t, d, W, H, index, opts) {
  const c = document.querySelector('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const k = Math.min(1, t / d);
  const ease = (v) => v * v * (3 - 2 * v);
  const seg = (a, b) => ease(Math.max(0, Math.min(1, (k - a) / (b - a))));
  const R = (a) => Math.round(a);
  if (name === 'pizza') {
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#5b3a22'); g.addColorStop(1, '#3a2414');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) { x.strokeStyle = 'rgba(0,0,0,0.18)'; x.beginPath(); x.moveTo(0, H * i / 9 + 10); x.lineTo(W, H * i / 9 - 10); x.stroke(); }
    const cx = W / 2, cy = H * 0.56, r = H * 0.36 * (0.35 + 0.65 * seg(0, 0.25));
    x.fillStyle = '#e8c88f'; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = '#b8352a'; x.beginPath(); x.arc(cx, cy, r * 0.86 * seg(0.25, 0.5), 0, 7); x.fill();
    const cheese = R(60 * seg(0.5, 0.75));
    for (let i = 0; i < cheese; i++) { const a = i * 2.39996, rr = r * 0.8 * Math.sqrt((i + 0.5) / 60); x.fillStyle = '#f6e6b0'; x.beginPath(); x.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r * 0.09, 0, 7); x.fill(); }
    const top = R(14 * seg(0.75, 1));
    for (let i = 0; i < top; i++) { const a = i * 1.7, rr = r * 0.55 * ((i % 3) + 1) / 3; x.fillStyle = i % 2 ? '#2f7d32' : '#7a1f1f'; x.beginPath(); x.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r * 0.07, r * 0.045, a, 0, 7); x.fill(); }
  } else if (name === 'car') {
    x.fillStyle = '#07080b'; x.fillRect(0, 0, W, H);
    const sweep = -0.3 + 1.6 * k;
    const g = x.createLinearGradient((sweep - 0.25) * W, 0, (sweep + 0.25) * W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(220,226,240,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = '#1c2230'; x.fillRect(0, H * 0.78, W, H * 0.22);
    x.save(); x.beginPath(); x.moveTo(W * 0.18, H * 0.66); x.quadraticCurveTo(W * 0.3, H * 0.42, W * 0.48, H * 0.4); x.quadraticCurveTo(W * 0.66, H * 0.38, W * 0.8, H * 0.6); x.lineTo(W * 0.84, H * 0.7); x.lineTo(W * 0.16, H * 0.72); x.closePath();
    x.fillStyle = '#0d1018'; x.fill(); x.clip(); x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
    for (const wx of [0.3, 0.7]) { x.fillStyle = '#000'; x.beginPath(); x.arc(W * wx, H * 0.72, H * 0.08, 0, 7); x.fill(); x.strokeStyle = 'rgba(200,210,230,' + (0.15 + 0.6 * seg(0.4, 0.8)) + ')'; x.lineWidth = 3; x.stroke(); }
    const lamps = seg(0.85, 1); x.fillStyle = 'rgba(255,244,214,' + lamps + ')'; x.beginPath(); x.ellipse(W * 0.81, H * 0.6, W * 0.025, H * 0.02, 0, 0, 7); x.fill();
  } else if (name === 'particles') {
    x.fillStyle = '#0f1412'; x.fillRect(0, 0, W, H);
    const n = 420, mark = (i) => { const a = (i / n) * Math.PI * 2; const ring = i % 3 ? 0.28 : 0.16; return [W / 2 + Math.cos(a) * W * ring, H / 2 + Math.sin(a) * W * ring]; };
    for (let i = 0; i < n; i++) {
      const sx = ((i * 7919) % 997) / 997 * W, sy = ((i * 104729) % 991) / 991 * H; const [tx, ty] = mark(i); const p = seg(0.1 + (i % 20) / 100, 0.8);
      x.fillStyle = 'hsl(' + (150 + (i % 40)) + ',60%,' + (45 + 20 * p) + '%)'; x.beginPath(); x.arc(sx + (tx - sx) * p, sy + (ty - sy) * p, 3 + 2 * p, 0, 7); x.fill();
    }
  } else if (name === 'outfit') {
    x.fillStyle = '#efe7dc'; x.fillRect(0, 0, W, H);
    const p = seg(0.15, 0.85); const hue = 20 + 180 * p;
    x.fillStyle = '#d9b99b'; x.beginPath(); x.arc(W / 2, H * 0.2, W * 0.08, 0, 7); x.fill();
    x.fillStyle = 'hsl(' + hue + ',45%,40%)'; x.beginPath(); x.moveTo(W * (0.36 - 0.06 * p), H * 0.3); x.lineTo(W * (0.64 + 0.06 * p), H * 0.3); x.lineTo(W * (0.6 + 0.16 * p), H * (0.62 + 0.25 * p)); x.lineTo(W * (0.4 - 0.16 * p), H * (0.62 + 0.25 * p)); x.closePath(); x.fill();
  } else if (name === 'building') {
    const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#9fb8cf'); sky.addColorStop(1, '#e7e2d6'); x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = '#6d6a63'; x.fillRect(0, H * 0.86, W, H * 0.14);
    const floors = Math.floor(12 * k + 0.0001), part = 12 * k - floors;
    for (let f = 0; f <= floors && f < 12; f++) { const h = f < floors ? 1 : part; x.fillStyle = f % 2 ? '#8a7f70' : '#9a8f80'; x.fillRect(W * 0.3, H * 0.86 - (f + h) * H * 0.06, W * 0.4, h * H * 0.06); }
    x.strokeStyle = '#d0a020'; x.lineWidth = 4; x.beginPath(); x.moveTo(W * 0.78, H * 0.86); x.lineTo(W * 0.78, H * 0.08); x.lineTo(W * 0.2, H * 0.08); x.stroke();
  } else if (name === 'product') {
    x.fillStyle = '#e9ecef'; x.fillRect(0, 0, W, H);
    const parts = [[0.5, 0.62, 0.36, 0.08, '#30343b'], [0.5, 0.5, 0.3, 0.16, '#a7adb5'], [0.5, 0.36, 0.22, 0.1, '#5a6270'], [0.62, 0.28, 0.05, 0.06, '#c0392b']];
    parts.forEach(([px, py, pw, ph, col], i) => { const p = seg(i * 0.22, i * 0.22 + 0.3); x.fillStyle = col; x.fillRect(W * (px - pw / 2), H * (py - ph / 2) - (1 - p) * H * 0.5, W * pw, H * ph); });
  } else if (name === 'journey') {
    const bands = [['#1f4e5f', '#e0c48a'], ['#3d6b3a', '#c9d6a0'], ['#7a4a2a', '#e8b07a'], ['#2b2f4a', '#a9b4e0']];
    const pos = k * (bands.length - 1), i = Math.floor(pos), f = pos - i;
    const [a1, b1] = bands[i], [a2, b2] = bands[Math.min(bands.length - 1, i + 1)];
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, b1); g.addColorStop(1, a1); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.globalAlpha = f; const g2 = x.createLinearGradient(0, 0, 0, H); g2.addColorStop(0, b2); g2.addColorStop(1, a2); x.fillStyle = g2; x.fillRect(0, 0, W, H); x.globalAlpha = 1;
    for (let m = 0; m < 6; m++) { const mx = ((m * 0.23 - k * 1.8) % 1.2 + 1.2) % 1.2 - 0.1; x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.moveTo(W * (mx - 0.15), H * 0.85); x.lineTo(W * mx, H * (0.45 + 0.05 * (m % 3))); x.lineTo(W * (mx + 0.15), H * 0.85); x.fill(); }
  }
  if (opts.grain) { const img = x.getImageData(0, 0, W, H); const p = img.data; let s = index * 2654435761 >>> 0; for (let i = 0; i < p.length; i += 4) { s = (s * 1664525 + 1013904223) >>> 0; const n = (s >>> 24) - 128; p[i] += n * opts.grain; p[i + 1] += n * opts.grain; p[i + 2] += n * opts.grain; } x.putImageData(img, 0, 0); }
  // Time code: 12 bits of frame index and a 4-bit check, white = 1.
  const C = opts.code, bw = Math.floor(W * C.w / C.bits), bh = Math.max(C.minH, Math.round(H * C.h)), x0 = Math.round(W * C.x), y0 = Math.round(H * C.y);
  x.fillStyle = '#000'; x.fillRect(x0 - 4, y0 - 4, bw * C.bits + 8, bh + 8);
  const word = (index & 4095) << 4 | ((index * 7 + 3) & 15);
  for (let b = 0; b < C.bits; b++) { x.fillStyle = (word >> (C.bits - 1 - b)) & 1 ? '#fff' : '#000'; x.fillRect(x0 + b * bw, y0, bw, bh); }
  return c.toDataURL('image/jpeg', 0.92);
};`;

// Source for the page: reads the code from a video, an image or a canvas source.
export const READ_FRAME = `
window.__readFrame = function (section) {
  const e = section.scrollVideo; if (!e) return null;
  const src = e.render === 'frames' ? e.loaded[e.drawn] : e.video;
  if (!src) return null;
  const W = src.videoWidth || src.naturalWidth, H = src.videoHeight || src.naturalHeight;
  if (!W) return null;
  const C = ${JSON.stringify(CODE)};
  window.__rf ??= document.createElement('canvas');
  const c = window.__rf; c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, W, H);
  const bw = W * C.w / C.bits, bh = Math.max(C.minH * H / (e.cfg.video.height || H), H * C.h), x0 = W * C.x, y0 = H * C.y;
  let word = 0;
  for (let b = 0; b < C.bits; b++) {
    const px = x.getImageData(Math.round(x0 + b * bw + bw * 0.3), Math.round(y0 + bh * 0.3), Math.max(1, Math.round(bw * 0.4)), Math.max(1, Math.round(bh * 0.4))).data;
    let sum = 0; for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    word = (word << 1) | (sum / (px.length / 4) / 3 > 128 ? 1 : 0);
  }
  const index = word >> 4;
  if ((word & 15) !== ((index * 7 + 3) & 15)) return false;
  return index / (e.cfg.video.fps || 30);
};`;

const HASH = createHash('sha1').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0, 10);
export const FIXTURE_DIR = join(tmpdir(), 'forge-scroll-video-fixtures', HASH);

// makeVideos(browser, names?) => { dir, files: { name: path }, ffmpeg }
export async function makeVideos(browser, names = Object.keys(CONCEPTS)) {
  const ffmpeg = findFfmpeg();
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const files = Object.fromEntries(names.map((n) => [n, join(FIXTURE_DIR, `${n}.webm`)]));
  const missing = names.filter((n) => !existsSync(files[n]) || statSync(files[n]).size < 1000);
  if (!missing.length) return { dir: FIXTURE_DIR, files, ffmpeg };
  if (!ffmpeg) throw new Error('No ffmpeg with VP9: install ffmpeg or run npx playwright install chromium in tools/ (it brings one).');
  const page = await browser.newPage();
  try {
    await page.setContent('<canvas></canvas>');
    await page.addScriptTag({ content: DRAW });
    for (const name of missing) {
      const c = CONCEPTS[name];
      const out = `${files[name]}.part.webm`;
      const proc = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(c.fps), '-i', 'pipe:0', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-g', String(c.gop), '-keyint_min', String(Math.min(c.gop, 300)), '-deadline', 'realtime', '-cpu-used', '8', '-crf', String(c.crf ?? 32), '-b:v', '0', '-an', out]);
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d));
      const done = new Promise((res, rej) => proc.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`)))));
      const count = Math.round(c.durationS * c.fps);
      for (let i = 0; i < count; i += 12) {
        const urls = await page.evaluate(
          ({ name, c, from, to, code }) => {
            const out = [];
            for (let i = from; i < to; i++) out.push(window.drawFrame(c.draw ?? name, i / c.fps, c.durationS, c.width, c.height, i, { grain: c.grain, code }));
            return out;
          },
          { name, c, from: i, to: Math.min(count, i + 12), code: CODE },
        );
        for (const u of urls) if (!proc.stdin.write(Buffer.from(u.split(',')[1], 'base64'))) await new Promise((r) => proc.stdin.once('drain', r));
      }
      proc.stdin.end();
      await done;
      renameSync(out, files[name]);
    }
  } finally {
    await page.close();
  }
  return { dir: FIXTURE_DIR, files, ffmpeg };
}

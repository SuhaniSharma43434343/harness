import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { serveSite } from '../gates/serve.mjs';
import { toolAvailable } from '../media/video.mjs';
import { loadTool } from '../tools/load.mjs';

// Pictures from a video: the poster, one still per scene (to check the markers by eye) and an
// optional frame sequence for the frames renderer. A system ffmpeg is used when there is one;
// otherwise the browser decodes the clip and draws each frame to a canvas. Playwright's own
// Chromium has no H.264 decoder, so an MP4 falls back to the installed Edge or Chrome.

const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export function pictureTool({ prefer } = {}) {
  if (prefer === 'browser') return 'browser';
  return toolAvailable('ffmpeg') ? 'ffmpeg' : 'browser';
}

// grab(file, times, { width, format, quality }) => [{ t, data: Buffer }], width, height
async function grabInBrowser(file, times, { width = null, format = 'image/webp', quality = 0.82 } = {}) {
  const { chromium } = await loadTool('playwright');
  const server = await serveSite(dirname(file));
  const src = '/' + encodeURIComponent(basename(file));
  const errors = [];
  try {
    for (const launch of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
      let browser;
      try {
        browser = await chromium.launch(launch);
      } catch (err) {
        errors.push(`${launch.channel ?? 'chromium'}: ${err.message.split('\n')[0]}`);
        continue;
      }
      try {
        const page = await browser.newPage();
        await page.goto(server.url + '/', { waitUntil: 'domcontentloaded' });
        const out = [];
        let size = null;
        for (let i = 0; i < times.length; i += 24) {
          const r = await page.evaluate(
            async ({ src, times, width, format, quality }) => {
              let v = document.querySelector('video');
              if (!v) {
                v = document.createElement('video');
                v.muted = true;
                v.preload = 'auto';
                v.src = src;
                document.body.append(v);
                await new Promise((res, rej) => {
                  v.onloadeddata = res;
                  v.onerror = () => rej(new Error(`the browser cannot decode this video (error ${v.error?.code})`));
                });
              }
              const w = width || v.videoWidth;
              const h = Math.round((w * v.videoHeight) / v.videoWidth / 2) * 2;
              const c = document.createElement('canvas');
              c.width = w;
              c.height = h;
              const ctx = c.getContext('2d');
              const pics = [];
              for (const t of times) {
                await new Promise((res) => {
                  v.onseeked = res;
                  v.currentTime = Math.min(t + 0.001, v.duration - 0.001);
                });
                ctx.drawImage(v, 0, 0, w, h);
                pics.push(c.toDataURL(format, quality));
              }
              return { pics, width: w, height: h };
            },
            { src, times: times.slice(i, i + 24), width, format, quality },
          );
          size = { width: r.width, height: r.height };
          for (const [k, url] of r.pics.entries()) out.push({ t: times[i + k], data: Buffer.from(url.split(',')[1], 'base64') });
        }
        return { pictures: out, ...size };
      } catch (err) {
        errors.push(`${launch.channel ?? 'chromium'}: ${err.message.split('\n')[0]}`);
      } finally {
        await browser.close();
      }
    }
    throw new Error(`Could not read frames from ${basename(file)}: ${errors.join('; ')}. Install ffmpeg (winget install Gyan.FFmpeg) or supply a WebM.`);
  } finally {
    await server.close();
  }
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? r.error?.message ?? '').slice(-300)}`);
}

// stillsAt(file, times, outFiles, { width, tool }) => [{ t, file }]. Writes one picture per time.
export async function stillsAt(file, times, outFiles, { width = 1600, tool = pictureTool() } = {}) {
  for (const f of outFiles) mkdirSync(dirname(f), { recursive: true });
  if (tool === 'ffmpeg') {
    times.forEach((t, i) => ffmpeg(['-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, outFiles[i]]));
    return times.map((t, i) => ({ t, file: outFiles[i] }));
  }
  const format = MIME[extname(outFiles[0]).toLowerCase()] ?? 'image/webp';
  const { pictures, width: w, height: h } = await grabInBrowser(file, times, { width, format });
  pictures.forEach((p, i) => writeFileSync(outFiles[i], p.data));
  return pictures.map((p, i) => ({ t: p.t, file: outFiles[i], width: w, height: h }));
}

// makePoster(file, outFile, { at, width }) => { file, width, height }
export async function makePoster(file, outFile, { at = 0, width = 1600, tool } = {}) {
  const [r] = await stillsAt(file, [at], [outFile], { width, tool });
  return r;
}

// extractFrames(file, outDir, { durationS, fps, width, format }) => { pattern, count, fps, width, height, bytes }
// Frames are numbered from 1 (frame-0001.webp), as the frames renderer and ffmpeg expect.
export async function extractFrames(file, outDir, { durationS, fps = 12, width = 960, ext = 'webp', tool = pictureTool() } = {}) {
  mkdirSync(outDir, { recursive: true });
  if (tool === 'ffmpeg') {
    ffmpeg(['-y', '-i', file, '-vf', `fps=${fps},scale=${width}:-2`, ...(ext === 'jpg' ? ['-q:v', '4'] : []), join(outDir, `frame-%04d.${ext}`)]);
  } else {
    if (!(durationS > 0)) throw new Error('extractFrames needs the clip duration.');
    const count = Math.floor(durationS * fps + 1e-6) + 1;
    const times = Array.from({ length: count }, (_, i) => Math.min(i / fps, durationS - 0.01));
    const { pictures } = await grabInBrowser(file, times, { width, format: MIME[`.${ext}`] });
    pictures.forEach((p, i) => writeFileSync(join(outDir, `frame-${String(i + 1).padStart(4, '0')}.${ext}`), p.data));
  }
  const files = readdirSync(outDir).filter((f) => /^frame-\d{4}\./.test(f)).sort();
  if (!files.length) throw new Error('No frames were written.');
  const bytes = files.reduce((sum, f) => sum + statSync(join(outDir, f)).size, 0);
  return { count: files.length, fps, width, files, bytes, ext };
}

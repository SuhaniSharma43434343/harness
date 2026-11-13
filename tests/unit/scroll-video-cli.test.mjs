// forge scroll-video, end to end on a project (T4): new -> storyboard -> prompts -> add-video ->
// replace -> check, with synthetic MP4 and WebM files (no browser, no encoder). Also the byte
// ranges the static server now answers, and the prebuild pulling configs into the site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdScrollVideo } from '../../src/cli/scroll-video.mjs';
import { createProject } from '../../src/core/project.mjs';
import { serveSite } from '../../src/gates/serve.mjs';
import { configFromPrepared } from '../../src/scroll-video/project.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { newProject } from './helpers.mjs';
import { mp4, webm } from './scroll-video-media.mjs';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'forge-sv-cli-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const workspace = join(root, 'ws');
  mkdirSync(workspace);
  createProject('demo', { workspace });
  const files = join(root, 'in');
  mkdirSync(files);
  const put = (name, buf) => (writeFileSync(join(files, name), buf), join(files, name));
  return { root, dir: join(workspace, 'demo'), put };
}

// Runs the command, capturing what it prints.
async function run(root, ...args) {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try {
    const code = await cmdScrollVideo(root, args);
    return { code, out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = err;
  }
}
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('scroll-video: new, storyboard, prompts, add-video, replace and check, inside the project only', async () => {
  const { root, dir, put } = setup();
  const cfgFile = join(dir, 'design/scroll-video/chair.json');

  let r = await run(root, 'new', 'demo', 'chair', '--beats', '3', '--layout', 'product', '--duration', '9');
  assert.equal(r.code, 0, r.out);
  assert.equal(read(cfgFile).layout.type, 'product');
  await assert.rejects(() => cmdScrollVideo(root, ['new', 'demo', 'chair']), /already exists/);

  r = await run(root, 'check', 'demo', 'chair');
  assert.equal(r.code, 1, 'TODO text and no video');
  assert.match(r.out, /placeholder/);

  // The Creative Director writes the storyboard; prompts come from it.
  const c = read(cfgFile);
  c.storyboard = { durationS: 9, aspectRatio: '16:9', subject: 'a wooden chair', setting: 'a workshop', style: { camera: 'slow orbit', lighting: 'window light', mood: 'calm' }, beats: [{ id: 'legs', action: 'Legs stand', durationS: 3, message: 'Turned by hand' }, { id: 'seat', action: 'The seat drops on', durationS: 3, message: 'Woven seat' }, { id: 'oil', action: 'Oil darkens the grain', durationS: 3, message: 'Finished in oil' }] };
  writeFileSync(cfgFile, JSON.stringify(c));
  r = await run(root, 'prompts', 'demo', 'chair');
  assert.equal(r.code, 0, r.out);
  assert.match(read(cfgFile).prompts.master, /From 3 to 6 s: The seat drops on/);
  assert.ok(existsSync(join(dir, 'design/scroll-video/chair-prompts.md')));

  // The generated clip is 6 s, not the planned 9: the scenes are retimed from the storyboard.
  const clip = put('chair final.mp4', mp4({ fps: 24, frames: 144, keyEvery: 4 }));
  const poster = put('poster.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  r = await run(root, 'add-video', 'demo', 'chair', '--video', clip, '--poster', poster, '--poster-alt', 'A finished chair', '--tool', 'Example generator');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /registered as uncertain/);
  let cfg = read(cfgFile);
  assert.deepEqual([cfg.video.durationS, cfg.video.width, cfg.video.aspectRatio, cfg.video.fps, cfg.video.keyframeIntervalS], [6, 1920, '16:9', 24, 0.167]);
  assert.deepEqual(cfg.scenes.map((s) => [s.id, s.start, s.end, s.title]), [['legs', 0, 2, 'Turned by hand'], ['seat', 2, 4, 'Woven seat'], ['oil', 4, 6, 'Finished in oil']]);
  assert.deepEqual(cfg.video.sources.map((s) => s.src), ['/video/chair.mp4']);
  assert.equal(cfg.video.poster.src, '/video/chair-poster.jpg');
  assert.ok(existsSync(join(dir, 'assets/public/video/chair.mp4')));
  assert.equal(cfg.video.origin.tool, 'Example generator');
  let reg = read(join(dir, 'assets/register.json')).assets;
  assert.deepEqual(reg.map((x) => [x.path, x.status]), [['video/chair.mp4', 'uncertain'], ['video/chair-poster.jpg', 'uncertain']]);
  assert.ok(existsSync(join(dir, 'design/scroll-video/chair.report.json')));

  r = await run(root, 'check', 'demo', 'chair', '--json');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out)[0].findings.map((f) => f.id), ['one-format']);

  // Replace with a 9 s WebM plus a phone cut, stretching the scenes; the old MP4 goes.
  const wide = put('v2.webm', webm({ width: 1920, height: 1080, fps: 25, frames: 225, keyEvery: 5 }));
  const tall = put('v2-phone.webm', webm({ width: 1080, height: 1920, fps: 25, frames: 225, keyEvery: 5 }));
  r = await run(root, 'add-video', 'demo', 'chair', '--video', wide, '--video', tall, '--media', '(max-width: 47.99em)', '--poster', poster, '--licence', 'Client owns the generated output', '--rescale');
  assert.equal(r.code, 0, r.out);
  cfg = read(cfgFile);
  assert.deepEqual(cfg.scenes.map((s) => [s.start, s.end]), [[0, 3], [3, 6], [6, 9]]);
  assert.deepEqual(cfg.video.sources.map((s) => [s.src, s.media ?? null]), [['/video/chair-2.webm', '(max-width: 47.99em)'], ['/video/chair.webm', null]]);
  assert.equal(cfg.video.poster.alt, 'A finished chair', 'the alt text survives a replacement');
  assert.ok(!existsSync(join(dir, 'assets/public/video/chair.mp4')), 'the replaced file is removed');
  reg = read(join(dir, 'assets/register.json')).assets;
  assert.ok(reg.filter((x) => x.path.startsWith('video/chair')).some((x) => x.status === 'cleared'));

  // A length mismatch between cuts and an unusable file are refused.
  const short = put('short.webm', webm({ frames: 50 }));
  await assert.rejects(() => cmdScrollVideo(root, ['add-video', 'demo', 'chair', '--video', wide, '--video', short, '--media', '(max-width: 40em)', '--poster', poster]), /same length/);
  const prores = put('master.mov', mp4({ codec: 'apcn' }));
  await assert.rejects(() => cmdScrollVideo(root, ['add-video', 'demo', 'chair', '--video', prores, '--poster', poster]), /prores/);

  r = await run(root, 'probe', prores);
  assert.equal(r.code, 1);
  assert.match(r.out, /REFUSED/);
  r = await run(root, 'probe', clip, '--json');
  assert.equal(JSON.parse(r.out).probe.durationS, 6);
  assert.equal((await run(root, 'layouts')).code, 0);
  assert.equal((await run(root, 'nonsense')).code, 2);
  assert.equal((await run(root, 'check')).code, 2);

  const notes = readFileSync(join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.data?.event === 'scroll_video');
  assert.deepEqual(notes.map((n) => n.data.action), ['new', 'prompts', 'add-video', 'replace-video']);
});

test('the media step turns a prepared scroll-scrub clip into a config', () => {
  const { dir } = setup();
  mkdirSync(join(dir, 'assets/public/video'), { recursive: true });
  writeFileSync(join(dir, 'assets/public/video/brew.webm'), webm({ fps: 24, frames: 192, keyEvery: 5 }));
  writeFileSync(join(dir, 'assets/public/video/brew.mp4'), mp4({ fps: 24, frames: 192, keyEvery: 5 }));
  const cfg = configFromPrepared(dir, 'brew', { webm: 'video/brew.webm', mp4: 'video/brew.mp4', poster: 'video/brew-poster.webp' });
  assert.equal(cfg.video.durationS, 8);
  assert.deepEqual(cfg.video.sources.map((s) => s.type), ['video/webm', 'video/mp4']);
  assert.equal(cfg.scenes.length, 5);
  assert.ok(existsSync(join(dir, 'design/scroll-video/brew.json')));
});

test('the static server answers byte ranges for media, as a host does, and still gzips text', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'forge-sv-serve-'));
  const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
  writeFileSync(join(dist, 'clip.webm'), body);
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>x</title><p>hello</p>');
  const server = await serveSite(dist);
  try {
    const part = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=100-199' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000');
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), body.subarray(100, 200));
    const tail = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=-10' } });
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), body.subarray(990));
    const open = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=900-' } });
    assert.equal(open.headers.get('content-range'), 'bytes 900-999/1000');
    await open.arrayBuffer();
    const bad = await fetch(`${server.url}/clip.webm`, { headers: { Range: 'bytes=5000-' } });
    assert.equal(bad.status, 416);
    const whole = await fetch(`${server.url}/clip.webm`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal((await whole.arrayBuffer()).byteLength, 1000);
    const html = await fetch(`${server.url}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.match(await html.text(), /hello/);
  } finally {
    await server.close();
  }
});

test('the prebuild pulls scroll video configs into the site, and leaves reports out', () => {
  const { project, opts } = newProject('sv-prebuild');
  const brief = JSON.parse(readFileSync(new URL('../../samples/briefs/launch.json', import.meta.url), 'utf8'));
  const { siteDir } = scaffoldSite(project, { brief: { ...brief, project }, ...opts });
  const designDir = join(siteDir, '..', 'design', 'scroll-video');
  mkdirSync(designDir, { recursive: true });
  writeFileSync(join(designDir, 'story.json'), '{"id":"story"}');
  writeFileSync(join(designDir, 'story.report.json'), '{}');
  writeFileSync(join(designDir, 'story-prompts.md'), '# prompts');
  const r = spawnSync(process.execPath, [join(siteDir, 'scripts', 'sync-content.mjs')], { cwd: siteDir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const data = join(siteDir, 'src', 'data', 'scroll-video');
  assert.ok(existsSync(join(data, 'story.json')));
  assert.ok(!existsSync(join(data, 'story.report.json')));
  assert.ok(!existsSync(join(data, 'story-prompts.md')));
});

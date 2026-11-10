// 3D and video: the fit check, the three free models, the operator's own files, video placement,
// and the contracts that make the plan use what the operator chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaAcceptance } from '../../src/core/planner.mjs';
import { assessMedia } from '../../src/media/fit.mjs';
import { checkOwnModel, downloadModel, packGlb, rankModels, searchModels } from '../../src/media/models.mjs';
import { readDecision, runMediaStep } from '../../src/media/step.mjs';
import { placeVideo } from '../../src/media/video.mjs';
import { loadIndustries } from '../../src/registry/industries.mjs';
import { newProject } from './helpers.mjs';

const industries = loadIndustries();
const cafe = industries.find((p) => p.id === 'restaurant-cafe');
const clinic = industries.find((p) => p.id === 'healthcare-clinic');
const brief = (extra = {}) => ({ client: { name: 'Chai Bistro', industry: 'a warm cosy cafe' }, brand: { tone: ['warm', 'playful'], motionIntensity: 2 }, constraints: { deviceFloor: 'mid' }, business: { primaryConversion: { id: 'book-table', label: 'Book a table', kind: 'booking' } }, ...extra });

test('fit: a cafe is offered 3D as possible and a hero video; a clinic is told 3D does not suit it; a low device floor stops both', () => {
  const c = assessMedia(brief(), cafe);
  assert.equal(c.threeD.class, 'possible', 'the cafe playbook rates a 3D object as possible, and the main action is protected');
  const strong = assessMedia(brief(), { ...cafe, extras: [{ id: '3d-object', fit: 'strong', note: 'One signature product is the whole pitch.' }] });
  assert.equal(strong.threeD.class, 'recommended');
  assert.ok(c.threeD.reasons.some((r) => /below the hero/.test(r)), 'the main action is protected');
  assert.equal(c.video.need, 'clip');
  assert.equal(c.video.slots[0].role, 'hero-loop');
  const k = assessMedia(brief({ brand: { tone: ['clinical'], motionIntensity: 1 } }), industries.find((p) => p.id === 'professional-services'));
  assert.equal(k.threeD.class, 'not-recommended');
  assert.equal(k.video.need, 'none');
  const low = assessMedia(brief({ constraints: { deviceFloor: 'low' } }), cafe);
  assert.equal(low.threeD.fit, 0);
  assert.equal(low.video.need, 'none');
  assert.equal(assessMedia(brief({ brand: { tone: ['warm'], motionIntensity: 0 } }), cafe).video.need, 'none');
});

const CATALOGUE = {
  croissant: { type: 2, name: 'Croissant', tags: ['bread', 'pastry'], categories: ['food'], polycount: 1990, authors: { Someone: 'All' } },
  tea_set_01: { type: 2, name: 'Tea Set 01', tags: ['tea', 'teapot'], categories: ['kitchen'], polycount: 40296, authors: { Other: 'All' } },
  heavy_cup: { type: 2, name: 'Cup', tags: ['cup'], categories: ['kitchen'], polycount: 900000, authors: {} },
  coffee_table: { type: 2, name: 'Coffee Table', tags: ['coffee'], categories: ['furniture'], polycount: 4000, authors: {} },
  hdri: { type: 0, name: 'Cup HDRI', tags: ['cup'], categories: [], polycount: 0 },
};

test('three free models: relevant ones, under the triangle ceiling, no furniture for a cafe, models only', () => {
  const r = rankModels(CATALOGUE, ['cup', 'tea', 'pastry'], { avoid: ['furniture'] });
  assert.deepEqual(r.map((c) => c.id).sort(), ['croissant', 'tea_set_01']);
  assert.ok(r.every((c) => c.licence === 'CC0' && c.url.startsWith('https://polyhaven.com/a/')));
});

test('glb packing folds a glTF with a separate .bin and image into one valid file', () => {
  const gltf = { asset: { version: '2.0' }, buffers: [{ uri: 'a.bin', byteLength: 8 }], bufferViews: [{ buffer: 0, byteLength: 8 }], images: [{ uri: 'tex.jpg' }] };
  const glb = packGlb(gltf, (uri) => (uri === 'a.bin' ? Buffer.alloc(8, 1) : Buffer.from([0xff, 0xd8, 0xff, 0xd9])));
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(8), glb.length);
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString().trim());
  assert.equal(json.images[0].uri, undefined);
  assert.equal(json.images[0].bufferView, 1);
  assert.equal(json.images[0].mimeType, 'image/jpeg');
  assert.equal(json.buffers.length, 1);
});

function fakeFetch() {
  const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'm.bin', byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }] });
  const files = (id) => ({ gltf: { '1k': { gltf: { url: `https://dl/${id}.gltf`, size: gltf.length, include: { 'm.bin': { url: `https://dl/${id}.bin`, size: 4 } } } } } });
  const ok = (body) => ({ ok: true, json: async () => body, arrayBuffer: async () => Buffer.from(Buffer.isBuffer(body) ? body : typeof body === 'string' ? body : JSON.stringify(body)) });
  return async (url) => {
    if (url.endsWith('/assets?t=models')) return ok(CATALOGUE);
    const f = url.match(/\/files\/(\w+)$/);
    if (f) return ok(files(f[1]));
    if (url.endsWith('.gltf')) return ok(gltf);
    if (url.endsWith('.bin')) return ok(Buffer.alloc(4, 7));
    if (url.includes('cdn.polyhaven.com')) return ok(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { ok: false, status: 404 };
  };
}

test('search offers up to three that fit the budget; download folds one into a .glb with a poster', async () => {
  const found = await searchModels(['cup', 'tea', 'pastry'], { fetch: fakeFetch(), avoid: ['furniture'] });
  assert.deepEqual(found.map((c) => c.id).sort(), ['croissant', 'tea_set_01']);
  const dir = mkdtempSync(join(tmpdir(), 'forge-model-'));
  const got = await downloadModel(found.find((c) => c.id === 'croissant'), dir, { fetch: fakeFetch() });
  assert.equal(got.path, 'models/croissant.glb');
  assert.ok(existsSync(join(dir, got.path)) && existsSync(join(dir, got.poster)));
  assert.equal(checkOwnModel(join(dir, got.path)).ok, true);
  assert.match(checkOwnModel(join(dir, 'nope.glb')).reason, /no file/i);
  writeFileSync(join(dir, 'x.obj'), 'o');
  assert.match(checkOwnModel(join(dir, 'x.obj')).reason, /\.glb/);
});

test('video placement: a short wide clip is a hero loop, a long one a tap-to-play story, an upright one a framed block', () => {
  const info = (o) => ({ durationS: 8, width: 1920, height: 1080, hasAudio: false, bytes: 5e6, ...o });
  const hero = placeVideo(info(), brief());
  assert.equal(hero.role, 'hero-loop');
  assert.match(hero.reasons.join(' '), /Book a table/);
  const story = placeVideo(info({ durationS: 40 }), brief());
  assert.equal(story.role, 'story-clip');
  assert.match(story.reasons.join(' '), /never sits behind the headline/);
  assert.equal(placeVideo(info({ width: 1080, height: 1920 }), brief()).role, 'story-clip');
  assert.match(placeVideo(info({ durationS: 120 }), brief()).warnings.join(' '), /Trim/);
  const forced = placeVideo(info({ durationS: 30 }), brief(), { role: 'hero-loop' });
  assert.equal(forced.role, 'hero-loop');
  assert.match(forced.warnings.join(' '), /first 12 seconds/);
  assert.match(placeVideo(info({ hasAudio: true, width: 800, height: 450 }), brief()).warnings.join(' '), /only 800 px wide/);
});

function projectWithBrief() {
  const { project, workspace } = newProject('demo');
  const dir = join(workspace, project);
  mkdirSync(join(dir, 'intake'), { recursive: true });
  const b = { schemaVersion: '0.1.0', status: 'ready', project, projectType: 'business', tier: 'M', client: { name: 'Chai Bistro', industry: 'cafe' }, goals: [{ id: 'g', statement: 'Get bookings' }], audience: [{ segment: 'a', need: 'b' }], pages: [{ slug: '/', title: 'Home', purpose: 'Start here', cta: 'Book a table' }], brand: { tone: ['warm'], motionIntensity: 2 }, constraints: { deviceFloor: 'mid', accessibility: 'WCAG 2.2 AA' }, assumptions: [] };
  writeFileSync(join(dir, 'intake', 'brief.json'), JSON.stringify(b));
  return { project, workspace, dir, brief: b };
}

test('the media step never adds 3D without a yes; three are shown and nothing downloads before the pick', async () => {
  const p = projectWithBrief();
  const none = await runMediaStep(p.project, { workspace: p.workspace, brief: p.brief, playbook: cafe });
  assert.equal(none.decision.threeD.decision, 'skipped');
  assert.match(none.decision.threeD.reason, /never added without a yes/);
  assert.equal(JSON.parse(readFileSync(join(p.dir, 'intake', 'brief.json'), 'utf8')).media.threeD.decision, 'skipped');

  const q = projectWithBrief();
  const waiting = await runMediaStep(q.project, { workspace: q.workspace, brief: q.brief, playbook: cafe, flags: { threeD: 'yes' }, fetch: fakeFetch() });
  assert.equal(waiting.status, 'waiting');
  assert.deepEqual(waiting.needs.candidates.map((c) => c.id).sort(), ['croissant', 'tea_set_01']);
  assert.equal(readDecision(q.dir), null);
  assert.ok(!existsSync(join(q.dir, 'assets', 'public', 'models')));

  const done = await runMediaStep(q.project, { workspace: q.workspace, brief: q.brief, playbook: cafe, flags: { threeD: 'yes', model: 'croissant' }, fetch: fakeFetch() });
  assert.equal(done.decision.threeD.decision, 'chosen');
  assert.equal(done.decision.threeD.file, 'models/croissant.glb');
  assert.ok(existsSync(join(q.dir, 'assets', 'public', 'models', 'croissant.glb')));
  const reg = JSON.parse(readFileSync(join(q.dir, 'assets', 'register.json'), 'utf8')).assets;
  assert.ok(reg.some((r) => r.path === 'models/croissant.glb' && r.status === 'cleared' && /CC0/.test(r.licence)));
  assert.equal(JSON.parse(readFileSync(join(q.dir, 'intake', 'brief.json'), 'utf8')).media.threeD.id, 'croissant');
});

test('the forced path: an unsuitable fit is explained, and "continue without" is a recorded answer', async () => {
  const p = projectWithBrief();
  const decide = async (need) => (need.kind === 'media-3d' ? { action: 'skip', reason: 'The operator accepted our analysis: continue without 3D.' } : undefined);
  const r = await runMediaStep(p.project, { workspace: p.workspace, brief: p.brief, playbook: industries.find((x) => x.id === 'professional-services'), decide });
  assert.equal(r.decision.fit.threeD.class, 'not-recommended');
  assert.match(r.decision.threeD.reason, /accepted our analysis/);
});

test('the contracts make the plan use the chosen media: placed once, 3D never in the hero, a hero loop in the first section', () => {
  const media = {
    threeD: { decision: 'chosen', id: 'tea_set_01', title: 'Tea Set 01', creator: 'Other', licence: 'CC0', file: 'models/tea_set_01.glb', poster: 'models/tea_set_01-poster.png', concept: 'a teapot', position: 'on the home page, below the hero' },
    video: { decision: 'chosen', id: 'loop1', role: 'hero-loop', page: '/', section: 'hero', mp4: 'video/loop1.mp4', webm: 'video/loop1.webm', poster: 'video/loop1-poster.webp', source: 'Supplied by the client', licence: 'Supplied by the client' },
  };
  const b = brief({ media });
  assert.match(mediaAcceptance(b, 'section-plan').join(' '), /"model-tea-set-01".*never in the home hero/s);
  assert.match(mediaAcceptance(b, 'section-plan').join(' '), /"video-loop1" as a silent looping background/);
  assert.match(mediaAcceptance(b, 'asset-plan').join(' '), /kind "3d".*models\/tea_set_01\.glb/s);
  assert.match(mediaAcceptance(b, 'build').join(' '), /prefers-reduced-motion/);
  assert.deepEqual(mediaAcceptance(brief(), 'build'), [], 'nothing chosen, nothing added');
});

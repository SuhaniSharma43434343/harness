import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Free 3D models from Poly Haven (every asset is CC0, no credit needed; its API is for apps and
// its terms forbid scraping, so only the API is used). Search happens in code here, never in an
// agent, and nothing is downloaded until the operator has chosen one of the three.
const API = 'https://api.polyhaven.com';
const PREVIEW = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=512&height=512`;
export const MAX_MODEL_BYTES = 3 * 1024 * 1024;
export const MAX_TRIANGLES = 50000;

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'forge-harness (media search)' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}
async function getBuffer(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'forge-harness (media download)' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// rankModels(catalogue, terms, opts?) => up to `count` candidates, best first.
// Relevance: a search word in the title scores most, then tags, then categories. A model over the
// triangle ceiling is dropped. Poly Haven is all CC0, so the licence is always the best score.
export function rankModels(catalogue, terms, { count = 3, maxTriangles = MAX_TRIANGLES, avoid = [] } = {}) {
  const words = [...new Set(terms.map((t) => t.toLowerCase()))].filter(Boolean);
  const ranked = [];
  for (const [id, a] of Object.entries(catalogue)) {
    if (a.type !== 2) continue;
    if (a.polycount && a.polycount > maxTriangles) continue;
    if (avoid.length && (a.categories ?? []).some((c) => avoid.includes(c.toLowerCase()))) continue;
    const name = `${a.name} ${id}`.toLowerCase();
    const tags = (a.tags ?? []).join(' ').toLowerCase();
    const cats = (a.categories ?? []).join(' ').toLowerCase();
    let hits = 0;
    const matched = [];
    for (const w of words) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      if (re.test(name)) (hits += 1), matched.push(w);
      else if (re.test(tags)) (hits += 0.6), matched.push(w);
      else if (re.test(cats)) (hits += 0.4), matched.push(w);
    }
    if (!hits) continue;
    const relevance = Math.min(1, hits / 1.2);
    const tech = !a.polycount ? 0.5 : a.polycount <= 20000 ? 1 : 0.6;
    const score = Math.round((relevance * 0.5 + 0.3 + tech * 0.2) * 100) / 100;
    ranked.push({
      id,
      title: a.name,
      creator: Object.keys(a.authors ?? {}).join(', ') || 'Poly Haven',
      licence: 'CC0',
      source: 'polyhaven',
      url: `https://polyhaven.com/a/${id}`,
      polycount: a.polycount ?? null,
      previewImage: PREVIEW(id),
      tags: (a.tags ?? []).slice(0, 6),
      matched: [...new Set(matched)],
      score,
    });
  }
  return ranked.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, count);
}

// The download size of a model at one resolution: the glTF and every file it needs.
function downloadBytes(files, resolution) {
  const level = files.gltf?.[resolution] ?? files.gltf?.[Object.keys(files.gltf ?? {})[0]];
  const e = level?.gltf;
  if (!e) return Infinity;
  return (e.size ?? 0) + Object.values(e.include ?? {}).reduce((n, f) => n + (f.size ?? 0), 0);
}

// searchModels(terms, opts?) => up to 3 candidates that fit the 3 MB budget, best first.
export async function searchModels(terms, { fetch: fetchImpl = globalThis.fetch, count = 3, avoid = [], resolution = '1k' } = {}) {
  const catalogue = await getJson(`${API}/assets?t=models`, fetchImpl);
  const ranked = rankModels(catalogue, terms, { count: count * 3, avoid });
  const kept = [];
  for (const c of ranked) {
    if (kept.length >= count) break;
    try {
      const bytes = downloadBytes(await getJson(`${API}/files/${c.id}`, fetchImpl), resolution);
      if (bytes <= MAX_MODEL_BYTES) kept.push({ ...c, bytes });
    } catch {
      // a model whose file list cannot be read is not offered
    }
  }
  return kept;
}

const align4 = (n) => (n + 3) & ~3;

// packGlb(gltf, resolve) => Buffer. Folds a glTF with external .bin and image files into one
// binary GLB. resolve(uri) returns the file's bytes.
export function packGlb(gltf, resolve) {
  const json = structuredClone(gltf);
  const chunks = [];
  let offset = 0;
  const append = (buf) => {
    const start = offset;
    chunks.push(buf);
    offset += buf.length;
    const pad = align4(offset) - offset;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    return start;
  };
  const bufferStart = (json.buffers ?? []).map((b) => append(b.uri ? resolve(b.uri) : Buffer.alloc(b.byteLength)));
  for (const bv of json.bufferViews ?? []) {
    bv.byteOffset = (bv.byteOffset ?? 0) + bufferStart[bv.buffer];
    bv.buffer = 0;
  }
  json.bufferViews ??= [];
  for (const img of json.images ?? []) {
    if (!img.uri) continue;
    const data = resolve(img.uri);
    const start = append(data);
    json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: data.length });
    img.bufferView = json.bufferViews.length - 1;
    img.mimeType = /\.png$/i.test(img.uri) ? 'image/png' : 'image/jpeg';
    delete img.uri;
  }
  json.buffers = [{ byteLength: offset }];
  const bin = Buffer.concat(chunks);
  const jsonText = Buffer.from(JSON.stringify(json));
  const jsonPad = Buffer.concat([jsonText, Buffer.alloc(align4(jsonText.length) - jsonText.length, 0x20)]);
  const total = 12 + 8 + jsonPad.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonPad.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonPad.copy(out, 20);
  const binAt = 20 + jsonPad.length;
  out.writeUInt32LE(bin.length, binAt);
  out.writeUInt32LE(0x004e4942, binAt + 4);
  bin.copy(out, binAt + 8);
  return out;
}

// downloadModel(candidate, publicDir, opts?) => { file, path, poster, bytes }
// Fetches the glTF at the smallest resolution, folds it into one .glb in public/models/, and
// refuses anything over the 3 MB asset budget. The preview becomes the poster.
export async function downloadModel(candidate, publicDir, { fetch: fetchImpl = globalThis.fetch, resolution = '1k' } = {}) {
  const files = await getJson(`${API}/files/${candidate.id}`, fetchImpl);
  const level = files.gltf?.[resolution] ?? files.gltf?.[Object.keys(files.gltf ?? {})[0]];
  const entry = level?.gltf;
  if (!entry?.url) throw new Error(`${candidate.id} has no glTF download`);
  const gltf = JSON.parse((await getBuffer(entry.url, fetchImpl)).toString('utf8'));
  const include = entry.include ?? {};
  const cache = new Map();
  const wanted = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].map((x) => x.uri).filter(Boolean);
  for (const uri of wanted) {
    const hit = include[uri] ?? include[decodeURIComponent(uri)];
    if (!hit?.url) throw new Error(`${candidate.id}: ${uri} is not in the download`);
    cache.set(uri, await getBuffer(hit.url, fetchImpl));
  }
  const glb = packGlb(gltf, (uri) => cache.get(uri));
  if (glb.length > MAX_MODEL_BYTES) throw new Error(`${candidate.title} is ${(glb.length / 1048576).toFixed(1)} MB, over the 3 MB budget`);
  const dir = join(publicDir, 'models');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${candidate.id}.glb`);
  writeFileSync(file, glb);
  let poster = null;
  try {
    const png = await getBuffer(candidate.previewImage, fetchImpl);
    poster = join(dir, `${candidate.id}-poster.png`);
    writeFileSync(poster, png);
  } catch {
    poster = null;
  }
  return { file, path: `models/${candidate.id}.glb`, poster: poster ? `models/${candidate.id}-poster.png` : null, bytes: glb.length };
}

// A model the operator already has. Only .glb is taken as it is; anything else must be converted first.
export function checkOwnModel(file) {
  if (!existsSync(file)) return { ok: false, reason: `There is no file at ${file}` };
  if (!/\.glb$/i.test(file)) return { ok: false, reason: 'Only a .glb file can be used directly. Export your model as GLB (binary glTF) and try again.' };
  const bytes = statSync(file).size;
  if (bytes > MAX_MODEL_BYTES) return { ok: false, reason: `The model is ${(bytes / 1048576).toFixed(1)} MB; the limit is 3 MB. Compress it (meshopt or Draco, smaller textures).` };
  const head = readFileSync(file).subarray(0, 4).toString('latin1');
  if (head !== 'glTF') return { ok: false, reason: 'That file is not a valid GLB.' };
  return { ok: true, bytes };
}

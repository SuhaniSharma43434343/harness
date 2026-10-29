// Shared by the approach build tests (T19, T20): scaffold a sample brief, apply an approach
// module without a network install, and link the starter's dependencies plus the approach's
// packages (installed once into a cache folder) into the site.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { STARTER_DIR } from '../../src/site/tokens.mjs';
import { newProject } from '../unit/helpers.mjs';

export const STARTER_MODULES = join(STARTER_DIR, 'node_modules');
const SAMPLES = new URL('../../samples/briefs/', import.meta.url);

export const sampleBrief = (type) => JSON.parse(readFileSync(new URL(`${type}.json`, SAMPLES), 'utf8'));

// Why the approach build tests cannot run here, or false.
export function buildSkipReason() {
  if (process.env.FORGE_SKIP_BUILD_TESTS) return 'FORGE_SKIP_BUILD_TESTS is set';
  if (!existsSync(join(STARTER_MODULES, 'astro'))) return 'starter dependencies are not installed: run scripts/setup.sh';
  return false;
}

// Installs packages ([{ name, version }]) once into a cache folder and returns its
// node_modules, or throws when npm cannot install them (offline).
export function packageCache(packages) {
  if (!packages.length) return null;
  const specs = packages.map((p) => `${p.name}@${p.version}`).sort();
  const dir = join(tmpdir(), 'forge-approach-packages', createHash('sha1').update(specs.join(' ')).digest('hex').slice(0, 12));
  const modules = join(dir, 'node_modules');
  if (packages.every((p) => existsSync(join(modules, p.name, 'package.json')))) return modules;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"private":true}\n');
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--no-save', ...specs], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`npm could not install ${specs.join(', ')}: ${(r.stderr || r.error?.message || '').slice(-300)}`);
  return modules;
}

// site/node_modules: a link to each starter package, plus each approach package. Build caches
// (.astro, .vite) are not linked, so builds running at the same time never share one.
const CACHES = new Set(['.astro', '.vite', '.cache']);
export function linkModules(siteDir, extra = null, names = []) {
  const target = join(siteDir, 'node_modules');
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(STARTER_MODULES).filter((e) => !CACHES.has(e))) symlinkSync(join(STARTER_MODULES, entry), join(target, entry), 'junction');
  for (const name of names) {
    const scope = name.startsWith('@') ? name.split('/')[0] : null;
    if (scope) mkdirSync(join(target, scope), { recursive: true });
    symlinkSync(join(extra, name), join(target, name), 'junction');
  }
}

export function scaffold(type, brief = sampleBrief(type)) {
  const { project, opts } = newProject(brief.project);
  return { ...scaffoldSite(project, { brief, ...opts }), project, opts, brief };
}

// Inserts sections into a page's frontmatter, after the first section (the hero).
export function addSections(siteDir, slug, yaml) {
  const file = join(siteDir, 'src/content/pages', `${slug === '/' ? 'index' : slug.slice(1)}.md`);
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf('\n  - use:', text.indexOf('  - use:') + 1);
  const out = at === -1 ? text.replace(/\n---\n/, `\n${yaml}\n---\n`) : `${text.slice(0, at)}\n${yaml}${text.slice(at)}`;
  writeFileSync(file, out);
}

// A minimal binary glTF: one triangle. Enough to prove the loader path end to end.
export function tinyGlb() {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const bin = Buffer.from(positions.buffer);
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: bin.length }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }],
    }),
  );
  const pad = (b, c) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, c)]);
  const j = pad(json, 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, chunk(j, 0x4e4f534a), chunk(b, 0x004e4942)]);
}

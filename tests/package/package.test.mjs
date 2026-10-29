import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addTask } from '../../src/core/board.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { auditEntries, buildPackage, extractZip, forbiddenReason, packageFiles } from '../../src/core/package.mjs';
import { createProject } from '../../src/core/project.mjs';
import { upgrade } from '../../src/core/upgrade.mjs';
import { createZip, crc32, readZip } from '../../src/core/zip.mjs';
import { task } from '../unit/helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

test('the ZIP writer and reader round-trip files, modes and checksums', () => {
  const zip = createZip([
    { name: 'b.txt', data: Buffer.from('hello '.repeat(200)) },
    { name: 'forge', data: Buffer.from('#!/bin/sh\n'), mode: 0o755 },
    { name: 'img.bin', data: Buffer.from([0, 1, 2, 3]) },
  ]);
  const back = readZip(zip);
  assert.deepEqual(back.map((e) => e.name), ['b.txt', 'forge', 'img.bin']);
  assert.equal(back[0].data.toString(), 'hello '.repeat(200));
  assert.equal(back[1].mode, 0o755);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.deepEqual(createZip([{ name: 'a', data: Buffer.from('x') }]), createZip([{ name: 'a', data: Buffer.from('x') }]), 'the same files make the same archive');
});

test('the package holds the harness from the allow-list and nothing it must not', () => {
  const files = packageFiles(ROOT);
  for (const f of ['package.json', 'package-lock.json', 'forge', 'forge.cmd', '.env.example', 'src/cli/index.mjs', 'schemas/task.schema.json', 'agents/builder.md', 'CLAUDE.md', 'workspace/.gitkeep']) {
    assert.ok(files.includes(f), `${f} is packed`);
  }
  assert.deepEqual(files.filter((f) => forbiddenReason(f)), []);
  assert.ok(!files.some((f) => f.startsWith('dist/') || f.startsWith('node_modules/')));
});

test('forge package builds an archive that passes its own audit', () => {
  const out = tmp('forge-pkg-');
  const r = buildPackage({ root: ROOT, outDir: out, secrets: [] });
  assert.match(r.file, /forge-v\d+\.\d+\.\d+\.zip$/);
  const entries = readZip(readFileSync(r.file));
  const names = entries.map((e) => e.name);
  assert.ok(names.every((n) => n.startsWith(`forge-v${r.version}/`)), 'everything sits in one top folder');
  assert.ok(names.includes(`forge-v${r.version}/THIRD_PARTY_NOTICES.md`), 'dependency licences are listed');
  assert.match(entries.find((e) => e.name.endsWith('THIRD_PARTY_NOTICES.md')).data.toString(), /\| ajv \| \d/);
  assert.equal(entries.find((e) => e.name === `forge-v${r.version}/forge`).mode, 0o755, 'the launcher stays executable');
  assert.deepEqual(auditEntries(entries, { secrets: [], prefix: `forge-v${r.version}/` }), []);
});

test('the audit catches every kind of forbidden content, without printing secrets', () => {
  const entries = [
    { name: 'node_modules/x/index.js', data: Buffer.from('') },
    { name: '.env', data: Buffer.from('X=1') },
    { name: 'site/.env.local', data: Buffer.from('X=1') },
    { name: 'workspace/harbor-home/ledger.jsonl', data: Buffer.from('{}') },
    { name: '.git/HEAD', data: Buffer.from('ref') },
    { name: 'debug.log', data: Buffer.from('') },
    { name: 'forge.config.json', data: Buffer.from('{}') },
    { name: 'src/a.mjs', data: Buffer.from(`const t = "${GITHUB}";\n`) },
    // Built at runtime so this file holds no personal path itself.
    { name: 'docs/b.md', data: Buffer.from(`ok\nsee ${['C:', 'Users', 'asha', 'Downloads', 'x'].join('\\')}\n`) },
    { name: 'docs/c.md', data: Buffer.from(`home is ${['', 'home', 'ravi', 'work'].join('/')}\n`) },
    { name: 'docs/fine.md', data: Buffer.from('Extract to C:\\Users\\<you>\\tools or /home/<user>/tools.\n') },
    { name: '.env.example', data: Buffer.from('VERCEL_TOKEN=\n') },
  ];
  const found = auditEntries(entries, { secrets: [] });
  const ids = found.map((f) => `${f.file}:${f.id}`);
  for (const want of [
    'node_modules/x/index.js:node-modules',
    '.env:env-file',
    'site/.env.local:env-file',
    'workspace/harbor-home/ledger.jsonl:workspace-data',
    '.git/HEAD:git-history',
    'debug.log:log-file',
    'forge.config.json:local-config',
    'src/a.mjs:github-token',
    'docs/b.md:personal-path',
    'docs/c.md:personal-path',
  ]) {
    assert.ok(ids.includes(want), `missing ${want}`);
  }
  assert.ok(!ids.some((i) => i.startsWith('docs/fine.md') || i.startsWith('.env.example')), 'placeholders and .env.example are fine');
  assert.ok(!JSON.stringify(found).includes(GITHUB));
});

test('a package with a problem is refused and no archive is left behind', () => {
  const root = tmp('forge-src-');
  for (const f of ['VERSION', 'package.json']) cpSync(join(ROOT, f), join(root, f));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'leak.mjs'), `export const k = "${GITHUB}";\n`);
  const out = tmp('forge-out-');
  assert.throws(
    () => buildPackage({ root, outDir: out, secrets: [] }),
    (e) => e.code === 'SCHEMA_INVALID' && e.details.some((d) => d.file === 'src/leak.mjs' && d.id === 'github-token'),
  );
  assert.equal(existsSync(join(out, `forge-v${readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()}.zip`)), false);
});

test('an extracted package runs: the CLI answers from a fresh folder', () => {
  const r = buildPackage({ root: ROOT, outDir: tmp('forge-pkg-'), secrets: [] });
  const dest = tmp('forge-extract-');
  extractZip(r.file, dest);
  const home = join(dest, `forge-v${r.version}`);
  cpSync(join(ROOT, 'node_modules'), join(home, 'node_modules'), { recursive: true }); // stands in for npm ci
  const v = spawnSync(process.execPath, [join(home, 'src', 'cli', 'index.mjs'), '--version'], { encoding: 'utf8', cwd: home });
  assert.equal(v.stdout.trim(), r.version);
  const val = spawnSync(process.execPath, [join(home, 'src', 'cli', 'index.mjs'), 'validate', 'task', join(home, 'fixtures', 'schemas', 'valid', 'task.json')], { encoding: 'utf8', cwd: home });
  assert.equal(val.status, 0, val.stdout + val.stderr);
});

function harnessCopy() {
  const dir = tmp('forge-harness-');
  for (const f of ['VERSION']) cpSync(join(ROOT, f), join(dir, f));
  mkdirSync(join(dir, 'src', 'cli'), { recursive: true });
  writeFileSync(join(dir, 'src', 'cli', 'index.mjs'), '');
  mkdirSync(join(dir, 'workspace'));
  return dir;
}

test('upgrade copies .env, config and projects across, and checks every project', () => {
  const old = harnessCopy();
  writeFileSync(join(old, '.env'), 'VERCEL_TOKEN=x\n');
  writeFileSync(join(old, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {} }));
  createProject('harbor-home', { workspace: join(old, 'workspace') });
  addTask('harbor-home', task('hero'), { workspace: join(old, 'workspace') });
  const fresh = harnessCopy();

  const dry = upgrade({ from: old, root: fresh, dryRun: true });
  assert.deepEqual(dry.copy, ['.env', 'forge.config.json', 'workspace/harbor-home']);
  assert.deepEqual(dry.projects, { 'harbor-home': [] });
  assert.equal(existsSync(join(fresh, '.env')), false, 'a dry run changes nothing');

  const done = upgrade({ from: old, root: fresh });
  assert.equal(readFileSync(join(fresh, '.env'), 'utf8'), 'VERCEL_TOKEN=x\n');
  assert.ok(existsSync(join(fresh, 'workspace', 'harbor-home', 'board', 'hero.json')));
  assert.deepEqual(done.projects, { 'harbor-home': [] });
  assert.match(ledger.read('harbor-home', { workspace: join(fresh, 'workspace') }).at(-1).data.message, /^Upgraded from Forge/);

  assert.throws(() => upgrade({ from: old, root: fresh }), /already exist here/);
  assert.throws(() => upgrade({ from: tmp('forge-nope-'), root: fresh }), /is not a Forge folder/);
});

test('upgrade reports a project that no longer matches the schemas', () => {
  const old = harnessCopy();
  createProject('broken', { workspace: join(old, 'workspace') });
  const state = join(old, 'workspace', 'broken', 'project.json');
  writeFileSync(state, JSON.stringify({ ...JSON.parse(readFileSync(state, 'utf8')), phase: 'SHIPPED' }));
  const r = upgrade({ from: old, root: harnessCopy(), dryRun: true });
  assert.equal(r.projects.broken.length, 1);
});

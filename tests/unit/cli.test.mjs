import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion, runDoctor, versionAtLeast } from '../../src/cli/doctor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
const forge = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });

test('forge --help lists available and planned commands', () => {
  const r = forge('--help');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /Planned \(not built yet\)/);
});

test('forge --version prints the package version', () => {
  const r = forge('--version');
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('planned commands say they are not built yet instead of pretending', () => {
  const r = forge('run', 'demo');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /planned for milestone M3 and is not built yet/);
});

test('unknown commands exit 2', () => {
  assert.equal(forge('frobnicate').status, 2);
});

test('forge doctor --json reports every check', () => {
  const r = forge('doctor', '--json');
  const report = JSON.parse(r.stdout);
  const names = report.checks.map((c) => c.name);
  for (const n of ['Node.js', 'npm', 'Git', 'Claude Code', 'Config', '.env', 'Workspace', 'Plugins']) {
    assert.ok(names.includes(n), `missing check ${n}`);
  }
  assert.equal(r.status, report.ok ? 0 : 1);
});

test('missing Claude Code is a warning, not a failure', () => {
  const report = runDoctor(ROOT);
  const claude = report.checks.find((c) => c.name === 'Claude Code');
  assert.notEqual(claude.status, 'fail');
});

test('forge validate accepts valid fixtures and rejects invalid ones', () => {
  assert.equal(forge('validate', 'task', 'fixtures/schemas/valid/task.json').status, 0);
  assert.equal(forge('validate', 'ledgerEntry', 'fixtures/schemas/valid/ledger.jsonl').status, 0);
  const bad = forge('validate', 'task', 'fixtures/schemas/invalid/task-done-no-evidence.json');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /INVALID/);
});

test('version helpers compare correctly', () => {
  assert.deepEqual(parseVersion('git version 2.43.0'), [2, 43, 0]);
  assert.equal(versionAtLeast('22.1.0', '22.0.0'), true);
  assert.equal(versionAtLeast('2.39.9', '2.40.0'), false);
  assert.equal(versionAtLeast('10.9', '10.0.0'), true);
  assert.equal(versionAtLeast('garbage', '1.0.0'), false);
});

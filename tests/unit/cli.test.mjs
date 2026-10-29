import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion, runDoctor, versionAtLeast } from '../../src/cli/doctor.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
const forge = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ROOT });

test('forge --help lists the commands, and every command the plan names is built', () => {
  const r = forge('--help');
  assert.equal(r.status, 0);
  for (const c of ['doctor', 'new', 'intake', 'approve', 'run', 'status', 'resume', 'preview', 'deploy', 'report', 'plugins', 'task', 'test', 'demo', 'package', 'upgrade']) {
    assert.match(r.stdout, new RegExp(`^  ${c} `, 'm'), c);
  }
  assert.doesNotMatch(r.stdout, /Planned \(not built yet\)/);
});

test('forge --version prints the package version', () => {
  const r = forge('--version');
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
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

test('forge select explains the approach decision for a brief', () => {
  const r = forge('select', 'samples/briefs/flagship.json');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /APP-04 {2}yes .*\[needs B2\]/);
  assert.match(r.stdout, /APP-06 {2}no /);
  const json = JSON.parse(forge('select', 'samples/briefs/showroom.json', '--json').stdout);
  assert.deepEqual(json.decisions.filter((d) => d.selected).map((d) => d.approach), ['APP-01', 'APP-03']);
  assert.equal(forge('select').status, 2);
});

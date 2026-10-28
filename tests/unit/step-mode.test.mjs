import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdTask } from '../../src/cli/task.mjs';
import { addTask, getTask, saveTask } from '../../src/core/board.mjs';
import { PermissionDenied, Unavailable } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { installPreCommit, scanStaged } from '../../src/core/precommit.mjs';
import { advancePhase } from '../../src/core/project.mjs';
import { resume } from '../../src/core/recovery.mjs';
import { abandonTask, checkChanges, nextTask, submitTask } from '../../src/core/step.mjs';
import { newProject, passVerifier, task } from './helpers.mjs';

const pmTask = (id, over = {}) => task(id, { agent: 'project-manager', owns_files: [`intake/${id}.md`], ...over });

// A project in INTAKE, where the project-manager agent works.
function intakeProject(...tasks) {
  const p = newProject();
  advancePhase(p.project, 'INTAKE', p.opts);
  for (const t of tasks) addTask(p.project, t, p.opts);
  p.dir = join(p.opts.workspace, p.project);
  p.write = (rel, text = 'x\n') => {
    mkdirSync(join(p.dir, rel, '..'), { recursive: true });
    writeFileSync(join(p.dir, rel), text);
  };
  return p;
}

test('next hands out one contract at a time, in order, to an agent that works in the phase', () => {
  const { project, opts } = intakeProject(pmTask('brief'), pmTask('plan', { depends_on: ['brief'] }), task('hero'));
  const t = nextTask(project, opts);
  assert.equal(t.id, 'brief');
  assert.equal(t.status, 'running');
  assert.throws(() => nextTask(project, opts), (e) => e instanceof Unavailable && /still open/.test(e.message));
});

test('a submission inside the contract is verified and done, with the changed files as evidence', async () => {
  const p = intakeProject(pmTask('brief'));
  nextTask(p.project, p.opts);
  p.write('intake/brief.md', '# Brief\n');
  assert.deepEqual(checkChanges(p.project, 'brief', p.opts).refused, []);
  const r = await submitTask(p.project, 'brief', { ...p.opts, verifier: passVerifier });
  assert.equal(r.status, 'done');
  assert.ok(r.evidence.includes('intake/brief.md'));
  assert.ok(r.evidence.some((e) => e.endsWith('verify.log')));
  assert.equal(nextTask(p.project, p.opts), null, 'nothing else can start');
});

test('changes outside owns_files or inside must_not_touch are refused before verification', async () => {
  const p = intakeProject(pmTask('brief', { owns_files: ['intake/**'], must_not_touch: ['intake/facts.json'] }));
  p.write('intake/facts.json', '{}');
  nextTask(p.project, p.opts);
  p.write('intake/brief.md');
  p.write('site/index.html', 'sneaky');
  p.write('intake/facts.json', '{"changed":true}');
  let r = await submitTask(p.project, 'brief', { ...p.opts, verifier: passVerifier });
  assert.equal(r.status, 'refused');
  assert.deepEqual(r.refused, ['intake/facts.json', 'site/index.html']);
  assert.equal(getTask(p.project, 'brief', p.opts).status, 'running', 'the task stays open');
  assert.deepEqual(ledger.read(p.project, p.opts).at(-1).data.files, ['intake/facts.json', 'site/index.html']);

  rmSync(join(p.dir, 'site', 'index.html'));
  p.write('intake/facts.json', '{}');
  r = await submitTask(p.project, 'brief', { ...p.opts, verifier: passVerifier });
  assert.equal(r.status, 'done');
});

test('a submission with no changes needs evidence', async () => {
  const p = intakeProject(pmTask('brief'));
  nextTask(p.project, p.opts);
  await assert.rejects(submitTask(p.project, 'brief', { ...p.opts, verifier: passVerifier }), PermissionDenied);
  p.write('intake/existing.md');
  const r = await submitTask(p.project, 'brief', { ...p.opts, evidence: ['intake/existing.md'], verifier: passVerifier });
  assert.equal(r.status, 'refused', 'a file outside owns_files changed after hand-out');
});

test('a failed verify goes back for another attempt, and abandoning uses one up', async () => {
  const p = intakeProject(pmTask('brief', { budget: { minutes: 5, retries: 1 } }));
  nextTask(p.project, p.opts);
  p.write('intake/brief.md');
  const failing = async () => ({ ok: false, code: 1, output: 'missing heading' });
  assert.equal((await submitTask(p.project, 'brief', { ...p.opts, verifier: failing })).status, 'retry');

  const again = nextTask(p.project, p.opts);
  assert.equal(again.attempts, 2);
  const t = abandonTask(p.project, 'brief', p.opts);
  assert.equal(t.status, 'blocked');
  assert.match(t.blocked_reason, /abandoned in step mode/);
});

test('resume leaves a step task alone, however old its heartbeat', () => {
  const p = intakeProject(pmTask('brief'));
  nextTask(p.project, p.opts);
  const t = getTask(p.project, 'brief', p.opts);
  saveTask(p.project, { ...t, heartbeat_at: '2026-01-01T00:00:00.000Z' }, p.opts);
  const report = resume(p.project, { ...p.opts, discardChanges: () => ({ discarded: false }) });
  assert.deepEqual(report.stillRunning, ['brief']);
  assert.equal(getTask(p.project, 'brief', p.opts).status, 'running');
});

test('forge task next and submit work from the command line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const workspace = join(root, 'ws');
  const { createProject } = await import('../../src/core/project.mjs');
  createProject('cli-step', { workspace });
  advancePhase('cli-step', 'INTAKE', { workspace });
  addTask('cli-step', pmTask('brief'), { workspace });

  const out = [];
  const { log, error } = console;
  console.log = console.error = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await cmdTask(root, ['next', 'cli-step']), 0);
    mkdirSync(join(workspace, 'cli-step', 'intake'), { recursive: true });
    writeFileSync(join(workspace, 'cli-step', 'intake', 'brief.md'), '# Brief\n');
    assert.equal(await cmdTask(root, ['check', 'cli-step', 'brief']), 0);
    assert.equal(await cmdTask(root, ['submit', 'cli-step', 'brief']), 0);
    assert.equal(await cmdTask(root, ['next']), 2);
  } finally {
    Object.assign(console, { log, error });
  }
  const text = out.join('\n');
  assert.match(text, /You may change only:\n\s+- intake\/brief\.md/);
  assert.match(text, /Task brief is done/);
});

// ---- the pre-commit hook ----

const hasGit = spawnSync('git', ['--version']).status === 0;
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-repo-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};
const g = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: dir, encoding: 'utf8' });
const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

test('the pre-commit hook stops a commit that adds a credential or a .env file', { skip: !hasGit && 'git not installed' }, () => {
  const dir = repo();
  const hook = installPreCommit(dir);
  assert.match(readFileSync(hook, 'utf8'), /scan --staged/);

  writeFileSync(join(dir, 'ok.txt'), 'hello\n');
  g(dir, 'add', 'ok.txt');
  assert.deepEqual(scanStaged(dir), []);
  assert.equal(g(dir, 'commit', '-q', '-m', 'clean').status, 0, 'a clean commit goes through');

  writeFileSync(join(dir, 'config.js'), `export const key = "${GITHUB}";\n`);
  g(dir, 'add', 'config.js');
  assert.deepEqual(scanStaged(dir), [{ file: 'config.js', id: 'github-token', line: 1 }]);
  const blocked = g(dir, 'commit', '-q', '-m', 'leak');
  assert.notEqual(blocked.status, 0, 'the commit is stopped');
  assert.match(blocked.stdout + blocked.stderr, /config\.js:1\s+github-token/);
  assert.ok(!(blocked.stdout + blocked.stderr).includes(GITHUB), 'the hook never prints the secret');

  g(dir, 'reset', '-q');
  writeFileSync(join(dir, '.env'), 'X=1\n');
  g(dir, 'add', '-f', '.env');
  assert.deepEqual(scanStaged(dir).map((f) => f.id), ['env-file']);
});

test('the hook is not installed over a different one unless forced; the git plugin installs it', { skip: !hasGit && 'git not installed' }, async () => {
  const dir = repo();
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho mine\n');
  assert.throws(() => installPreCommit(dir), PermissionDenied);
  assert.match(readFileSync(installPreCommit(dir, { force: true }), 'utf8'), /forge pre-commit hook/);

  const git = await import('../../plugins/git/index.mjs');
  const project = mkdtempSync(join(tmpdir(), 'forge-proj-'));
  await git.init(project);
  assert.ok(existsSync(join(project, '.git', 'hooks', 'pre-commit')));
});

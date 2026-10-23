import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { getTask, saveTask, transitionTask } from '../../src/core/board.mjs';
import { acquireFileLocks, acquireRunLock, listFileLocks, releaseRunLock } from '../../src/core/locks.mjs';
import { gitDiscardChanges, resume } from '../../src/core/recovery.mjs';
import { runProject } from '../../src/core/runner.mjs';
import { addTasks, newProject, passVerifier, recordingWorker, task } from './helpers.mjs';

const NOW = new Date('2026-10-23T12:00:00Z');
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000).toISOString();
const noDiscard = () => ({ discarded: false, reason: 'test' });

// Puts a task in `running` as if a worker had started it and then died.
function crashWhileRunning(project, opts, id, { heartbeat, attempts = 1 }) {
  transitionTask(project, id, 'ready', opts);
  transitionTask(project, id, 'running', { ...opts, patch: { attempts, heartbeat_at: heartbeat } });
  acquireFileLocks(project, getTask(project, id, opts), opts);
}

test('resume requeues a running task with a stale heartbeat, then the run finishes it once', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  crashWhileRunning(project, opts, 'hero', { heartbeat: minutesAgo(11) });

  const discarded = [];
  const report = resume(project, { ...opts, now: () => NOW, staleMinutes: 10, discardChanges: ({ task: t }) => (discarded.push(t.id), { discarded: true }) });
  assert.deepEqual(report.requeued, ['hero']);
  assert.deepEqual(discarded, ['hero']);
  assert.equal(report.locksReleased, 1);
  assert.equal(getTask(project, 'hero', opts).status, 'retry');

  const worker = recordingWorker();
  const summary = await runProject(project, { ...opts, worker, verifier: passVerifier });
  assert.deepEqual(summary.done, ['hero']);
  assert.deepEqual(worker.calls, [{ task: 'hero', attempt: 2 }]);
});

test('resume leaves a task with a fresh heartbeat alone', () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  crashWhileRunning(project, opts, 'hero', { heartbeat: minutesAgo(2) });
  const report = resume(project, { ...opts, now: () => NOW, staleMinutes: 10, discardChanges: noDiscard });
  assert.deepEqual(report.stillRunning, ['hero']);
  assert.equal(getTask(project, 'hero', opts).status, 'running');
  assert.equal(listFileLocks(project, opts).length, 1, 'a live task keeps its locks');
});

test('a task interrupted on its last attempt is blocked, not run a fourth time', () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  crashWhileRunning(project, opts, 'hero', { heartbeat: minutesAgo(30), attempts: 3 });
  const report = resume(project, { ...opts, now: () => NOW, staleMinutes: 10, discardChanges: noDiscard });
  assert.deepEqual(report.blocked, ['hero']);
  assert.match(getTask(project, 'hero', opts).blocked_reason, /no heartbeat for 30 minutes/);
});

test('submitted work is verified after a crash without calling the worker again', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  crashWhileRunning(project, opts, 'hero', { heartbeat: minutesAgo(1) });
  transitionTask(project, 'hero', 'submitted', { ...opts, patch: { evidence: ['site/hero.txt'] } });

  const report = resume(project, { ...opts, now: () => NOW, discardChanges: noDiscard });
  assert.deepEqual(report.toVerify, ['hero']);
  assert.equal(report.locksReleased, 1, 'orphan lock from the dead run is freed');

  const worker = recordingWorker();
  const summary = await runProject(project, { ...opts, worker, verifier: passVerifier });
  assert.deepEqual(summary.done, ['hero']);
  assert.equal(worker.calls.length, 0);
  assert.ok(getTask(project, 'hero', opts).evidence.includes('site/hero.txt'));
});

test('a run lock left by a dead process is taken over; a live one is respected', () => {
  const { project, opts } = newProject();
  const lockFile = join(opts.workspace, project, 'locks', 'run.lock');
  writeFileSync(lockFile, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), startedAt: NOW.toISOString() }));
  const report = resume(project, { ...opts, discardChanges: noDiscard });
  assert.equal(report.takenOverRunLock.pid, 2 ** 22 + 12345);
  assert.equal(existsSync(lockFile), false);

  acquireRunLock(project, opts);
  assert.throws(() => resume(project, { ...opts, discardChanges: noDiscard }), /already being run by process/);
  releaseRunLock(project, opts);
});

test('a task with no heartbeat at all is treated as stale', () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  crashWhileRunning(project, opts, 'hero', { heartbeat: minutesAgo(0) });
  const t = getTask(project, 'hero', opts);
  delete t.heartbeat_at;
  saveTask(project, t, opts);
  assert.deepEqual(resume(project, { ...opts, now: () => NOW, discardChanges: noDiscard }).requeued, ['hero']);
});

const hasGit = spawnSync('git', ['--version']).status === 0;

test('gitDiscardChanges restores owned files only, and only in the project\'s own repository', { skip: !hasGit && 'git not installed' }, () => {
  const { project, opts } = newProject();
  const dir = join(opts.workspace, project);
  const g = (...args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  const owned = task('hero', { owns_files: ['site/hero.txt', 'site/new/**'] });

  assert.equal(gitDiscardChanges({ task: owned, projectDir: dir }).discarded, false, 'no repo yet');

  mkdirSync(join(dir, 'site'), { recursive: true });
  writeFileSync(join(dir, 'site', 'hero.txt'), 'committed\n');
  writeFileSync(join(dir, 'site', 'other.txt'), 'committed\n');
  g('init', '-q');
  g('add', 'site');
  g('commit', '-q', '-m', 'base');

  writeFileSync(join(dir, 'site', 'hero.txt'), 'half-written\n');
  writeFileSync(join(dir, 'site', 'other.txt'), 'someone else\n');
  mkdirSync(join(dir, 'site', 'new'), { recursive: true });
  writeFileSync(join(dir, 'site', 'new', 'tmp.txt'), 'partial\n');

  assert.equal(gitDiscardChanges({ task: owned, projectDir: dir }).discarded, true);
  assert.equal(readFileSync(join(dir, 'site', 'hero.txt'), 'utf8').replace(/\r/g, ''), 'committed\n');
  assert.equal(readFileSync(join(dir, 'site', 'other.txt'), 'utf8'), 'someone else\n', 'files the task does not own are kept');
  assert.equal(existsSync(join(dir, 'site', 'new', 'tmp.txt')), false);
});

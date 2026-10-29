import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASK_TRANSITIONS, addTask, getTask, transitionTask } from '../../src/core/board.mjs';
import { AuthFailed, PermissionDenied, SchemaInvalid, Unavailable } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { listFileLocks, patternsOverlap } from '../../src/core/locks.mjs';
import { orderTasks, runProject, runTask } from '../../src/core/runner.mjs';
import { addTasks, newProject, passVerifier, recordingWorker, sleep, task } from './helpers.mjs';

const statusMoves = (project, opts, id) =>
  ledger
    .read(project, opts)
    .filter((e) => e.type === 'task_status' && e.data.task === id)
    .map((e) => e.data.to);

test('a task reaches done through every state, with its verify log as evidence', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const r = await runTask(project, 'hero', { ...opts, worker: recordingWorker() });
  assert.equal(r.status, 'done');
  assert.equal(r.attempts, 1);
  assert.deepEqual(statusMoves(project, opts, 'hero'), ['ready', 'running', 'submitted', 'verifying', 'done']);
  const log = r.evidence.find((e) => e.endsWith('verify.log'));
  assert.ok(log, 'verify log recorded as evidence');
  assert.match(readFileSync(join(opts.workspace, project, log), 'utf8'), /exit 0/);
  assert.equal(listFileLocks(project, opts).length, 0, 'locks released');
});

test('illegal task transitions are refused', () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  assert.throws(() => transitionTask(project, 'hero', 'done', opts), PermissionDenied);
  assert.deepEqual(TASK_TRANSITIONS.done, []);
});

test('addTask always starts a task as pending with no evidence', () => {
  const { project, opts } = newProject();
  const t = addTask(project, task('hero', { status: 'done', evidence: ['x.png'] }), opts);
  assert.equal(t.status, 'pending');
  assert.deepEqual(t.evidence, []);
  assert.throws(() => addTask(project, task('hero'), opts), PermissionDenied);
  assert.throws(() => addTask(project, task('bad', { owns_files: ['/etc/passwd'] }), opts), SchemaInvalid);
  for (const runtime of ['ledger.jsonl', 'project.json', 'board/hero.json', 'locks/**', '**/*.json']) {
    assert.throws(() => addTask(project, task('bad', { owns_files: [runtime] }), opts), SchemaInvalid, runtime);
  }
});

test('a task whose dependencies are unfinished is refused', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('tokens'), task('hero', { depends_on: ['tokens'] }));
  await assert.rejects(runTask(project, 'hero', { ...opts, worker: recordingWorker() }), PermissionDenied);
});

test('runProject runs tasks in dependency order', async () => {
  const { project, opts } = newProject();
  addTasks(
    project,
    opts,
    task('pages', { depends_on: ['hero', 'nav'] }),
    task('hero', { depends_on: ['tokens'] }),
    task('nav', { depends_on: ['tokens'] }),
    task('tokens'),
  );
  const worker = recordingWorker();
  const summary = await runProject(project, { ...opts, worker, verifier: passVerifier, concurrency: 1 });
  assert.deepEqual(summary.done.sort(), ['hero', 'nav', 'pages', 'tokens']);
  const order = worker.calls.map((c) => c.task);
  assert.equal(order[0], 'tokens');
  assert.equal(order[3], 'pages');
});

test('dependency cycles and unknown dependencies are schema errors', () => {
  assert.throws(() => orderTasks([task('a', { depends_on: ['b'] }), task('b', { depends_on: ['a'] })]), /cycle: a -> b -> a/);
  assert.throws(() => orderTasks([task('a', { depends_on: ['ghost'] })]), /unknown task ghost/);
});

test('a failed attempt goes to retry and the next attempt can finish', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  let n = 0;
  const worker = async () => {
    if (++n === 1) throw new Error('model crashed');
    return { evidence: ['site/hero.txt'] };
  };
  const r = await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier });
  assert.equal(r.status, 'done');
  assert.equal(r.attempts, 2);
  assert.deepEqual(statusMoves(project, opts, 'hero'), ['ready', 'running', 'retry', 'running', 'submitted', 'verifying', 'done']);
  assert.ok(ledger.read(project, opts).some((e) => e.type === 'error' && /model crashed/.test(e.data.message)));
});

test('after two retries a task is blocked and its dependents wait', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'), task('pages', { depends_on: ['hero'] }));
  const worker = async () => {
    throw new Unavailable('provider down');
  };
  const summary = await runProject(project, { ...opts, worker, verifier: passVerifier });
  const hero = getTask(project, 'hero', opts);
  assert.equal(hero.status, 'blocked');
  assert.equal(hero.attempts, 3);
  assert.match(hero.blocked_reason, /provider down \(after 3 attempts\)/);
  assert.deepEqual(summary.blocked.map((b) => b.task), ['hero']);
  assert.deepEqual(summary.waiting, [{ task: 'pages', on: ['hero'] }]);
});

test('a failing verify command is retried, then blocks', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero', { verify: 'exit 3', budget: { minutes: 1, retries: 1 } }));
  const worker = recordingWorker();
  const r = await runTask(project, 'hero', { ...opts, worker });
  assert.equal(r.status, 'blocked');
  assert.equal(worker.calls.length, 2);
  assert.match(r.reason, /exit 3/);
});

test('errors a retry cannot fix block the task on the first attempt', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const worker = async () => {
    throw new AuthFailed('bad key');
  };
  const r = await runTask(project, 'hero', { ...opts, worker });
  assert.equal(r.status, 'blocked');
  assert.equal(r.attempts, 1);
});

test('an attempt that returns no evidence is not accepted', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero', { budget: { minutes: 1, retries: 0 } }));
  const r = await runTask(project, 'hero', { ...opts, worker: async () => ({ evidence: [] }), verifier: passVerifier });
  assert.equal(r.status, 'blocked');
  assert.match(r.reason, /no evidence/);
});

test('an attempt that runs past its budget times out and is retried', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  let n = 0;
  let sawAbort = false;
  const worker = ({ signal }) => {
    if (++n === 1) {
      return new Promise((resolve) => signal.addEventListener('abort', () => ((sawAbort = true), resolve({ evidence: ['late'] }))));
    }
    return { evidence: ['site/hero.txt'] };
  };
  const r = await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier, timeoutMs: 30 });
  assert.equal(r.status, 'done');
  assert.equal(r.attempts, 2);
  assert.ok(sawAbort, 'worker was told to stop');
});

test('a done task is never run twice', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const worker = recordingWorker();
  await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier });
  const again = await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier });
  assert.equal(again.reused, true);
  assert.equal(worker.calls.length, 1);
});

test('the worker receives a per-attempt idempotency key', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const keys = [];
  let n = 0;
  const worker = async ({ idempotencyKey }) => {
    keys.push(idempotencyKey);
    if (++n === 1) throw new Error('flaky');
    return { evidence: ['site/hero.txt'] };
  };
  await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier });
  assert.deepEqual(keys, ['demo:hero:v1#1', 'demo:hero:v1#2']);
});

test('the runner writes heartbeats while a worker runs', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const beats = new Set();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 23, 12, 0, tick++));
  const worker = async () => {
    for (let i = 0; i < 5; i++) {
      await sleep(15);
      beats.add(getTask(project, 'hero', opts).heartbeat_at);
    }
    return { evidence: ['site/hero.txt'] };
  };
  await runTask(project, 'hero', { ...opts, worker, verifier: passVerifier, heartbeatMs: 5, now });
  assert.ok(beats.size >= 2, `expected the heartbeat to move, saw ${[...beats].join(', ')}`);
});

test('tasks that own overlapping files never run at the same time', async () => {
  const { project, opts } = newProject();
  addTasks(
    project,
    opts,
    task('a', { owns_files: ['site/src/**'] }),
    task('b', { owns_files: ['site/src/Hero.astro'] }),
    task('c', { owns_files: ['site/public/logo.svg'] }),
  );
  let active = new Set();
  const overlaps = [];
  const worker = async ({ task: t }) => {
    active.add(t.id);
    if (active.has('a') && active.has('b')) overlaps.push([...active]);
    await sleep(20);
    active.delete(t.id);
    return { evidence: [t.owns_files[0].replace('**', 'x')] };
  };
  const summary = await runProject(project, { ...opts, worker, verifier: passVerifier, concurrency: 3 });
  assert.equal(summary.done.length, 3);
  assert.deepEqual(overlaps, []);
});

test('runTask refuses to start when another task holds its files', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('a', { owns_files: ['site/x.txt'] }), task('b', { owns_files: ['site/x.txt'] }));
  let release;
  const slow = () => new Promise((r) => (release = () => r({ evidence: ['site/x.txt'] })));
  const first = runTask(project, 'a', { ...opts, worker: slow, verifier: passVerifier });
  await sleep(10);
  await assert.rejects(runTask(project, 'b', { ...opts, worker: recordingWorker(), verifier: passVerifier }), /cannot lock site\/x.txt; a holds/);
  release();
  assert.equal((await first).status, 'done');
});

test('only one runner may run a project at a time', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('a'));
  let release;
  const worker = () => new Promise((r) => (release = () => r({ evidence: ['site/a.txt'] })));
  const first = runProject(project, { ...opts, worker, verifier: passVerifier });
  await sleep(10);
  await assert.rejects(runProject(project, { ...opts, worker, verifier: passVerifier }), Unavailable);
  release();
  await first;
  assert.equal(existsSync(join(opts.workspace, project, 'locks', 'run.lock')), false);
});

test('without a worker adapter the runner says so instead of pretending', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('a'));
  const summary = await runProject(project, { ...opts });
  assert.equal(summary.errors[0].code, 'CONFIG_MISSING');
  assert.match(summary.errors[0].message, /No worker adapter/);
});

test('file-lock patterns overlap conservatively', () => {
  assert.ok(patternsOverlap('site/a.txt', 'site/a.txt'));
  assert.ok(!patternsOverlap('site/a.ts', 'site/a.tsx'));
  assert.ok(patternsOverlap('site/src/**', 'site/src/Hero.astro'));
  assert.ok(patternsOverlap('site/**/*.css', 'site/src/**'));
  assert.ok(!patternsOverlap('site/src/**', 'site/public/logo.svg'));
  assert.ok(patternsOverlap('site\\src\\x.ts', 'site/src/x.ts'));
});

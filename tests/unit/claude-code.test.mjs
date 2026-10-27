import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTask } from '../../src/core/board.mjs';
import { globToRegExp, matcher } from '../../src/core/glob.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { runProject } from '../../src/core/runner.mjs';
import {
  buildPrompt,
  classifyFailure,
  createClaudeCodeWorker,
  createReplayWorker,
  parseEvidence,
  recordingPath,
} from '../../src/workers/claude-code.mjs';
import { addTasks, newProject, passVerifier, task, tmpWorkspace } from './helpers.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.mjs');
const fake = (mode, extraEnv = {}) =>
  createClaudeCodeWorker({ command: [process.execPath, FAKE], env: { ...process.env, FAKE_CLAUDE: mode, ...extraEnv } });

const projectDir = (opts, project) => join(opts.workspace, project);
const statuses = (project, opts) =>
  ledger
    .read(project, opts)
    .filter((e) => e.type === 'task_status')
    .map((e) => `${e.data.task}:${e.data.to}`);

test('a task runs through the adapter, writes its file and records the attempt', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const summary = await runProject(project, { ...opts, worker: fake('ok') });
  assert.deepEqual(summary.done, ['hero']);
  const dir = projectDir(opts, project);
  assert.equal(readFileSync(join(dir, 'site', 'hero.txt'), 'utf8'), 'built hero\n');
  assert.ok(getTask(project, 'hero', opts).evidence.includes('site/hero.txt'));

  const rec = JSON.parse(readFileSync(recordingPath(join(dir, 'evidence', 'recordings'), 'hero', 1), 'utf8'));
  assert.equal(rec.idempotencyKey, 'demo:hero:v1#1');
  assert.deepEqual(rec.evidence, ['site/hero.txt']);
  assert.deepEqual(rec.files, { 'site/hero.txt': { encoding: 'utf8', content: 'built hero\n' } });
  assert.ok(rec.args.includes('--permission-mode') && !rec.args.join(' ').includes('Bash'), 'no shell tool');
});

test('a recorded run replays identically in a fresh project, without calling Claude Code', async () => {
  const first = newProject();
  addTasks(first.project, first.opts, task('tokens'), task('hero', { depends_on: ['tokens'] }));
  await runProject(first.project, { ...first.opts, worker: fake('ok'), verifier: passVerifier });

  const second = newProject();
  addTasks(second.project, second.opts, task('tokens'), task('hero', { depends_on: ['tokens'] }));
  const recordDir = join(projectDir(first.opts, first.project), 'evidence', 'recordings');
  await runProject(second.project, { ...second.opts, worker: createReplayWorker({ recordDir }), verifier: passVerifier });

  for (const id of ['tokens', 'hero']) {
    const a = getTask(first.project, id, first.opts);
    const b = getTask(second.project, id, second.opts);
    assert.deepEqual([b.status, b.attempts, b.evidence], [a.status, a.attempts, a.evidence]);
    const file = `site/${id}.txt`;
    assert.equal(readFileSync(join(projectDir(second.opts, second.project), file), 'utf8'), readFileSync(join(projectDir(first.opts, first.project), file), 'utf8'));
  }
  assert.deepEqual(statuses(second.project, second.opts), statuses(first.project, first.opts));
});

test('a failed attempt and its retry replay the same way', async () => {
  const counterDir = tmpWorkspace();
  const first = newProject();
  addTasks(first.project, first.opts, task('hero'));
  await runProject(first.project, { ...first.opts, worker: fake('flaky', { FAKE_CLAUDE_COUNTER: join(counterDir, 'n') }), verifier: passVerifier });
  assert.equal(getTask(first.project, 'hero', first.opts).attempts, 2);

  const second = newProject();
  addTasks(second.project, second.opts, task('hero'));
  const recordDir = join(projectDir(first.opts, first.project), 'evidence', 'recordings');
  await runProject(second.project, { ...second.opts, worker: createReplayWorker({ recordDir }), verifier: passVerifier });
  assert.deepEqual(statuses(second.project, second.opts), statuses(first.project, first.opts));
  assert.equal(getTask(second.project, 'hero', second.opts).status, 'done');
});

test('replay refuses a recording made for a different task contract', async () => {
  const first = newProject();
  addTasks(first.project, first.opts, task('hero'));
  await runProject(first.project, { ...first.opts, worker: fake('ok'), verifier: passVerifier });

  const second = newProject();
  addTasks(second.project, second.opts, task('hero', { acceptance: ['something else'] }));
  const recordDir = join(projectDir(first.opts, first.project), 'evidence', 'recordings');
  await runProject(second.project, { ...second.opts, worker: createReplayWorker({ recordDir }), verifier: passVerifier });
  const hero = getTask(second.project, 'hero', second.opts);
  assert.equal(hero.status, 'blocked');
  assert.match(hero.blocked_reason, /different task contract/);
  assert.equal(hero.attempts, 1, 'a config problem is not retried');
});

test('a sign-in problem blocks at once with a fix hint', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  await runProject(project, { ...opts, worker: fake('auth') });
  const hero = getTask(project, 'hero', opts);
  assert.equal(hero.status, 'blocked');
  assert.equal(hero.attempts, 1);
  const err = ledger.read(project, opts).find((e) => e.type === 'error');
  assert.equal(err.data.code, 'AUTH_FAILED');
});

test('rate limits and unreadable output are retried', async () => {
  for (const mode of ['ratelimit', 'garbage']) {
    const { project, opts } = newProject();
    addTasks(project, opts, task('hero', { budget: { minutes: 1, retries: 1 } }));
    await runProject(project, { ...opts, worker: fake(mode) });
    const hero = getTask(project, 'hero', opts);
    assert.equal(hero.status, 'blocked', mode);
    assert.equal(hero.attempts, 2, mode);
  }
});

test('a reply without an evidence line is not accepted', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero', { budget: { minutes: 1, retries: 0 } }));
  await runProject(project, { ...opts, worker: fake('noevidence'), verifier: passVerifier });
  assert.match(getTask(project, 'hero', opts).blocked_reason, /no evidence/);
});

test('a hung Claude Code process is killed when the attempt runs out of time', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero', { budget: { minutes: 1, retries: 0 } }));
  const started = Date.now();
  await runProject(project, { ...opts, worker: fake('hang'), timeoutMs: 300 });
  assert.ok(Date.now() - started < 10_000, 'did not wait for the hung process');
  assert.match(getTask(project, 'hero', opts).blocked_reason, /past its budget/);
});

test('a missing claude binary is reported as ConfigMissing', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  const worker = createClaudeCodeWorker({ command: ['forge-no-such-claude-binary'], record: false });
  await runProject(project, { ...opts, worker });
  const err = ledger.read(project, opts).find((e) => e.type === 'error');
  assert.equal(err.data.code, 'CONFIG_MISSING');
  assert.match(err.data.message, /not installed/);
});

test('the prompt carries the whole contract', () => {
  const p = buildPrompt(task('hero', { must_not_touch: ['content/**'], inputs: ['design/tokens.json'] }), { project: 'demo', attempt: 2 });
  for (const s of ['task "hero"', 'site/hero.txt', 'content/**', 'design/tokens.json', 'hero exists', 'exit 0', 'attempt 2', '{"evidence"']) {
    assert.ok(p.includes(s), `prompt is missing ${s}`);
  }
});

test('evidence is parsed from the last evidence line', () => {
  assert.deepEqual(parseEvidence('x {"evidence": ["a"]}\nmore\n{"evidence": ["./b", "c\\\\d.png", ""]}'), ['b', 'c/d.png']);
  assert.deepEqual(parseEvidence('no json'), []);
  assert.deepEqual(parseEvidence(undefined), []);
});

test('failures map to typed errors', () => {
  assert.equal(classifyFailure({ spawnError: { code: 'ENOENT' } }).code, 'CONFIG_MISSING');
  assert.equal(classifyFailure({ exitCode: 1, stdout: 'Invalid API key' }).code, 'AUTH_FAILED');
  assert.equal(classifyFailure({ exitCode: 1, stdout: 'Claude usage limit reached' }).code, 'RATE_LIMITED');
  assert.equal(classifyFailure({ exitCode: 2, stdout: 'boom' }).code, 'UNAVAILABLE');
});

test('globs match the way owns_files patterns are written', () => {
  const m = matcher(['site/src/**', 'site/*.html', 'assets/{logo,icon}.svg']);
  assert.ok(m('site/src/a/b/Hero.astro'));
  assert.ok(m('site/src/x.css'));
  assert.ok(m('site/index.html'));
  assert.ok(!m('site/pages/index.html'));
  assert.ok(m('assets/icon.svg') && !m('assets/other.svg'));
  assert.ok(globToRegExp('a/**/b.txt').test('a/b.txt'));
  assert.ok(globToRegExp('a/**/b.txt').test('a/x/y/b.txt'));
});

test('recordings are kept per task and attempt under evidence/recordings', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  await runProject(project, { ...opts, worker: fake('ok'), verifier: passVerifier });
  const dir = join(projectDir(opts, project), 'evidence', 'recordings', 'hero');
  assert.deepEqual(readdirSync(dir), ['attempt-1.json']);
});

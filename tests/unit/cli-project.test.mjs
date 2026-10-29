import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdApprove, cmdNew, cmdResume, cmdRun, cmdStatus } from '../../src/cli/project.mjs';
import { addTask, getTask } from '../../src/core/board.mjs';
import { runProject } from '../../src/core/runner.mjs';
import { createClaudeCodeWorker } from '../../src/workers/claude-code.mjs';
import { task } from './helpers.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { advancePhase, loadProject } from '../../src/core/project.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli', 'index.mjs');

// A harness root whose forge.config.json points the workspace at a temp folder.
function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  const workspace = join(root, 'ws');
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  return { root, workspace };
}

function quiet(fn) {
  const { log, error } = console;
  const out = [];
  console.log = console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: fn(), out: out.join('\n') };
  } finally {
    Object.assign(console, { log, error });
  }
}

test('forge new, approve, status and resume work together', () => {
  const { root, workspace } = tmpRoot();
  assert.equal(quiet(() => cmdNew(root, ['harbor-home', '--brief', 'samples/briefs/business.md'])).code, 0);
  assert.equal(loadProject('harbor-home', { workspace }).brief, 'samples/briefs/business.md');

  assert.equal(quiet(() => cmdApprove(root, ['harbor-home', 'B1', '--note', 'looks good'])).code, 0);
  const approval = ledger.read('harbor-home', { workspace }).find((e) => e.type === 'approval');
  assert.deepEqual([approval.actor, approval.data.approval, approval.data.note], ['operator', 'B1', 'looks good']);

  const status = quiet(() => cmdStatus(root, ['harbor-home', '--json']));
  const report = JSON.parse(status.out);
  assert.equal(report.phase, 'CREATED');
  assert.deepEqual(report.approvals, ['B1']);

  const resumed = quiet(() => cmdResume(root, ['harbor-home']));
  assert.equal(resumed.code, 0);
  assert.match(resumed.out, /requeued: none/);
});

test('project commands print usage when arguments are missing', () => {
  const { root } = tmpRoot();
  for (const cmd of [cmdNew, cmdApprove, cmdStatus, cmdResume]) assert.equal(quiet(() => cmd(root, [])).code, 2);
});

test('forge status on a missing project is a typed error with a hint', () => {
  const r = spawnSync(process.execPath, [CLI, 'status', 'no-such-project-xyz'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CONFIG_MISSING: Project "no-such-project-xyz" does not exist/);
  assert.match(r.stderr, /forge new no-such-project-xyz/);
});

test('forge run --replay plays a recorded run back into a project', async () => {
  const { root, workspace } = tmpRoot();
  const intakeTask = task('hero', { agent: 'project-manager', owns_files: ['intake/hero.txt'] });
  const fake = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.mjs');
  quiet(() => cmdNew(root, ['recorded']));
  addTask('recorded', intakeTask, { workspace });
  await runProject('recorded', { workspace, worker: createClaudeCodeWorker({ command: [process.execPath, fake] }) });

  quiet(() => cmdNew(root, ['replayed']));
  addTask('replayed', intakeTask, { workspace });
  advancePhase('replayed', 'INTAKE', { workspace });
  const { log } = console;
  console.log = () => {};
  try {
    assert.equal(await cmdRun(root, ['replayed', '--replay', join(workspace, 'recorded', 'evidence', 'recordings')]), 0);
  } finally {
    console.log = log;
  }
  assert.equal(getTask('replayed', 'hero', { workspace }).status, 'done');
});

test('forge run starts only the tasks whose agent works in the current phase', async () => {
  const { root, workspace } = tmpRoot();
  quiet(() => cmdNew(root, ['phased']));
  addTask('phased', task('build-hero'), { workspace });
  const out = [];
  const { log } = console;
  console.log = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await cmdRun(root, ['phased', '--replay', join(workspace, 'nowhere')]), 0);
  } finally {
    console.log = log;
  }
  assert.equal(getTask('phased', 'build-hero', { workspace }).status, 'pending');
  assert.match(out.join('\n'), /waiting: build-hero \(builder does not work in CREATED\)/);
});

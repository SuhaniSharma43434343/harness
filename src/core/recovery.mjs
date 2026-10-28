import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { listTasks, transitionTask } from './board.mjs';
import { loadConfig } from './config.mjs';
import * as ledger from './ledger.mjs';
import { acquireRunLock, listFileLocks, releaseFileLocks, releaseRunLock } from './locks.mjs';
import { loadProject } from './project.mjs';
import { isStepTask } from './step.mjs';
import { assertValid } from './schemas.mjs';
import { ROOT, assertProjectExists, writeJsonAtomic } from './workspace.mjs';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

// Discards a task's uncommitted changes to the files it owns. This only acts when the project
// folder is the top of its own Git repository, so it can never touch the harness checkout.
export function gitDiscardChanges({ task, projectDir }) {
  const top = git(projectDir, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || resolve(top.stdout.trim()).toLowerCase() !== resolve(projectDir).toLowerCase()) {
    return { discarded: false, reason: 'project folder is not its own Git repository' };
  }
  const specs = task.owns_files.map((p) => `:(glob)${p}`);
  // One checkout per path: git rejects the whole command if any one path has no tracked file.
  for (const spec of specs) git(projectDir, ['checkout', 'HEAD', '--', spec]);
  git(projectDir, ['clean', '-fd', '--', ...specs]);
  return { discarded: true };
}

// The ledger is the record; project.json is a cache. If a crash landed between the ledger write
// and the state write, take the phase and repair count from the ledger.
export function reconcileProject(project, opts = {}) {
  const state = loadProject(project, opts);
  const entries = ledger.read(project, opts);
  const moves = entries.filter((e) => e.type === 'phase_transition');
  const phase = moves.length ? moves[moves.length - 1].data.to : 'CREATED';
  const repairLoops = moves.filter((e) => e.data.to === 'REPAIR').length;
  if (state.phase === phase && state.repairLoops === repairLoops) return { changed: false, state };

  const fixed = { ...state, phase, repairLoops, updatedAt: (opts.now?.() ?? new Date()).toISOString() };
  assertValid('projectState', fixed, 'project.json');
  writeJsonAtomic(assertProjectExists(project, opts).state, fixed);
  ledger.append(project, { actor: 'cli', type: 'note', data: { message: 'project.json rebuilt from the ledger', from: { phase: state.phase, repairLoops: state.repairLoops }, to: { phase, repairLoops } } }, opts);
  return { changed: true, state: fixed };
}

// forge resume: after an interruption, requeue every running task whose heartbeat is older
// than heartbeatStaleMinutes, discard its uncommitted changes and free its file locks.
// Submitted and verifying tasks keep their work: the next run re-verifies them without
// calling the worker again, so nothing is done twice.
export function resume(project, options = {}) {
  const {
    now = () => new Date(),
    staleMinutes = loadConfig(ROOT).config.heartbeatStaleMinutes,
    discardChanges = gitDiscardChanges,
    ...opts
  } = options;
  const ctx = { ...opts, now };
  const paths = assertProjectExists(project, ctx);
  const runLock = acquireRunLock(project, ctx);
  const report = { project, takenOverRunLock: runLock.takenOver, reconciled: false, requeued: [], blocked: [], stillRunning: [], toVerify: [], locksReleased: 0 };

  try {
    report.reconciled = reconcileProject(project, ctx).changed;
    const staleBefore = now().getTime() - staleMinutes * 60_000;
    const tasks = listTasks(project, ctx);

    for (const task of tasks) {
      if (task.status === 'submitted' || task.status === 'verifying') {
        report.toVerify.push(task.id);
        continue;
      }
      if (task.status !== 'running') continue;
      // A step-mode task is being done by a person in Cursor, not by a process with a heartbeat.
      if (isStepTask(project, task.id, ctx)) {
        report.stillRunning.push(task.id);
        continue;
      }
      const beat = task.heartbeat_at ? Date.parse(task.heartbeat_at) : 0;
      if (beat > staleBefore) {
        report.stillRunning.push(task.id);
        continue;
      }

      const minutes = beat ? Math.round((now().getTime() - beat) / 60_000) : null;
      const why = minutes === null ? 'no heartbeat recorded' : `no heartbeat for ${minutes} minutes`;
      const discard = discardChanges({ task, projectDir: paths.dir });
      ledger.append(project, { actor: 'cli', type: 'note', data: { task: task.id, message: discard.discarded ? 'Uncommitted changes discarded' : `Changes not discarded: ${discard.reason}` } }, ctx);
      report.locksReleased += releaseFileLocks(project, task.id, ctx);

      if ((task.attempts ?? 0) < task.budget.retries + 1) {
        transitionTask(project, task.id, 'retry', { reason: `Requeued by resume: ${why}`, ...ctx });
        report.requeued.push(task.id);
      } else {
        const reason = `Interrupted on its last attempt (${why})`;
        transitionTask(project, task.id, 'blocked', { reason, patch: { blocked_reason: reason }, ...ctx });
        report.blocked.push(task.id);
      }
    }

    // Locks left by tasks that are no longer running belong to nobody.
    const running = new Set(report.stillRunning);
    for (const lock of listFileLocks(project, ctx)) {
      if (!running.has(lock.task)) report.locksReleased += releaseFileLocks(project, lock.task, ctx);
    }
  } finally {
    releaseRunLock(project, ctx);
  }
  return report;
}

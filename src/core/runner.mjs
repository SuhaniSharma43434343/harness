import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getTask, listTasks, saveTask, transitionTask } from './board.mjs';
import { loadConfig } from './config.mjs';
import { ConfigMissing, PermissionDenied, SchemaInvalid, Unavailable } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { acquireFileLocks, acquireRunLock, patternsOverlap, releaseFileLocks, releaseRunLock } from './locks.mjs';
import { ROOT, assertProjectExists } from './workspace.mjs';

// Errors a retry cannot fix: the task is blocked straight away so the operator sees it.
const NON_RETRYABLE = new Set(['CONFIG_MISSING', 'CONFIG_INVALID', 'AUTH_FAILED', 'PERMISSION_DENIED', 'NOT_IMPLEMENTED']);

const ACTIVE = new Set(['running', 'submitted', 'verifying']);

// Runs the task's verify command in the project folder. Exit code 0 is a pass.
export function shellVerifier(command, { cwd, signal }) {
  return new Promise((resolvePromise) => {
    let output = '';
    const child = spawn(command, { cwd, shell: true, signal, windowsHide: true });
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (err) => resolvePromise({ ok: false, code: null, output: output + String(err.message) }));
    child.on('close', (code) => resolvePromise({ ok: code === 0, code, output }));
  });
}

function withTimeout(ms, label) {
  const controller = new AbortController();
  // Kept referenced: while an attempt is waiting on its worker, this timer may be the only thing
  // keeping the event loop alive, and it must fire.
  const timer = setTimeout(() => controller.abort(new Unavailable(`${label} ran past its budget of ${Math.round(ms / 60000)} minutes`)), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((res, rej) => {
    if (signal.aborted) return rej(signal.reason);
    const onAbort = () => rej(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => (signal.removeEventListener('abort', onAbort), res(v)),
      (e) => (signal.removeEventListener('abort', onAbort), rej(e)),
    );
  });
}

const result = (task) => {
  const r = { task: task.id, status: task.status, attempts: task.attempts ?? 0, evidence: task.evidence };
  if (task.blocked_reason) r.reason = task.blocked_reason;
  return r;
};

// runTask(project, taskId) => Promise<TaskResult>, as agreed in docs/interfaces.md.
// The third argument injects the worker (the claude-code adapter arrives with T06) and test seams.
//   worker({ task, project, projectDir, attempt, idempotencyKey, signal, heartbeat }) => { evidence: string[] }
// The budget (task.budget.minutes) applies to each attempt: worker plus verification.
export async function runTask(project, taskId, options = {}) {
  const {
    worker,
    verifier = shellVerifier,
    actor = 'cli',
    heartbeatMs = 30_000,
    timeoutMs,
    now = () => new Date(),
    ...opts
  } = options;
  const ctx = { ...opts, now };
  const paths = assertProjectExists(project, ctx);
  let task = getTask(project, taskId, ctx);

  // Idempotency: finished tasks are never run again.
  if (task.status === 'done' || task.status === 'blocked') return { ...result(task), reused: true };
  if (task.status === 'running') {
    throw new Unavailable(`Task ${taskId} is already running`, { hint: `If its worker died, run forge resume ${project}.` });
  }

  if (task.status === 'pending') {
    const all = new Map(listTasks(project, ctx).map((t) => [t.id, t]));
    const waiting = task.depends_on.filter((d) => all.get(d)?.status !== 'done');
    if (waiting.length) {
      throw new PermissionDenied(`Task ${taskId} depends on unfinished tasks: ${waiting.join(', ')}`, { details: { waiting } });
    }
    task = transitionTask(project, taskId, 'ready', { actor, ...ctx });
  }

  const lock = acquireFileLocks(project, task, ctx);
  if (!lock.ok) {
    throw new Unavailable(`Task ${taskId} cannot lock ${lock.conflict.pattern}; ${lock.conflict.heldBy} holds ${lock.conflict.heldPattern}`, {
      details: lock.conflict,
    });
  }

  const budgetMs = timeoutMs ?? task.budget.minutes * 60_000;
  const maxAttempts = task.budget.retries + 1;
  let heartbeatTimer;

  const beat = () => {
    const current = getTask(project, taskId, ctx);
    if (current.status !== 'running') return;
    current.heartbeat_at = now().toISOString();
    saveTask(project, current, ctx);
  };

  const fail = (reason, retryable = true) => {
    const t = getTask(project, taskId, ctx);
    if (retryable && (t.attempts ?? 0) < maxAttempts) {
      return transitionTask(project, taskId, 'retry', { actor, reason, ...ctx });
    }
    const why = retryable ? `${reason} (after ${t.attempts} attempts)` : reason;
    return transitionTask(project, taskId, 'blocked', { actor, reason: why, patch: { blocked_reason: why }, ...ctx });
  };

  try {
    for (;;) {
      task = getTask(project, taskId, ctx);
      if (task.status === 'done' || task.status === 'blocked') return result(task);

      if (task.status === 'ready' || task.status === 'retry') {
        if (!worker) {
          throw new ConfigMissing('No worker adapter is configured', { hint: 'The claude-code worker adapter arrives with T06.' });
        }
        const attempt = (task.attempts ?? 0) + 1;
        task = transitionTask(project, taskId, 'running', {
          actor,
          patch: { attempts: attempt, heartbeat_at: now().toISOString() },
          ...ctx,
        });
        heartbeatTimer = setInterval(beat, heartbeatMs);
        heartbeatTimer.unref?.();
        const t = withTimeout(budgetMs, `Task ${taskId} attempt ${attempt}`);
        try {
          const out = await abortable(
            Promise.resolve(
              worker({
                task,
                project,
                projectDir: paths.dir,
                attempt,
                idempotencyKey: `${task.idempotency_key}#${attempt}`,
                signal: t.signal,
                heartbeat: beat,
              }),
            ),
            t.signal,
          );
          const evidence = [...new Set([...(task.evidence ?? []), ...(out?.evidence ?? [])])];
          if (!out?.evidence?.length) {
            fail(`Attempt ${attempt} returned no evidence`);
          } else {
            transitionTask(project, taskId, 'submitted', { actor: task.agent, patch: { evidence }, ...ctx });
          }
        } catch (err) {
          const code = err?.code;
          ledger.append(project, { actor, type: 'error', data: { task: taskId, attempt, code: code ?? 'WORKER_FAILED', message: String(err?.message ?? err) } }, ctx);
          fail(`Attempt ${attempt} failed: ${err?.message ?? err}`, !NON_RETRYABLE.has(code));
        } finally {
          t.clear();
          clearInterval(heartbeatTimer);
        }
        continue;
      }

      if (task.status === 'submitted' || task.status === 'verifying') {
        if (task.status === 'submitted') task = transitionTask(project, taskId, 'verifying', { actor, ...ctx });
        const attempt = task.attempts ?? 0;
        const t = withTimeout(budgetMs, `Verification of ${taskId}`);
        let outcome;
        try {
          outcome = await abortable(Promise.resolve(verifier(task.verify, { cwd: paths.dir, signal: t.signal, task })), t.signal);
        } catch (err) {
          outcome = { ok: false, code: null, output: String(err?.message ?? err) };
        } finally {
          t.clear();
        }
        const log = `evidence/tasks/${taskId}/attempt-${attempt}-verify.log`;
        mkdirSync(dirname(join(paths.dir, log)), { recursive: true });
        writeFileSync(join(paths.dir, log), `$ ${task.verify}\nexit ${outcome.code}\n\n${outcome.output ?? ''}`);
        if (outcome.ok) {
          const evidence = [...new Set([...task.evidence, log])];
          transitionTask(project, taskId, 'done', { actor: 'cli', patch: { evidence }, ...ctx });
        } else {
          fail(`Verify command failed on attempt ${attempt} (exit ${outcome.code}); see ${log}`);
        }
        continue;
      }

      throw new PermissionDenied(`Task ${taskId} is ${task.status} and cannot be run`);
    }
  } finally {
    clearInterval(heartbeatTimer);
    releaseFileLocks(project, taskId, ctx);
  }
}

// Depth-first topological order of the board. Unknown dependencies and cycles are errors.
export function orderTasks(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const order = [];
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      throw new SchemaInvalid(`Task dependencies form a cycle: ${[...trail, id].join(' -> ')}`);
    }
    state.set(id, 'visiting');
    for (const dep of byId.get(id).depends_on) {
      if (!byId.has(dep)) throw new SchemaInvalid(`Task ${id} depends on unknown task ${dep}`);
      visit(dep, [...trail, id]);
    }
    state.set(id, 'done');
    order.push(byId.get(id));
  };
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) visit(t.id, []);
  return order;
}

// Runs every task whose dependencies are done, in dependency order, up to `concurrency` at
// once. Two tasks that own overlapping files never run together. Returns when nothing more
// can start: every task is done, blocked, waiting on a blocked dependency, or still marked
// running by a worker that has not been recovered (see forge resume). With `agents`, only
// tasks for those agents start (forge run passes the agents of the current phase).
export async function runProject(project, options = {}) {
  const { concurrency = loadConfig(ROOT).config.concurrency, agents, ...taskOptions } = options;
  const allowed = agents ? new Set(agents) : null;
  assertProjectExists(project, taskOptions);
  acquireRunLock(project, taskOptions);
  const inFlight = new Map();
  const failures = [];
  try {
    orderTasks(listTasks(project, taskOptions));
    for (;;) {
      const tasks = orderTasks(listTasks(project, taskOptions));
      const status = new Map(tasks.map((t) => [t.id, t.status]));
      for (const t of tasks) {
        if (inFlight.size >= concurrency) break;
        if (inFlight.has(t.id) || failures.some((f) => f.task === t.id)) continue;
        if (!['pending', 'ready', 'retry', 'submitted', 'verifying'].includes(t.status)) continue;
        if (!t.depends_on.every((d) => status.get(d) === 'done')) continue;
        if (allowed && !allowed.has(t.agent)) continue;
        const clash = [...inFlight.values()].some(({ task }) =>
          task.owns_files.some((a) => t.owns_files.some((b) => patternsOverlap(a, b))),
        );
        if (clash) continue;
        const p = runTask(project, t.id, taskOptions)
          .catch((err) => failures.push({ task: t.id, error: err }))
          .finally(() => inFlight.delete(t.id));
        inFlight.set(t.id, { task: t, promise: p });
      }
      if (!inFlight.size) break;
      await Promise.race([...inFlight.values()].map((f) => f.promise));
    }
  } finally {
    releaseRunLock(project, taskOptions);
  }

  const tasks = listTasks(project, taskOptions);
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const summary = { done: [], blocked: [], waiting: [], running: [], errors: failures.map((f) => ({ task: f.task, code: f.error.code, message: f.error.message })) };
  for (const t of tasks) {
    if (t.status === 'done') summary.done.push(t.id);
    else if (t.status === 'blocked') summary.blocked.push({ task: t.id, reason: t.blocked_reason });
    else if (ACTIVE.has(t.status)) summary.running.push(t.id);
    else {
      const w = { task: t.id, on: t.depends_on.filter((d) => status.get(d) !== 'done') };
      if (allowed && !allowed.has(t.agent)) w.notInPhase = t.agent;
      summary.waiting.push(w);
    }
  }
  return summary;
}

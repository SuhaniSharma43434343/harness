import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { assertValid } from './schemas.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from './workspace.mjs';

// The task board: one schema-checked task contract per file in workspace/<project>/board/.
// Tasks move pending -> ready -> running -> submitted -> verifying -> done. A failed attempt
// goes to retry, and back to running; once retries are used up the task is blocked.
export const TASK_TRANSITIONS = {
  pending: ['ready', 'blocked'],
  ready: ['running', 'blocked'],
  running: ['submitted', 'retry', 'blocked'],
  submitted: ['verifying', 'retry', 'blocked'],
  verifying: ['done', 'retry', 'blocked'],
  retry: ['running', 'blocked'],
  done: [],
  blocked: [],
};

const taskFile = (project, id, opts) => join(assertProjectExists(project, opts).board, `${id}.json`);

export function addTask(project, task, opts = {}) {
  const file = taskFile(project, task.id, opts);
  if (existsSync(file)) throw new PermissionDenied(`Task "${task.id}" already exists in ${project}`);
  const fresh = { ...task, status: 'pending', evidence: [], attempts: 0 };
  delete fresh.blocked_reason;
  delete fresh.heartbeat_at;
  assertValid('task', fresh, `task ${task.id}`);
  writeJsonAtomic(file, fresh);
  return fresh;
}

export function getTask(project, id, opts = {}) {
  const file = taskFile(project, id, opts);
  if (!existsSync(file)) throw new ConfigMissing(`Task "${id}" does not exist in ${project}`);
  const task = readJson(file);
  assertValid('task', task, `task ${id}`);
  return task;
}

export function listTasks(project, opts = {}) {
  const dir = assertProjectExists(project, opts).board;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => getTask(project, f.slice(0, -5), opts));
}

// Saves fields that do not change the status (heartbeat, evidence) without a ledger entry.
export function saveTask(project, task, opts = {}) {
  assertValid('task', task, `task ${task.id}`);
  writeJsonAtomic(taskFile(project, task.id, opts), task);
  return task;
}

// Moves a task to `to`, checks the move is legal, records it in the ledger, then saves.
// `patch` is merged into the task first (for example evidence or blocked_reason).
export function transitionTask(project, id, to, { actor = 'cli', patch = {}, reason, ...opts } = {}) {
  const task = getTask(project, id, opts);
  const from = task.status;
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new PermissionDenied(`Task ${id} cannot move from ${from} to ${to}`, {
      details: { task: id, from, to, allowed: TASK_TRANSITIONS[from] },
    });
  }
  const next = { ...task, ...patch, status: to };
  if (to === 'blocked' && !next.blocked_reason) next.blocked_reason = reason ?? 'no reason given';
  assertValid('task', next, `task ${id}`);

  const data = { task: id, from, to, attempt: next.attempts ?? 0 };
  if (reason) data.reason = reason;
  ledger.append(project, { actor, type: 'task_status', data }, opts);
  writeJsonAtomic(taskFile(project, id, opts), next);
  return next;
}

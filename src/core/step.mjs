import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentsForPhase } from './agents.mjs';
import { getTask, listTasks, transitionTask } from './board.mjs';
import { PermissionDenied, Unavailable } from './errors.mjs';
import { matcher, walk } from './glob.mjs';
import * as ledger from './ledger.mjs';
import { acquireFileLocks, patternsOverlap, releaseFileLocks } from './locks.mjs';
import { loadProject } from './project.mjs';
import { orderTasks, runTask } from './runner.mjs';
import { assertProjectExists } from './workspace.mjs';

// Step mode (T10), for editors without Claude Code such as Cursor. `forge task next` hands out
// one task contract at a time and records the state of the project's files. The editor's agent
// makes the change, and `forge task submit` compares the files again: any change outside the
// task's owns_files, or inside must_not_touch, is refused before the verify command runs.

// Files the runtime writes, which step mode never counts as the agent's changes.
const IGNORED = ['board', 'locks', 'ledger.jsonl', 'project.json', 'evidence/recordings', 'evidence/tasks', 'node_modules', 'site/node_modules', '.git', 'site/.astro'];

const stepFile = (project, id, opts) => join(assertProjectExists(project, opts).locks, `step-${id}.json`);

export function isStepTask(project, id, opts = {}) {
  return existsSync(stepFile(project, id, opts));
}

function snapshot(dir) {
  const files = {};
  for (const rel of walk(dir, { skip: IGNORED })) files[rel] = createHash('sha1').update(readFileSync(join(dir, rel))).digest('hex');
  return files;
}

export function changedFiles(before, after) {
  const changed = [];
  for (const [path, sha] of Object.entries(after)) if (before[path] !== sha) changed.push(path);
  for (const path of Object.keys(before)) if (!(path in after)) changed.push(path);
  return changed.sort();
}

// Hands out the next task that can start: its dependencies are done, its agent works in the
// project's phase, and no other step task is open. Returns null when there is none.
export function nextTask(project, opts = {}) {
  const { actor = 'cli', ...ctx } = opts;
  const { dir } = assertProjectExists(project, ctx);
  const tasks = orderTasks(listTasks(project, ctx));
  const open = tasks.find((t) => t.status === 'running' && isStepTask(project, t.id, ctx));
  if (open) {
    throw new Unavailable(`Task ${open.id} is still open in step mode`, { hint: `Finish it with forge task submit ${project} ${open.id}, or give it up with forge task abandon ${project} ${open.id}.` });
  }
  const { phase } = loadProject(project, ctx);
  const allowed = new Set(agentsForPhase(phase));
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const active = tasks.filter((t) => ['running', 'submitted', 'verifying'].includes(t.status));

  for (const t of tasks) {
    if (!['pending', 'ready', 'retry'].includes(t.status)) continue;
    if (!allowed.has(t.agent)) continue;
    if (!t.depends_on.every((d) => status.get(d) === 'done')) continue;
    if (active.some((a) => a.owns_files.some((x) => t.owns_files.some((y) => patternsOverlap(x, y))))) continue;

    let task = t.status === 'pending' ? transitionTask(project, t.id, 'ready', { actor, ...ctx }) : t;
    const lock = acquireFileLocks(project, task, ctx);
    if (!lock.ok) continue;
    task = transitionTask(project, t.id, 'running', {
      actor,
      reason: 'handed out in step mode',
      patch: { attempts: (task.attempts ?? 0) + 1, heartbeat_at: new Date().toISOString() },
      ...ctx,
    });
    writeFileSync(stepFile(project, task.id, ctx), JSON.stringify({ task: task.id, attempt: task.attempts, startedAt: new Date().toISOString(), files: snapshot(dir) }));
    return task;
  }
  return null;
}

function openStep(project, id, ctx) {
  const task = getTask(project, id, ctx);
  if (task.status !== 'running' || !isStepTask(project, id, ctx)) {
    throw new PermissionDenied(`Task ${id} is not open in step mode (it is ${task.status})`, { hint: `Start one with forge task next ${project}.` });
  }
  return { task, step: JSON.parse(readFileSync(stepFile(project, id, ctx), 'utf8')) };
}

// What the agent changed since the task was handed out, split into allowed and refused.
export function checkChanges(project, id, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  const { task, step } = openStep(project, id, opts);
  const changed = changedFiles(step.files, snapshot(dir));
  const owned = matcher(task.owns_files);
  const forbidden = matcher(task.must_not_touch);
  const refused = changed.filter((p) => !owned(p) || forbidden(p));
  return { task, changed, allowed: changed.filter((p) => !refused.includes(p)), refused };
}

// Submits a step task. Changes outside the contract are refused (the task stays open so the
// agent can undo them). Otherwise the task is submitted with its evidence and verified; it ends
// done, back in retry for another attempt, or blocked.
export async function submitTask(project, id, opts = {}) {
  const { evidence = [], actor = 'cli', verifier, ...ctx } = opts;
  const { task, changed, allowed, refused } = checkChanges(project, id, ctx);
  if (refused.length) {
    ledger.append(project, { actor, type: 'refusal', data: { action: `task submit ${id}`, reason: 'changes outside the task contract', files: refused } }, ctx);
    return { status: 'refused', task: id, refused, changed };
  }
  const proof = [...new Set([...evidence, ...allowed])];
  if (!proof.length) {
    throw new PermissionDenied(`Task ${id} has no changes and no evidence to submit`, { hint: 'Make the change, or pass --evidence <path> for files that prove the acceptance criteria.' });
  }
  rmSync(stepFile(project, id, ctx), { force: true });
  transitionTask(project, id, 'submitted', { actor, patch: { evidence: [...new Set([...task.evidence, ...proof])] }, ...ctx });
  const result = await runTask(project, id, { ...ctx, actor, verifier, once: true });
  return { status: result.status, task: id, changed, evidence: result.evidence, reason: result.reason };
}

// Gives up the open step task: it goes back to retry (or blocked if it has no attempts left).
// The agent's changes are left in place; forge resume or Git can undo them.
export function abandonTask(project, id, opts = {}) {
  const { actor = 'cli', ...ctx } = opts;
  const { task } = openStep(project, id, ctx);
  rmSync(stepFile(project, id, ctx), { force: true });
  releaseFileLocks(project, id, ctx);
  const left = task.budget.retries + 1 - (task.attempts ?? 0);
  if (left > 0) return transitionTask(project, id, 'retry', { actor, reason: 'abandoned in step mode', ...ctx });
  const reason = 'abandoned in step mode on its last attempt';
  return transitionTask(project, id, 'blocked', { actor, reason, patch: { blocked_reason: reason }, ...ctx });
}

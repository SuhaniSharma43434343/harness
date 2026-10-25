import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { Unavailable } from './errors.mjs';
import { projectPaths, readJson } from './workspace.mjs';

const RUN_LOCK = 'run.lock';
const GLOB_CHARS = /[*?[{]/;

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function lockIsStale(info) {
  // A lock from another machine cannot be checked, so it is only stale if its process is
  // gone on this machine.
  return info.host === hostname() && !pidAlive(info.pid);
}

function createExclusive(file, info) {
  try {
    writeFileSync(file, JSON.stringify(info), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

// One runner per project at a time. A lock left by a process that has died is taken over.
export function acquireRunLock(project, opts = {}) {
  const dir = projectPaths(project, opts).locks;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, RUN_LOCK);
  const info = { pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  if (createExclusive(file, info)) return { file, takenOver: null };

  const held = readJson(file);
  if (!lockIsStale(held)) {
    throw new Unavailable(`Project "${project}" is already being run by process ${held.pid} on ${held.host}`, {
      hint: 'Wait for that run to finish, or stop it, then run forge resume.',
    });
  }
  rmSync(file, { force: true });
  if (!createExclusive(file, info)) throw new Unavailable(`Another process took the run lock for "${project}"`);
  return { file, takenOver: held };
}

export function releaseRunLock(project, opts = {}) {
  rmSync(join(projectPaths(project, opts).locks, RUN_LOCK), { force: true });
}

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');
const staticPrefix = (p) => {
  const i = p.search(GLOB_CHARS);
  return i === -1 ? p : p.slice(0, i);
};

// Conservative overlap test for owns_files patterns: two literal paths overlap only when
// equal; a glob overlaps anything under its fixed prefix.
export function patternsOverlap(a, b) {
  a = norm(a);
  b = norm(b);
  if (a === b) return true;
  const aGlob = GLOB_CHARS.test(a);
  const bGlob = GLOB_CHARS.test(b);
  if (!aGlob && !bGlob) return false;
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function listFileLocks(project, opts = {}) {
  const dir = projectPaths(project, opts).locks;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('file-') && f.endsWith('.lock'))
    .map((f) => ({ file: join(dir, f), ...readJson(join(dir, f)) }));
}

// Locks every path the task owns, or none of them. Returns the conflicting lock when another
// task already holds an overlapping path. Lock acquisition is synchronous, so tasks started
// by one runner process cannot race each other.
export function acquireFileLocks(project, task, opts = {}) {
  const dir = projectPaths(project, opts).locks;
  mkdirSync(dir, { recursive: true });
  const held = listFileLocks(project, opts).filter((l) => l.task !== task.id);
  for (const pattern of task.owns_files) {
    const clash = held.find((l) => patternsOverlap(l.pattern, pattern));
    if (clash) return { ok: false, conflict: { pattern, heldBy: clash.task, heldPattern: clash.pattern } };
  }
  const created = [];
  for (const pattern of task.owns_files) {
    const name = `file-${createHash('sha1').update(norm(pattern)).digest('hex').slice(0, 16)}.lock`;
    const file = join(dir, name);
    const info = { task: task.id, pattern: norm(pattern), pid: process.pid, host: hostname(), ts: new Date().toISOString() };
    if (!createExclusive(file, info)) {
      const existing = readJson(file);
      if (existing.task === task.id) continue;
      for (const f of created) rmSync(f, { force: true });
      return { ok: false, conflict: { pattern, heldBy: existing.task, heldPattern: existing.pattern } };
    }
    created.push(file);
  }
  return { ok: true };
}

export function releaseFileLocks(project, taskId, opts = {}) {
  let released = 0;
  for (const lock of listFileLocks(project, opts)) {
    if (lock.task === taskId) {
      rmSync(lock.file, { force: true });
      released++;
    }
  }
  return released;
}

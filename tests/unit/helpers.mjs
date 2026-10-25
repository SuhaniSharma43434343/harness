import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addTask } from '../../src/core/board.mjs';
import { createProject } from '../../src/core/project.mjs';

export const tmpWorkspace = () => mkdtempSync(join(tmpdir(), 'forge-ws-'));

export function newProject(name = 'demo') {
  const workspace = tmpWorkspace();
  createProject(name, { workspace });
  return { project: name, workspace, opts: { workspace } };
}

export function task(id, overrides = {}) {
  return {
    id,
    agent: 'builder',
    approach_modules: ['APP-01'],
    inputs: [],
    owns_files: [`site/${id}.txt`],
    must_not_touch: [],
    depends_on: [],
    acceptance: [`${id} exists`],
    verify: 'exit 0',
    budget: { minutes: 5, retries: 2 },
    idempotency_key: `demo:${id}:v1`,
    status: 'pending',
    evidence: [],
    ...overrides,
  };
}

export function addTasks(project, opts, ...tasks) {
  for (const t of tasks) addTask(project, t, opts);
}

// A verifier that passes without spawning a shell.
export const passVerifier = async () => ({ ok: true, code: 0, output: 'ok' });

// A worker that records each call and returns one evidence path.
export function recordingWorker(calls = []) {
  const fn = async ({ task, attempt }) => {
    calls.push({ task: task.id, attempt });
    return { evidence: [`site/${task.id}.txt`] };
  };
  fn.calls = calls;
  return fn;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

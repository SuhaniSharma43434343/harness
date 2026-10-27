import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadAgents } from '../core/agents.mjs';
import { AuthFailed, ConfigInvalid, ConfigMissing, RateLimited, Unavailable } from '../core/errors.mjs';
import { matcher, walk } from '../core/glob.mjs';

// The claude-code worker adapter (T06). It runs one task as a headless `claude -p` session
// in the project folder and returns { evidence }, as the runner expects. Every attempt can be
// recorded, and createReplayWorker() plays a recording back without calling the model, so a
// recorded run replays identically in tests and mock mode.

export const RECORDING_VERSION = 1;

// Folders the runtime owns; a worker's file snapshot never includes them.
const RUNTIME_PATHS = ['board', 'locks', 'ledger.jsonl', 'project.json', 'evidence/recordings', 'evidence/tasks'];

// Read and edit tools only. Shell access waits for the Claude Code hooks in T09, which enforce
// the contract's file boundaries.
export const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

const MAX_RECORDED_BYTES = 2 * 1024 * 1024;

const list = (xs) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');

export function buildPrompt(task, { project, attempt }) {
  const sections = [
    `You are the ${task.agent} agent in the Forge website harness, working on task "${task.id}" for project "${project}". Work only inside the current folder.`,
    `You may create or change only these paths (globs allowed):\n${list(task.owns_files)}`,
    `Never change these paths:\n${list(task.must_not_touch)}`,
    `Read these inputs first:\n${list(task.inputs)}`,
    `Acceptance criteria:\n${list(task.acceptance)}`,
    `When you finish, the harness runs this verify command in the current folder: ${task.verify}`,
  ];
  if (task.approach_modules.length) sections.push(`Approach modules: ${task.approach_modules.join(', ')}.`);
  if (attempt > 1) sections.push(`This is attempt ${attempt}. Files from an earlier attempt may exist; continue from them.`);
  sections.push(
    'End your reply with one line holding only a JSON object that lists the files proving the acceptance criteria, relative to the current folder:\n{"evidence": ["path/one", "path/two"]}',
  );
  return sections.join('\n\n');
}

// Fingerprint of the parts of a task contract that shape the work. The project name and the
// idempotency key are left out, so a recording can be replayed into another project.
const CONTRACT_FIELDS = ['id', 'agent', 'approach_modules', 'inputs', 'owns_files', 'must_not_touch', 'depends_on', 'acceptance', 'verify', 'budget'];
export const contractHash = (task) =>
  createHash('sha256')
    .update(JSON.stringify(CONTRACT_FIELDS.map((f) => task[f])))
    .digest('hex');

// Finds the last {"evidence": [...]} object in the model's reply.
export function parseEvidence(text) {
  const matches = String(text ?? '').match(/\{\s*"evidence"\s*:\s*\[[^\]]*\]\s*\}/g);
  if (!matches) return [];
  try {
    const { evidence } = JSON.parse(matches[matches.length - 1]);
    return evidence.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim().replace(/\\/g, '/').replace(/^\.\//, ''));
  } catch {
    return [];
  }
}

// Maps a failed run to a typed error so the runner knows whether a retry can help.
export function classifyFailure({ exitCode, stdout, stderr, spawnError }) {
  if (spawnError?.code === 'ENOENT') {
    return new ConfigMissing('Claude Code is not installed or not on PATH', {
      hint: 'Install Claude Code, sign in with `claude`, then run forge doctor.',
    });
  }
  const text = `${stdout ?? ''}\n${stderr ?? ''}`;
  if (/invalid api key|not logged in|please run \/login|authentication|unauthori[sz]ed|401/i.test(text)) {
    return new AuthFailed('Claude Code is not signed in', { hint: 'Run `claude` once and sign in, then try again.' });
  }
  if (/rate limit|429|overloaded|usage limit|too many requests/i.test(text)) {
    return new RateLimited('Claude Code hit a rate or usage limit', { hint: 'Wait a few minutes, then run forge resume.' });
  }
  const tail = text.trim().split('\n').slice(-3).join(' ').slice(0, 300);
  return new Unavailable(`Claude Code exited with code ${exitCode}${tail ? `: ${tail}` : ''}`);
}

function snapshot(projectDir, patterns) {
  const owned = matcher(patterns);
  const files = {};
  for (const rel of walk(projectDir, { skip: RUNTIME_PATHS })) {
    if (!owned(rel)) continue;
    files[rel] = readFileSync(join(projectDir, rel));
  }
  return files;
}

// Files the worker created, changed or deleted inside owns_files, as text or base64.
function diffSnapshots(before, after) {
  const changes = {};
  let bytes = 0;
  for (const [path, buf] of Object.entries(after)) {
    if (before[path] && before[path].equals(buf)) continue;
    bytes += buf.length;
    const text = buf.toString('utf8');
    changes[path] = Buffer.from(text, 'utf8').equals(buf) ? { encoding: 'utf8', content: text } : { encoding: 'base64', content: buf.toString('base64') };
  }
  for (const path of Object.keys(before)) if (!(path in after)) changes[path] = null;
  return { changes, bytes };
}

export function recordingPath(recordDir, taskId, attempt) {
  return join(recordDir, taskId, `attempt-${attempt}.json`);
}

function runClaude({ command, args, prompt, cwd, env, signal }) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(command[0], [...command.slice(1), ...args], { cwd, env, signal, windowsHide: true });
    } catch (err) {
      resolvePromise({ exitCode: null, stdout, stderr, spawnError: err });
      return;
    }
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => resolvePromise({ exitCode: null, stdout, stderr, spawnError: err }));
    child.on('close', (exitCode) => resolvePromise({ exitCode, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

// options:
//   command      argv prefix for Claude Code (default ['claude']); tests point it at a fake
//   model        optional --model value
//   tools        allowed tools (default DEFAULT_TOOLS)
//   record       true to write a recording of every attempt (default true)
//   recordDir    where recordings go (default <projectDir>/evidence/recordings)
//   env          environment for the child (default process.env)
//   roles        agent id -> role instructions, added as a system prompt (default: agents/*.md)
export function createClaudeCodeWorker(options = {}) {
  const { command = ['claude'], model, tools = DEFAULT_TOOLS, record = true, recordDir, env = process.env } = options;
  let roles = options.roles;

  return async function claudeCodeWorker({ task, project, projectDir, attempt, idempotencyKey, signal }) {
    const prompt = buildPrompt(task, { project, attempt });
    const args = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits', '--no-session-persistence', '--allowedTools', tools.join(',')];
    if (model) args.push('--model', model);
    roles ??= Object.fromEntries(loadAgents().map((a) => [a.id, a.body]));
    if (roles[task.agent]) args.push('--append-system-prompt', roles[task.agent]);

    const before = snapshot(projectDir, task.owns_files);
    const run = await runClaude({ command, args, prompt, cwd: projectDir, env, signal });
    if (signal?.aborted) throw signal.reason;

    let reply = null;
    try {
      reply = JSON.parse(run.stdout);
    } catch {
      // handled below: a run that did not print the JSON result counts as a failure
    }
    const ok = run.exitCode === 0 && reply && !reply.is_error;
    const evidence = ok ? parseEvidence(reply.result) : [];
    const error = ok ? null : classifyFailure({ ...run, stdout: reply?.result ?? run.stdout });

    if (record) {
      const { changes, bytes } = diffSnapshots(before, snapshot(projectDir, task.owns_files));
      const rec = {
        recordingVersion: RECORDING_VERSION,
        task: task.id,
        attempt,
        idempotencyKey,
        contractSha256: contractHash(task),
        args,
        exitCode: run.exitCode,
        result: reply?.result ?? null,
        costUsd: reply?.total_cost_usd ?? null,
        evidence,
        error: error ? { code: error.code, message: error.message, hint: error.hint } : null,
        files: bytes <= MAX_RECORDED_BYTES ? changes : null,
        recordedAt: new Date().toISOString(),
      };
      const file = recordingPath(recordDir ?? join(projectDir, 'evidence', 'recordings'), task.id, attempt);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
    }

    if (error) throw error;
    return { evidence, costUsd: reply.total_cost_usd ?? null };
  };
}

const ERRORS = { AUTH_FAILED: AuthFailed, RATE_LIMITED: RateLimited, CONFIG_MISSING: ConfigMissing, UNAVAILABLE: Unavailable };

// Plays back recordings made by createClaudeCodeWorker: the same files are written, the same
// evidence returned and the same errors thrown, attempt by attempt. A recording made for a
// different task contract is refused rather than replayed.
export function createReplayWorker({ recordDir }) {
  return async function replayWorker({ task, projectDir, attempt }) {
    const file = recordingPath(recordDir, task.id, attempt);
    if (!existsSync(file)) {
      throw new ConfigMissing(`No recording for task ${task.id} attempt ${attempt}`, { hint: `Expected ${file}` });
    }
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    if (rec.contractSha256 !== contractHash(task)) {
      throw new ConfigInvalid(`The recording for ${task.id} was made for a different task contract`, {
        hint: 'Record the run again after changing a task.',
      });
    }
    if (rec.files === null) throw new ConfigInvalid(`The recording for ${task.id} is too large to replay`);
    for (const [path, change] of Object.entries(rec.files)) {
      const target = join(projectDir, path);
      if (change === null) rmSync(target, { force: true });
      else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(change.content, change.encoding));
      }
    }
    if (rec.error) {
      const Err = ERRORS[rec.error.code] ?? Unavailable;
      throw new Err(rec.error.message, { hint: rec.error.hint });
    }
    return { evidence: rec.evidence, costUsd: 0 };
  };
}

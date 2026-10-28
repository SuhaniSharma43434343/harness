#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.mjs';
import { matcher } from '../core/glob.mjs';
import { hasApproval } from '../core/project.mjs';
import { ROOT } from '../core/workspace.mjs';

// Claude Code PreToolUse hook (T09). Claude Code runs it before Read, Write, Edit, MultiEdit,
// NotebookEdit and Bash, with the tool call as JSON on stdin. Exit code 2 blocks the call and
// shows the reason to the agent.
//
// Always enforced:
//   - .env files are never read or written (only .env.example), and shell commands that read
//     them are blocked, so credentials stay out of agent output;
//   - the runtime's files under workspace/<project>/ (project.json, ledger.jsonl, board/,
//     locks/, evidence/recordings/, evidence/tasks/) change only through forge commands;
//   - a production deploy needs B7: `forge deploy <project> --production` is checked against
//     the ledger, and deploying with the Vercel CLI directly is blocked.
// For a task worker (FORGE_PROJECT and FORGE_TASK set by forge run):
//   - writes must stay inside the project and match the task's owns_files, and never
//     must_not_touch;
//   - the shell is not available.

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const RUNTIME = /^(project\.json|ledger\.jsonl|board(\/|$)|locks(\/|$)|evidence\/(recordings|tasks)(\/|$))/;
const ENV_FILE = /^\.env(\..+)?$/;
const ENV_IN_COMMAND = /(^|[\s'"=/\\<(])\.env(\.(?!example\b)[A-Za-z0-9_-]+)?(?=$|[\s'");|&>])/;
const VERCEL_PROD = /\bvercel\b[^\n|;&]*\s--prod(uction)?\b/;
const FORGE_PROD = /\bforge(?:\.cmd)?\s+deploy\s+([a-z0-9][a-z0-9-]*)\b[^\n|;&]*\s--prod(uction)?\b/;

const deny = (reason) => ({ allow: false, reason });
const ALLOW = { allow: true };
const slash = (p) => p.replace(/\\/g, '/');

const isEnvFile = (p) => ENV_FILE.test(basename(p)) && basename(p) !== '.env.example';

function workspaceDir(env, root) {
  if (env.FORGE_WORKSPACE) return resolve(env.FORGE_WORKSPACE);
  try {
    const dir = loadConfig(root, { env }).config.workspaceDir;
    return isAbsolute(dir) ? dir : join(root, dir);
  } catch {
    return join(root, 'workspace');
  }
}

// { project, rel } when the path is inside the workspace, otherwise null.
function inWorkspace(abs, workspace) {
  const rel = slash(relative(workspace, abs));
  if (!rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel)) return null;
  const [project, ...rest] = rel.split('/');
  return { project, rel: rest.join('/') };
}

function loadTask(workspace, project, taskId) {
  const file = join(workspace, project, 'board', `${taskId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function decide({ toolName, toolInput = {}, cwd = process.cwd(), env = process.env, root = ROOT }) {
  const worker = env.FORGE_PROJECT && env.FORGE_TASK ? { project: env.FORGE_PROJECT, task: env.FORGE_TASK } : null;
  const workspace = workspaceDir(env, root);

  if (toolName === 'Bash') {
    const cmd = String(toolInput.command ?? '');
    if (worker) return deny('Task workers have no shell. Change only the files in your contract.');
    if (ENV_IN_COMMAND.test(cmd)) return deny('Commands may not read or write .env files; credentials stay out of agent output.');
    if (VERCEL_PROD.test(cmd)) return deny('Deploy to production with `forge deploy <project> --production`, which checks B7, not with the Vercel CLI.');
    const m = cmd.match(FORGE_PROD);
    if (m) {
      let approved = false;
      try {
        approved = hasApproval(m[1], 'B7', { workspace });
      } catch {
        approved = false;
      }
      if (!approved) return deny(`B7 is not recorded for ${m[1]}. The operator must run forge approve ${m[1]} B7 before a production deploy.`);
    }
    return ALLOW;
  }

  const path = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path;
  if (!path) return ALLOW;
  const abs = resolve(cwd, path);
  if (isEnvFile(abs)) return deny('.env files hold the operator’s credentials and are never read or changed by agents. Use .env.example to document a variable.');
  if (!WRITE_TOOLS.has(toolName)) return ALLOW;

  const where = inWorkspace(abs, workspace);
  if (where && RUNTIME.test(where.rel)) {
    return deny(`${where.rel} belongs to the forge runtime. Change it only through forge commands.`);
  }
  if (!worker) return ALLOW;

  if (!where || where.project !== worker.project) return deny(`Write outside project ${worker.project}. Task ${worker.task} may change only its own files.`);
  let task;
  try {
    task = loadTask(workspace, worker.project, worker.task);
  } catch {
    task = null;
  }
  if (!task) return deny(`The contract for task ${worker.task} could not be read, so no write is allowed.`);
  if (matcher(task.must_not_touch ?? [])(where.rel)) return deny(`${where.rel} is in must_not_touch for task ${task.id}.`);
  if (!matcher(task.owns_files)(where.rel)) {
    return deny(`${where.rel} is not in owns_files for task ${task.id} (${task.owns_files.join(', ')}).`);
  }
  return ALLOW;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const worker = process.env.FORGE_PROJECT && process.env.FORGE_TASK;
  let result;
  try {
    const call = JSON.parse(input || '{}');
    result = decide({ toolName: call.tool_name, toolInput: call.tool_input, cwd: call.cwd });
  } catch (err) {
    // A worker fails closed; an interactive session gets a warning and carries on.
    if (worker) result = deny(`The forge guard could not check this call (${err.message}), so it is blocked.`);
    else {
      process.stderr.write(`forge guard: ${err.message}\n`);
      process.exit(1);
    }
  }
  if (!result.allow) {
    process.stderr.write(`Blocked by forge: ${result.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

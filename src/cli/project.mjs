import { isAbsolute, join } from 'node:path';
import { listTasks } from '../core/board.mjs';
import { loadConfig } from '../core/config.mjs';
import { agentsForPhase } from '../core/agents.mjs';
import { approvals, approve, createProject, loadProject, nextPhases, PHASES } from '../core/project.mjs';
import { resume } from '../core/recovery.mjs';
import { runProject } from '../core/runner.mjs';
import { createClaudeCodeWorker, createReplayWorker } from '../workers/claude-code.mjs';

// Workspace folder from forge.config.json (relative paths are relative to the harness root).
function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

export function cmdNew(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error('Usage: forge new <project> [--brief <file>]');
    return 2;
  }
  const state = createProject(project, { brief: flag(args, '--brief'), workspace: workspaceFor(root) });
  console.log(`Created ${project} in phase ${state.phase}.`);
  return 0;
}

export function cmdApprove(root, args) {
  const [project, code] = args;
  if (!project || !code) {
    console.error('Usage: forge approve <project> <A0-A3|B1-B7> [--note <text>]');
    return 2;
  }
  const entry = approve(project, code, { note: flag(args, '--note'), workspace: workspaceFor(root) });
  console.log(`Recorded ${code} for ${project} (ledger #${entry.seq}).`);
  return 0;
}

export function cmdStatus(root, args) {
  const [project] = args;
  if (!project) {
    console.error('Usage: forge status <project> [--json]');
    return 2;
  }
  const opts = { workspace: workspaceFor(root) };
  const state = loadProject(project, opts);
  const tasks = listTasks(project, opts);
  const recorded = approvals(project, opts);
  const report = {
    project,
    phase: state.phase,
    phaseId: PHASES.find((p) => p.name === state.phase).id,
    next: nextPhases(state.phase),
    needsApproval: PHASES.find((p) => p.name === state.phase).exitApproval ?? null,
    approvals: recorded.map((a) => a.approval),
    repairLoops: state.repairLoops,
    tasks: tasks.map((t) => ({ id: t.id, status: t.status, attempts: t.attempts ?? 0, blocked_reason: t.blocked_reason })),
  };
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(`${project}: ${report.phaseId} ${report.phase}`);
  if (report.needsApproval) {
    const have = report.approvals.includes(report.needsApproval);
    console.log(`  exit approval ${report.needsApproval}: ${have ? 'recorded' : 'not recorded'}`);
  }
  console.log(`  approvals: ${report.approvals.join(', ') || 'none'}`);
  console.log(`  tasks: ${tasks.length}`);
  for (const t of report.tasks) {
    console.log(`    ${t.status.padEnd(9)} ${t.id}${t.blocked_reason ? ` (${t.blocked_reason})` : ''}`);
  }
  return 0;
}

export function cmdResume(root, args) {
  const [project] = args;
  if (!project) {
    console.error('Usage: forge resume <project> [--json]');
    return 2;
  }
  const report = resume(project, { workspace: workspaceFor(root) });
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const list = (xs) => xs.join(', ') || 'none';
  console.log(`Resumed ${project}.`);
  if (report.reconciled) console.log('  project.json was rebuilt from the ledger');
  console.log(`  requeued: ${list(report.requeued)}`);
  console.log(`  blocked: ${list(report.blocked)}`);
  console.log(`  still running: ${list(report.stillRunning)}`);
  console.log(`  waiting for verification: ${list(report.toVerify)}`);
  return 0;
}

// forge run: runs every task that can start, through Claude Code or from recordings (--replay).
export async function cmdRun(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error('Usage: forge run <project> [--replay <recordings dir>] [--model <model>] [--json]');
    return 2;
  }
  const replay = flag(args, '--replay');
  const worker = replay ? createReplayWorker({ recordDir: replay }) : createClaudeCodeWorker({ model: flag(args, '--model') });
  const workspace = workspaceFor(root);
  const { phase } = loadProject(project, { workspace });
  const summary = await runProject(project, { workspace, worker, agents: agentsForPhase(phase) });
  if (args.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const list = (xs) => xs.join(', ') || 'none';
    console.log(`Ran ${project} in phase ${phase}${replay ? ' from recordings' : ''}.`);
    console.log(`  done: ${list(summary.done)}`);
    for (const b of summary.blocked) console.log(`  blocked: ${b.task} (${b.reason})`);
    for (const w of summary.waiting) {
      const why = w.notInPhase ? ` (${w.notInPhase} does not work in ${phase})` : w.on.length ? ` on ${w.on.join(', ')}` : '';
      console.log(`  waiting: ${w.task}${why}`);
    }
    for (const e of summary.errors) console.log(`  error: ${e.task}: ${e.code} ${e.message}`);
  }
  return summary.blocked.length || summary.errors.length ? 1 : 0;
}

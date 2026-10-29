import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { loadProject } from '../core/project.mjs';
import { GATE_ORDER } from '../gates/index.mjs';
import { openDefects } from '../qa/defects.mjs';
import { runRepairLoop } from '../qa/repair.mjs';
import { qaReview } from '../qa/review.mjs';
import { createClaudeCodeWorker, createReplayWorker } from '../workers/claude-code.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const USAGE = 'Usage: forge qa <project> [--gate <name>]... [--repair [--replay <dir>] [--model <model>]] [--json]';

// forge qa: the QA Verifier. Without --repair, one review (P11): gates, fresh evidence,
// reports/defects.json. With --repair, the P11/P12 loop: the builder gets repair tasks and
// the QA Verifier re-reviews, up to 3 times, then escalates.
export async function cmdQa(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const gates = args.flatMap((a, i) => (args[i - 1] === '--gate' ? [a] : []));
  const unknown = gates.filter((g) => !GATE_ORDER.includes(g));
  if (unknown.length) {
    console.error(`Unknown gate: ${unknown.join(', ')}\n${USAGE}`);
    return 2;
  }
  const workspace = workspaceFor(root);
  loadProject(project, { workspace });
  const opts = { workspace, ...(gates.length ? { gates } : {}) };

  let report;
  let met;
  if (args.includes('--repair')) {
    const replay = flag(args, '--replay');
    const worker = replay ? createReplayWorker({ recordDir: replay }) : createClaudeCodeWorker({ model: flag(args, '--model') });
    const r = await runRepairLoop(project, { ...opts, worker });
    report = r.report;
    met = r.outcome === 'passed';
    if (!args.includes('--json')) console.log(r.outcome === 'passed' ? `Quality floor met after ${r.loops} repair loop(s).` : `Escalated after ${r.loops} repair loops: see reports/escalation.md.`);
  } else {
    const r = await qaReview(project, opts);
    report = r.report;
    met = r.floor.met && !openDefects(report).length;
    if (!args.includes('--json')) console.log(`Review ${report.review}: quality floor ${r.floor.met ? 'met' : `not met (${r.floor.failing.join(', ')})`}. Evidence in ${r.evidenceDir}/.`);
  }
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const d of report.defects.filter((d) => d.status !== 'verified')) console.log(`  ${d.id} ${d.status.padEnd(9)} ${d.gate} ${d.finding}: ${d.message}`);
    const verified = report.defects.filter((d) => d.status === 'verified').length;
    if (verified) console.log(`  ${verified} defect(s) verified fixed.`);
  }
  return met ? 0 : 1;
}

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionDenied } from '../core/errors.mjs';
import { addTask } from '../core/board.mjs';
import * as ledger from '../core/ledger.mjs';
import { advancePhase, loadProject, MAX_REPAIR_LOOPS } from '../core/project.mjs';
import { runTask } from '../core/runner.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { runGate } from '../gates/index.mjs';
import { buildSite } from '../site/build.mjs';
import { openDefects } from './defects.mjs';
import { qaReview, readDefects, REPORT } from './review.mjs';

// The files a builder may change to fix a gate's defects. Locked content, the brief, the
// evidence and the reports are never the builder's.
const GATE_FILES = {
  claims: ['site/src/**', 'content/claims.json'],
  licences: ['site/src/**', 'site/public/**', 'assets/register.json', 'assets/licences/**'],
  dependencies: ['site/package.json', 'site/package-lock.json', 'assets/register.json'],
};
const NEVER = ['evidence/**', 'reports/**', 'intake/**', 'content/pages/**', 'board/**', 'project.json', 'ledger.jsonl'];

function approaches(dir) {
  const file = join(dir, 'design', 'approach-decision.json');
  if (!existsSync(file)) return ['APP-01'];
  return readJson(file).decisions.filter((d) => d.selected).map((d) => d.approach);
}

// repairTasks(project, report, loop, opts?) => Task[]
// One builder task per gate with open defects. Its acceptance lists the defects, and its
// verify command re-runs that gate. The task finishing does not close a defect: only the
// QA Verifier's next review does.
export function repairTasks(project, report, loop, opts = {}) {
  const dir = assertProjectExists(project, opts).dir;
  const byGate = new Map();
  for (const d of openDefects(report)) byGate.set(d.gate, [...(byGate.get(d.gate) ?? []), d]);
  return [...byGate].map(([gate, defects]) => ({
    id: `repair-${loop}-${gate}`,
    agent: 'builder',
    approach_modules: approaches(dir),
    inputs: [REPORT, ...new Set(defects.flatMap((d) => d.evidence))],
    // A project without site sources (a prebuilt site, as in the gate fixtures) is fixed in its build.
    owns_files: [...(GATE_FILES[gate] ?? ['site/src/**', 'site/public/**']), ...(existsSync(join(dir, 'site', 'src', 'pages')) ? [] : ['site/dist/**'])],
    must_not_touch: NEVER,
    depends_on: [],
    acceptance: defects.map((d) => `${d.id} fixed: ${d.message}${d.location ? ` (${d.location})` : ''}`),
    verify: `forge gates ${project} --gate ${gate}`,
    budget: { minutes: 30, retries: 1 },
    idempotency_key: `${project}:repair:${loop}:${gate}`,
    status: 'pending',
    evidence: [],
  }));
}

// A verifier for repair tasks that runs the gate in the task's verify command in-process
// (the same check as the forge gates command, without needing a shell or the CLI config).
// The builder edits site sources but cannot run a build, so a site with sources is built first:
// otherwise the gate would check the old site/dist and no fix could ever pass.
export function gateVerifier(project, opts = {}) {
  return async (command) => {
    const gates = [...command.matchAll(/--gate\s+([a-z-]+)/g)].map((m) => m[1]);
    const dir = assertProjectExists(project, opts).dir;
    if (existsSync(join(dir, 'site', 'src', 'pages'))) {
      const b = buildSite(join(dir, 'site'));
      if (!b.ok) return { ok: false, code: b.code ?? 1, output: `The site did not build after the repair:\n${b.output.trim().split('\n').slice(-20).join('\n')}` };
    }
    const lines = [];
    let ok = gates.length > 0;
    for (const g of gates) {
      const r = await runGate(g, join(dir, 'site'), { ...opts.gateOptions, project, projectDir: dir });
      lines.push(`${g}: ${r.status}`, ...r.findings.map((f) => `  ${f.severity} ${f.id}: ${f.message}`));
      if (r.status !== 'pass') ok = false;
    }
    return { ok, code: ok ? 0 : 1, output: lines.join('\n') };
  };
}

// runRepairLoop(project, opts) => Promise<{ outcome: 'passed' | 'escalated', loops, report }>
// P11 and P12: review, and while the quality floor is not met, hand the open defects to the
// builder as repair tasks, run them, and review again with fresh evidence. After
// MAX_REPAIR_LOOPS (3) repairs with defects still open, the defects are escalated to the
// operator (reports/escalation.md and a ledger note); the project stays in QUALITY_REVIEW.
// opts: { worker (the builder), verifier?, workspace, now?, gates?, browser?, adapters?, thresholds? }
export async function runRepairLoop(project, opts = {}) {
  const { worker, verifier, ...rest } = opts;
  const state = loadProject(project, rest);
  if (state.phase === 'REPAIR') advancePhase(project, 'QUALITY_REVIEW', { actor: 'qa-verifier', ...rest });
  else if (state.phase !== 'QUALITY_REVIEW') {
    throw new PermissionDenied(`${project} is in ${state.phase}; the repair loop runs in QUALITY_REVIEW`, { hint: 'Finish the build and integration tests first.' });
  }
  const gateOptions = { gates: rest.gates, browser: rest.browser, adapters: rest.adapters, thresholds: rest.thresholds, now: rest.now };

  let { report, floor } = await qaReview(project, rest);
  let loops = 0;
  while (!floor.met || openDefects(report).length) {
    if (loadProject(project, rest).repairLoops >= MAX_REPAIR_LOOPS) return escalate(project, report, rest);
    advancePhase(project, 'REPAIR', { actor: 'qa-verifier', ...rest });
    loops = loadProject(project, rest).repairLoops;
    for (const task of repairTasks(project, report, loops, rest)) {
      addTask(project, task, rest);
      const result = await runTask(project, task.id, { ...rest, worker, verifier: verifier ?? gateVerifier(project, { ...rest, gateOptions }), actor: 'qa-verifier' });
      report.defects = report.defects.map((d) => (task.acceptance.some((a) => a.startsWith(`${d.id} `)) ? { ...d, fixTasks: [...new Set([...(d.fixTasks ?? []), task.id])] } : d));
      ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_task', task: task.id, status: result.status, defects: task.acceptance.map((a) => a.split(' ')[0]) } }, rest);
    }
    writeJsonAtomic(join(assertProjectExists(project, rest).dir, REPORT), report);
    advancePhase(project, 'QUALITY_REVIEW', { actor: 'qa-verifier', ...rest });
    ({ report, floor } = await qaReview(project, rest));
  }
  return { outcome: 'passed', loops, report };
}

function escalate(project, report, opts) {
  const dir = assertProjectExists(project, opts).dir;
  const open = openDefects(report);
  for (const d of open) {
    d.status = 'escalated';
    d.history.push({ review: report.review, status: 'escalated', note: `Still open after ${MAX_REPAIR_LOOPS} repair loops` });
  }
  report.escalated = true;
  writeJsonAtomic(join(dir, REPORT), report);
  const lines = [
    '# Escalation',
    '',
    `The quality floor is not met after ${MAX_REPAIR_LOOPS} repair loops. These defects need the operator's decision: fix them by hand, change the plan, or accept them in writing before B6.`,
    '',
    ...open.map((d) => `- ${d.id} ${d.gate} ${d.finding}${d.location ? ` at ${d.location}` : ''}: ${d.message}. Evidence: ${d.evidence.join(', ')}. Repair tasks: ${(d.fixTasks ?? []).join(', ') || 'none'}.`),
    '',
  ];
  writeFileSync(join(dir, 'reports', 'escalation.md'), lines.join('\n'));
  ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_escalated', defects: open.map((d) => d.id), loops: MAX_REPAIR_LOOPS } }, opts);
  return { outcome: 'escalated', loops: MAX_REPAIR_LOOPS, report };
}

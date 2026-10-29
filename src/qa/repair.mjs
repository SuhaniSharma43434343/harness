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
  // A gate that was skipped waits on another phase (content-parity until B3), which no
  // builder can do, so it gets no task and goes to the operator.
  for (const d of openDefects(report).filter((x) => x.finding !== 'gate-skipped')) byGate.set(d.gate, [...(byGate.get(d.gate) ?? []), d]);
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
// The gates read site/dist, so a site with sources is built first: a fix in site/src counts
// only once it is in the build. opts.build replaces buildSite (tests).
export function gateVerifier(project, opts = {}) {
  const build = opts.build ?? buildSite;
  return async (command) => {
    const gates = [...command.matchAll(/--gate\s+([a-z-]+)/g)].map((m) => m[1]);
    const dir = assertProjectExists(project, opts).dir;
    const lines = [];
    if (existsSync(join(dir, 'site', 'src', 'pages'))) {
      const b = build(join(dir, 'site'));
      if (!b.ok) return { ok: false, code: b.code ?? 1, output: `The site does not build:\n${b.output.trim().split('\n').slice(-20).join('\n')}` };
      lines.push('Rebuilt site/dist from site/src.');
    }
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
    // Nothing a builder can repair is left, so another loop would change nothing.
    if (!repairTasks(project, report, 0, rest).length) return escalate(project, report, rest, 'No open defect can be repaired by a builder');
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

function escalate(project, report, opts, why) {
  const dir = assertProjectExists(project, opts).dir;
  const open = openDefects(report);
  const loops = loadProject(project, opts).repairLoops;
  const reason = why ?? `Still open after ${MAX_REPAIR_LOOPS} repair loops`;
  for (const d of open) {
    d.status = 'escalated';
    d.history.push({ review: report.review, status: 'escalated', note: reason });
  }
  report.escalated = true;
  writeJsonAtomic(join(dir, REPORT), report);
  const lines = [
    '# Escalation',
    '',
    `The quality floor is not met after ${loops} repair loop${loops === 1 ? '' : 's'}${why ? ` (${why.toLowerCase()})` : ''}. These defects need the operator's decision: fix them by hand, change the plan, or accept them in writing before B6.`,
    '',
    ...open.map((d) => `- ${d.id} ${d.gate} ${d.finding}${d.location ? ` at ${d.location}` : ''}: ${d.message}. Evidence: ${d.evidence.join(', ')}. Repair tasks: ${(d.fixTasks ?? []).join(', ') || 'none'}.`),
    '',
  ];
  writeFileSync(join(dir, 'reports', 'escalation.md'), lines.join('\n'));
  ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_escalated', defects: open.map((d) => d.id), loops, ...(why ? { reason: why } : {}) } }, opts);
  return { outcome: 'escalated', loops, report };
}

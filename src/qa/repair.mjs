import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionDenied } from '../core/errors.mjs';
import { addTask } from '../core/board.mjs';
import * as ledger from '../core/ledger.mjs';
import { advancePhase, loadProject, repairCap } from '../core/project.mjs';
import { runTask, shellVerifier } from '../core/runner.mjs';
import { ROOT, assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { GATE_ORDER, runGate } from '../gates/index.mjs';
import { openDefects } from './defects.mjs';
import { qaReview, readDefects, REPORT } from './review.mjs';
import { writeQaReport } from './report.mjs';

// The files a builder may change to fix a gate's defects. Locked content, the brief, the
// evidence and the reports are never the builder's.
const GATE_FILES = {
  claims: ['site/src/**', 'content/claims.json'],
  licences: ['site/src/**', 'site/public/**', 'assets/register.json', 'assets/licences/**'],
  dependencies: ['site/package.json', 'site/package-lock.json', 'assets/register.json'],
};
const NEVER = ['evidence/**', 'reports/**', 'intake/**', 'content/pages/**', 'board/**', 'project.json', 'ledger.jsonl'];
// Below this, a repair plus the review that must confirm it cannot both run.
const MIN_VERIFIABLE_REPAIR_USD = 1.5;

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
  if (existsSync(join(dir, 'design', 'section-plan.json'))) return designRepairTask(project, dir, report, loop);
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

// A designed site is one piece of work: every open defect goes to one builder task with the
// specification and the screenshots, and its verify command rebuilds and re-renders the site.
function designRepairTask(project, dir, report, loop) {
  const defects = openDefects(report);
  if (!defects.length) return [];
  return [
    {
      id: `repair-${loop}-design`,
      agent: 'builder',
      approach_modules: approaches(dir),
      inputs: [REPORT, 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json', 'content/copy.json', ...new Set(defects.flatMap((d) => d.evidence))],
      owns_files: ['site/src/sections/**', 'site/src/styles/**', 'site/src/components/**', 'site/src/layouts/**', 'site/src/lib/**', 'site/public/**', 'site/package.json', 'assets/register.json'],
      must_not_touch: [...NEVER, 'design/**', 'content/**', 'site/src/content/**'],
      depends_on: [],
      acceptance: [
        ...defects.map((d) => `${d.id} fixed: ${d.message}${d.location ? ` (${d.location})` : ''}`),
        'Fix what the specification says should be there, and do not change the specification or the copy. Look at the evidence screenshots first',
      ],
      verify: `"${process.execPath}" "${join(ROOT, 'src', 'cli', 'index.mjs')}" check site-build`,
      budget: { minutes: 45, retries: 1 },
      idempotency_key: `${project}:repair:${loop}:design`,
      status: 'pending',
      evidence: [],
    },
  ];
}

// A verifier for repair tasks that runs the gate in the task's verify command in-process
// (the same check as the forge gates command, without needing a shell or the CLI config).
export function gateVerifier(project, opts = {}) {
  return async (command, ctx) => {
    const gates = [...command.matchAll(/--gate\s+([a-z-]+)/g)].map((m) => m[1]);
    if (!gates.length && / check /.test(command)) return shellVerifier(command, ctx);
    const dir = assertProjectExists(project, opts).dir;
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
// opts.maxRepairLoops (default 3) repairs with defects still open, the defects are escalated
// to the operator (reports/escalation.md and a ledger note); the project stays in QUALITY_REVIEW.
// After a repair, the review retests only the gates with open defects and the ones failing the
// floor; when that comes back clean, one full review checks every gate for regressions before
// the loop reports passed, so a pass always rests on a complete current review.
// opts.retest: 'full' re-runs every gate after every repair instead (the old behaviour).
// opts: { worker (the builder), verifier?, workspace, now?, gates?, maxRepairLoops?, retest?, browser?, adapters?, thresholds? }
export async function runRepairLoop(project, opts = {}) {
  const { worker, verifier, ...rest } = opts;
  if (existsSync(join(assertProjectExists(project, rest).dir, 'design', 'section-plan.json'))) rest.visualWorker ??= worker;
  const state = loadProject(project, rest);
  if (state.phase === 'REPAIR') advancePhase(project, 'QUALITY_REVIEW', { actor: 'qa-verifier', ...rest });
  else if (state.phase !== 'QUALITY_REVIEW') {
    throw new PermissionDenied(`${project} is in ${state.phase}; the repair loop runs in QUALITY_REVIEW`, { hint: 'Finish the build and integration tests first.' });
  }
  const gateOptions = { gates: rest.gates, browser: rest.browser, adapters: rest.adapters, thresholds: rest.thresholds, now: rest.now };

  let { report, floor, results } = await qaReview(project, rest);
  let loops = 0;
  // Escalated defects that still reproduce go back to the builder when the operator re-runs the
  // loop with room left under the cap: a raised --max-loops is that decision, in writing.
  const escalated = (report.defects ?? []).filter((d) => d.status === 'escalated');
  if (escalated.length && loadProject(project, rest).repairLoops < repairCap(rest)) {
    for (const d of escalated) {
      d.status = 'open';
      d.history.push({ review: report.review, status: 'reopened', note: `Reopened: the repair cap (${repairCap(rest)}) leaves room for another loop` });
    }
    report.escalated = false;
    writeJsonAtomic(join(assertProjectExists(project, rest).dir, REPORT), report);
    ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_reopened', defects: escalated.map((d) => d.id), cap: repairCap(rest) } }, rest);
  }
  while (!floor.met || openDefects(report).length) {
    if (rest.budgetExhausted?.()) return { outcome: 'budget', loops, report };
    // A repair the budget cannot re-verify would end as a permanently stale review, worse than
    // stopping now: the last verified state stays authoritative.
    if (rest.budgetRemaining && rest.budgetRemaining() < MIN_VERIFIABLE_REPAIR_USD) {
      ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_skipped_budget', remainingUsd: rest.budgetRemaining(), neededUsd: MIN_VERIFIABLE_REPAIR_USD } }, rest);
      return { outcome: 'insufficient-budget', loops, report };
    }
    if (loadProject(project, rest).repairLoops >= repairCap(rest)) return escalate(project, report, rest, results);
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
    if (rest.retest === 'full') {
      ({ report, floor, results } = await qaReview(project, rest));
    } else {
      // Retest what the repair was about; unrelated gates are not re-run until the final pass.
      const required = rest.gates ?? GATE_ORDER;
      const targeted = [...new Set([...openDefects(report).map((d) => d.gate), ...floor.failing])].filter((g) => required.includes(g));
      if (targeted.length === required.length) {
        ({ report, floor, results } = await qaReview(project, rest));
      } else {
        ({ report, floor, results } = await qaReview(project, { ...rest, gates: targeted }));
        // Clean on the targeted gates: one full review, so no regression elsewhere slips through.
        if (floor.met && !openDefects(report).length) ({ report, floor, results } = await qaReview(project, rest));
      }
    }
  }
  return { outcome: 'passed', loops, report };
}

function escalate(project, report, opts, results = []) {
  const dir = assertProjectExists(project, opts).dir;
  const loops = loadProject(project, opts).repairLoops;
  const open = openDefects(report);
  for (const d of open) {
    d.status = 'escalated';
    d.history.push({ review: report.review, status: 'escalated', note: `Still open after ${loops} repair loops` });
  }
  report.escalated = true;
  writeJsonAtomic(join(dir, REPORT), report);
  // List everything the operator owns, not only this round's: a re-escalation with nothing
  // newly open must never overwrite the file with an empty list.
  const listed = report.defects.filter((d) => d.status === 'escalated');
  const lines = [
    '# Escalation',
    '',
    `The quality floor is not met after ${loops} repair loops. These defects need the operator's decision: fix them by hand, change the plan, or accept them in writing before B6.`,
    '',
    ...listed.map((d) => `- ${d.id} ${d.gate} ${d.finding}${d.location ? ` at ${d.location}` : ''}: ${String(d.message).replace(/\s+/g, ' ')}. Evidence: ${d.evidence.join(', ')}. Repair tasks: ${(d.fixTasks ?? []).join(', ') || 'none'}.`),
    '',
  ];
  writeFileSync(join(dir, 'reports', 'escalation.md'), lines.join('\n'));
  // The hand-over report must agree with defects.json at exactly this moment.
  writeQaReport(dir, project, report, results);
  ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'repair_escalated', defects: open.map((d) => d.id), loops } }, opts);
  return { outcome: 'escalated', loops, report };
}

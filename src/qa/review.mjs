import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from '../core/ledger.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { addTask } from '../core/board.mjs';
import { runTask } from '../core/runner.mjs';
import { GATE_ORDER, GATES, qualityFloor, runGate, runGates } from '../gates/index.mjs';
import { visualReviewTask } from './visual.mjs';
import { mergeReview, openDefects } from './defects.mjs';
import { writeQaReport } from './report.mjs';

export const REPORT = 'reports/defects.json';

export function readDefects(project, opts = {}) {
  const file = join(assertProjectExists(project, opts).dir, REPORT);
  return existsSync(file) ? readJson(file) : null;
}

// qaReview(project, opts?) => Promise<{ report, results, floor, evidenceDir }>
// One QA Verifier review (P11, and every re-verification after repair): runs the gates on
// site/, writes fresh evidence to evidence/qa/review-N/, merges the findings into
// reports/defects.json and appends a readable entry to reports/qa-log.md. The builder's own
// reports are never read here: only the gates decide.
// opts: { workspace, gates?, now?, ...runGates options (browser, adapters, thresholds) }
export async function qaReview(project, opts = {}) {
  const { now = () => new Date(), ...rest } = opts;
  const paths = assertProjectExists(project, opts);
  const previous = readDefects(project, opts);
  const number = (previous?.review ?? 0) + 1;
  const evidenceDir = `evidence/qa/review-${number}`;
  const required = opts.gates ?? GATE_ORDER;
  const site = join(paths.dir, 'site');
  const gateOpts = { ...rest, project, projectDir: paths.dir, write: false, now };
  const wanted = required.filter((g) => GATES.has(g));
  // Hybrid order: the render the review needs comes first; then the model's review runs alongside
  // every gate that does not depend on it; then the review's own gate and, last and alone, speed,
  // because a busy machine makes Lighthouse numbers wrong. design-fidelity is not rendered twice.
  let fidelity = null;
  let looking = null;
  if (opts.visualWorker && required.includes('visual-review') && !opts.budgetExhausted?.()) ({ fidelity, looking } = await lookAtTheSite(project, paths.dir, number, opts, gateOpts));
  const LAST = ['visual-review', 'performance'];
  const alongside = wanted.filter((g) => !LAST.includes(g) && !(fidelity && g === 'design-fidelity'));
  const middle = await runGates(site, { ...gateOpts, gates: alongside });
  if (looking) {
    const failed = await looking;
    if (failed) throw failed;
  }
  const tail = [];
  for (const g of LAST.filter((x) => wanted.includes(x))) tail.push(...(await runGates(site, { ...gateOpts, gates: [g] })));
  const byGate = new Map([...middle, ...(fidelity && wanted.includes('design-fidelity') ? [fidelity] : []), ...tail].map((r) => [r.gate, r]));
  const order = [...GATE_ORDER.filter((g) => wanted.includes(g)), ...wanted.filter((g) => !GATE_ORDER.includes(g))];
  const results = order.map((g) => byGate.get(g)).filter(Boolean);

  mkdirSync(join(paths.dir, evidenceDir), { recursive: true });
  const written = new Map();
  for (const r of results) {
    const rel = `${evidenceDir}/${r.gate}.json`;
    writeFileSync(join(paths.dir, rel), JSON.stringify(r, null, 2) + '\n');
    // Copy any extra evidence the gate produced (screenshots) into the list for its defects.
    written.set(r.gate, [rel, ...r.evidence.filter((e) => existsSync(join(paths.dir, e)))]);
  }
  const floor = qualityFloor(results, required);
  const report = mergeReview(previous, { project, number, now: now(), results, floor, evidenceFor: (g) => written.get(g) ?? null });
  writeJsonAtomic(join(paths.dir, REPORT), report);

  const open = openDefects(report);
  const verified = report.defects.filter((d) => d.verifiedIn === number);
  for (const r of results) ledger.append(project, { actor: 'qa-verifier', type: 'gate_result', data: { gate: r.gate, status: r.status, findings: r.findings.length, evidence: `${evidenceDir}/${r.gate}.json`, review: number } }, opts);
  ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'qa_review', review: number, floorMet: floor.met, gates: required, open: open.map((d) => d.id), verified: verified.map((d) => d.id) } }, opts);
  appendLog(paths.dir, report, results, verified, now(), required);
  writeQaReport(paths.dir, project, report, results, now());
  return { report, results, floor, evidenceDir };
}

// Renders the current build, then starts the QA Verifier's look at the screenshots. Returns the
// render's gate result, so the review does not render again, and the running look, to wait for:
// it settles to null, or to the error, so a failure waits until the other gates finish. The render
// takes the review's gate options and, as before, writes its evidence.
async function lookAtTheSite(project, dir, number, opts, gateOpts) {
  const { visualWorker, verifier, ...rest } = opts;
  const { write, ...renderOpts } = gateOpts;
  const fidelity = await runGate('design-fidelity', join(dir, 'site'), renderOpts);
  const task = addTask(project, visualReviewTask(project, dir, number), rest);
  const looking = runTask(project, task.id, { ...rest, worker: visualWorker, ...(verifier ? { verifier } : {}), actor: 'qa-verifier' }).then((result) => {
    ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'visual_review', task: task.id, status: result.status } }, rest);
    return null;
  }, (err) => err);
  return { fidelity, looking };
}

function appendLog(dir, report, results, verified, at, required = GATE_ORDER) {
  const file = join(dir, 'reports', 'qa-log.md');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const lines = [];
  if (!existsSync(file)) lines.push('# QA log', '', 'Written by the QA Verifier after every review. Evidence is in evidence/qa/review-N/.', '');
  lines.push(`## Review ${report.review} (${at.toISOString()})`, '');
  const partial = GATE_ORDER.some((g) => !required.includes(g));
  lines.push(`Quality floor${partial ? ` (scope: ${required.join(', ')})` : ''}: ${report.qualityFloor.met ? 'met' : `not met (${report.qualityFloor.failing.join(', ')})`}.`, '');
  lines.push('| Gate | Status | Findings |', '| --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.gate} | ${r.status} | ${r.findings.length} |`);
  lines.push('');
  for (const d of verified) lines.push(`- Verified ${d.id} (${d.gate} ${d.finding}) with ${d.verification[0]}`);
  for (const d of openDefects(report)) lines.push(`- Open ${d.id} (${d.gate} ${d.finding}): ${String(d.message).replace(/\s+/g, ' ')}`);
  if (report.escalated) lines.push('- Escalated to the operator.');
  lines.push('');
  writeFileSync(file, lines.join('\n') + '\n', { flag: 'a' });
}

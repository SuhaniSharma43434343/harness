import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from '../core/ledger.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { GATE_ORDER, GATES, qualityFloor, runGates } from '../gates/index.mjs';
import { mergeReview, openDefects } from './defects.mjs';

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
  const results = await runGates(join(paths.dir, 'site'), { ...rest, project, projectDir: paths.dir, gates: required.filter((g) => GATES.has(g)), write: false, now });

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
  ledger.append(project, { actor: 'qa-verifier', type: 'note', data: { event: 'qa_review', review: number, floorMet: floor.met, open: open.map((d) => d.id), verified: verified.map((d) => d.id) } }, opts);
  appendLog(paths.dir, report, results, verified, now());
  return { report, results, floor, evidenceDir };
}

function appendLog(dir, report, results, verified, at) {
  const file = join(dir, 'reports', 'qa-log.md');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const lines = [];
  if (!existsSync(file)) lines.push('# QA log', '', 'Written by the QA Verifier after every review. Evidence is in evidence/qa/review-N/.', '');
  lines.push(`## Review ${report.review} (${at.toISOString()})`, '');
  lines.push(`Quality floor: ${report.qualityFloor.met ? 'met' : `not met (${report.qualityFloor.failing.join(', ')})`}.`, '');
  lines.push('| Gate | Status | Findings |', '| --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.gate} | ${r.status} | ${r.findings.length} |`);
  lines.push('');
  for (const d of verified) lines.push(`- Verified ${d.id} (${d.gate} ${d.finding}) with ${d.verification[0]}`);
  for (const d of openDefects(report)) lines.push(`- Open ${d.id} (${d.gate} ${d.finding}): ${d.message}`);
  if (report.escalated) lines.push('- Escalated to the operator.');
  lines.push('');
  writeFileSync(file, lines.join('\n') + '\n', { flag: 'a' });
}

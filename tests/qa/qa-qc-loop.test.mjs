// The QA/QC loop upgrades: the hand-over report, the configurable repair cap, and the targeted
// retest with a final full-regression review. These run on the content gates only, so they need
// no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readdirSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject, loadProject, repairCap, MAX_REPAIR_LOOPS } from '../../src/core/project.mjs';
import { read as readLedger } from '../../src/core/ledger.mjs';
import { readJson, writeJsonAtomic } from '../../src/core/workspace.mjs';
import { FIXTURES_DIR, materializeFixture } from '../../src/gates/fixtures.mjs';
import { runRepairLoop } from '../../src/qa/repair.mjs';
import { qaReview } from '../../src/qa/review.mjs';
import { writeQaReport } from '../../src/qa/report.mjs';
import { cmdQa } from '../../src/cli/qa.mjs';

let n = 0;
function project(fixture) {
  const root = mkdtempSync(join(tmpdir(), 'forge-qaqc-'));
  const workspace = join(root, 'ws');
  const name = `qaqc-${++n}`;
  createProject(name, { workspace });
  cpSync(materializeFixture(fixture).dir, join(workspace, name), { recursive: true });
  const stateFile = join(workspace, name, 'project.json');
  writeJsonAtomic(stateFile, { ...readJson(stateFile), phase: 'QUALITY_REVIEW' });
  return { name, root, workspace, dir: join(workspace, name) };
}

// A builder that restores the known-good file its contract owns, like the T24 one but minimal:
// the seo-two-h1 fixture only edits site/dist/contact/index.html.
const KNOWN_GOOD = join(FIXTURES_DIR, 'known-good');
async function restoringBuilder({ projectDir, task }) {
  cpSync(join(KNOWN_GOOD, 'site', 'dist', 'contact', 'index.html'), join(projectDir, 'site', 'dist', 'contact', 'index.html'));
  return { evidence: [task.inputs[0]] };
}
const claimingBuilder = async ({ task }) => ({ evidence: [task.inputs[0]] });

test('repairCap: the default stands unless the operator gives a whole number of at least 1', () => {
  assert.equal(repairCap(), MAX_REPAIR_LOOPS);
  assert.equal(repairCap({}), MAX_REPAIR_LOOPS);
  assert.equal(repairCap({ maxRepairLoops: 5 }), 5);
  assert.equal(repairCap({ maxRepairLoops: 1 }), 1);
  for (const bad of [0, -1, 2.5, '4', null]) assert.equal(repairCap({ maxRepairLoops: bad }), MAX_REPAIR_LOOPS, String(bad));
});

test('a lowered cap escalates after that many loops, recorded in the ledger and the escalation note', async () => {
  const p = project('seo-two-h1');
  const result = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo'], worker: claimingBuilder, verifier: async () => ({ ok: true, code: 0, output: 'ok' }), maxRepairLoops: 1 });
  assert.equal(result.outcome, 'escalated');
  assert.equal(result.loops, 1);
  assert.equal(loadProject(p.name, { workspace: p.workspace }).repairLoops, 1);
  const note = readLedger(p.name, { workspace: p.workspace }).find((e) => e.data.event === 'repair_escalated');
  assert.equal(note.data.loops, 1);
  assert.match(readFileSync(join(p.dir, 'reports/escalation.md'), 'utf8'), /after 1 repair loops/);
});

test('after a repair, only the defective gates are retested, then one full review confirms before passing', async () => {
  const p = project('seo-two-h1');
  const result = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo', 'claims'], worker: restoringBuilder });
  assert.equal(result.outcome, 'passed');
  // Review 1: both gates. Review 2: only seo (the open defect). Review 3: both again (regression).
  assert.deepEqual(readdirSync(join(p.dir, 'evidence/qa/review-1')).sort(), ['claims.json', 'seo.json']);
  assert.deepEqual(readdirSync(join(p.dir, 'evidence/qa/review-2')), ['seo.json']);
  assert.deepEqual(readdirSync(join(p.dir, 'evidence/qa/review-3')).sort(), ['claims.json', 'seo.json']);
  const d = result.report.defects.find((x) => x.finding === 'h1-count');
  assert.equal(d.status, 'verified');
  assert.equal(d.verifiedIn, 2);
  assert.deepEqual(result.report.qualityFloor, { met: true, failing: [] });
});

test('--full-retest behaviour: retest "full" re-runs every gate after the repair, with no extra review', async () => {
  const p = project('seo-two-h1');
  const result = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo', 'claims'], worker: restoringBuilder, retest: 'full' });
  assert.equal(result.outcome, 'passed');
  assert.deepEqual(readdirSync(join(p.dir, 'evidence/qa/review-2')).sort(), ['claims.json', 'seo.json']);
  assert.equal(existsSync(join(p.dir, 'evidence/qa/review-3')), false);
});

test('every review rewrites reports/qa-report.md: defects, reproduction, verification and limitations', async () => {
  const p = project('seo-two-h1');
  await qaReview(p.name, { workspace: p.workspace, gates: ['seo', 'claims'] });
  const first = readFileSync(join(p.dir, 'reports/qa-report.md'), 'utf8');
  assert.match(first, /# QA\/QC report: /);
  assert.match(first, /Quality floor over the gates in scope \(claims, seo\): \*\*not met\*\* \(seo\)/);
  assert.match(first, /### D-001 - h1-count \(serious, seo\)/);
  assert.match(first, /- Status: Open/);
  assert.match(first, new RegExp(`- Reproduce: \`forge gates ${p.name} --gate seo\``));
  assert.match(first, /- Found in review 1; evidence: evidence\/qa\/review-1\/seo\.json/);
  assert.match(first, /\| claims \| pass \| 0 \|/);
  assert.match(first, /This review ran 2 of the \d+ default gates\. Not in scope, so not covered here: .*interactions/);
});

test('a raised cap reopens escalated defects and the loop repairs them to a verified pass', async () => {
  const p = project('seo-two-h1');
  const first = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo'], worker: claimingBuilder, verifier: async () => ({ ok: true, code: 0, output: 'ok' }), maxRepairLoops: 1 });
  assert.equal(first.outcome, 'escalated');
  assert.match(readFileSync(join(p.dir, 'reports/qa-report.md'), 'utf8'), /- Status: Escalated to the operator/);
  const second = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo'], worker: restoringBuilder, maxRepairLoops: 3 });
  assert.equal(second.outcome, 'passed');
  const d = second.report.defects.find((x) => x.finding === 'h1-count');
  assert.equal(d.status, 'verified');
  assert.ok(d.history.some((h) => h.status === 'reopened' && /repair cap/.test(h.note ?? '')), JSON.stringify(d.history));
  assert.ok(readLedger(p.name, { workspace: p.workspace }).some((e) => e.data.event === 'repair_reopened'));
  assert.match(readFileSync(join(p.dir, 'reports/qa-report.md'), 'utf8'), /- Status: Verified fixed in review/);
});

test('escalation lists the defects in escalation.md even when nothing is newly open, and records the real loop count', async () => {
  const p = project('seo-two-h1');
  await runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo'], worker: claimingBuilder, verifier: async () => ({ ok: true, code: 0, output: 'ok' }), maxRepairLoops: 1 });
  const esc = readFileSync(join(p.dir, 'reports/escalation.md'), 'utf8');
  assert.match(esc, /after 1 repair loops/);
  assert.match(esc, /D-001 seo h1-count/);
});

test('--max-loops with no value is refused, not silently ignored', async () => {
  const p = project('seo-two-h1');
  writeFileSync(join(p.root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const { error } = console;
  const errs = [];
  console.error = (...a) => errs.push(a.join(' '));
  let code;
  try {
    code = await cmdQa(p.root, [p.name, '--repair', '--max-loops']);
  } finally {
    console.error = error;
  }
  assert.equal(code, 2);
  assert.match(errs.join('\n'), /--max-loops takes a whole number/);
});

test('the report never claims a check that did not run: an errored gate is a limitation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-qaqc-report-'));
  const at = new Date('2026-11-04T00:00:00Z');
  const report = {
    schemaVersion: '0.1.0', project: 'demo', review: 2, updatedAt: at.toISOString(),
    qualityFloor: { met: false, failing: ['routes'] },
    defects: [{ id: 'D-001', key: 'seo|h1-count|/contact', gate: 'seo', finding: 'h1-count', severity: 'serious', message: '/contact has 2 h1 headings (expected 1)', location: '/contact', status: 'verified', foundIn: 1, verifiedIn: 2, evidence: ['evidence/qa/review-1/seo.json'], verification: ['evidence/qa/review-2/seo.json'], fixTasks: ['repair-1-seo'], history: [{ review: 1, status: 'found' }, { review: 2, status: 'verified' }] }],
    advisories: 2, escalated: false,
  };
  const results = [
    { gate: 'seo', status: 'pass', findings: [], evidence: [] },
    { gate: 'routes', status: 'error', findings: [], evidence: [], error: { code: 'UNAVAILABLE', message: 'no browser' } },
  ];
  const file = writeQaReport(dir, 'demo', report, results, at);
  const text = readFileSync(file, 'utf8');
  assert.match(text, /- Status: Verified fixed in review 2/);
  assert.match(text, /- Repair tasks: repair-1-seo/);
  assert.match(text, /- Verification evidence: evidence\/qa\/review-2\/seo\.json/);
  assert.match(text, /The routes gate did not run \(error\): no browser\. Nothing it checks is covered by this review\./);
  assert.match(text, /2 moderate or minor finding\(s\)/);
  assert.doesNotMatch(text, /\| routes \| pass \|/);
});

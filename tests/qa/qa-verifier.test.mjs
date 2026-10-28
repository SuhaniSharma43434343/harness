// T24: the QA Verifier, defect reports and the repair loop, end to end on the seeded defects.
// Each defect must be found by the QA Verifier, fixed by the builder (a fake builder that can
// only restore its contract's files), and verified by a later QA review with fresh evidence.
// A builder that only claims a fix never gets a defect closed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createProject, loadProject } from '../../src/core/project.mjs';
import { read as readLedger } from '../../src/core/ledger.mjs';
import { matcher } from '../../src/core/glob.mjs';
import { readJson, writeJsonAtomic } from '../../src/core/workspace.mjs';
import { check } from '../../src/core/schemas.mjs';
import { FIXTURES_DIR, listDefects, materializeFixture } from '../../src/gates/fixtures.mjs';
import { mergeReview } from '../../src/qa/defects.mjs';
import { repairTasks, runRepairLoop } from '../../src/qa/repair.mjs';
import { qaReview } from '../../src/qa/review.mjs';
import { cmdQa } from '../../src/cli/qa.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';

const BROWSER_GATES = new Set(['routes', 'accessibility', 'forms', 'responsive']);
let browser;
let noBrowser = false;
try {
  browser = await launchBrowser();
  await loadTool('axe-core');
} catch (err) {
  noBrowser = `browser test tools are not available (${err.message}): run scripts/setup.sh --with-test-tools`;
}
after(() => browser?.close());

// A Lighthouse stand-in that reads the page: a busy-wait script blocks the main thread.
const lighthouse = {
  audit: async (url) => {
    const html = await (await fetch(url)).text().catch(() => '');
    return { score: 0.97, lcp: 1100, cls: 0, fcp: 800, tbt: /while \(Date\.now\(\) < end\)/.test(html) ? 1900 : 20 };
  },
};
const adapters = { lighthouse };

let n = 0;
function project(fixture) {
  const root = mkdtempSync(join(tmpdir(), 'forge-qa-'));
  const workspace = join(root, 'ws');
  const name = `qa-${++n}`;
  createProject(name, { workspace });
  cpSync(materializeFixture(fixture).dir, join(workspace, name), { recursive: true });
  const stateFile = join(workspace, name, 'project.json');
  writeJsonAtomic(stateFile, { ...readJson(stateFile), phase: 'QUALITY_REVIEW' });
  return { name, root, workspace, dir: join(workspace, name) };
}

function files(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1)]));
}

// The fake builder: restores the known-good version of every file its contract owns, and
// nothing else. It reports evidence like a real worker.
const KNOWN_GOOD = join(FIXTURES_DIR, 'known-good');
async function restoringBuilder({ task, projectDir }) {
  const owns = matcher(task.owns_files);
  const changed = [];
  for (const rel of new Set([...files(projectDir), ...files(KNOWN_GOOD)])) {
    if (!owns(rel)) continue;
    const good = join(KNOWN_GOOD, rel);
    const mine = join(projectDir, rel);
    if (!existsSync(good)) {
      rmSync(mine);
      changed.push(rel);
    } else if (!existsSync(mine) || !readFileSync(good).equals(readFileSync(mine))) {
      mkdirSync(dirname(mine), { recursive: true });
      cpSync(good, mine);
      changed.push(rel);
    }
  }
  const log = `evidence/tasks/${task.id}/builder.md`;
  mkdirSync(join(projectDir, dirname(log)), { recursive: true });
  writeFileSync(join(projectDir, log), `Changed: ${changed.join(', ') || 'nothing'}\n`);
  return { evidence: [log] };
}

// A builder that says it fixed everything and changes nothing.
async function claimingBuilder({ task, projectDir }) {
  const log = `evidence/tasks/${task.id}/builder.md`;
  mkdirSync(join(projectDir, dirname(log)), { recursive: true });
  writeFileSync(join(projectDir, log), 'Fixed all defects.\n');
  return { evidence: [log] };
}

for (const defect of listDefects()) {
  const skip = BROWSER_GATES.has(defect.gate) && noBrowser;
  test(`${defect.id}: found by QA, fixed by the builder, verified by QA`, { skip }, async () => {
    const p = project(defect.id);
    const opts = { workspace: p.workspace, gates: [defect.gate], browser, adapters, screenshots: false };
    const result = await runRepairLoop(p.name, { ...opts, worker: restoringBuilder });

    assert.equal(result.outcome, 'passed');
    assert.equal(result.loops, 1);
    const d = result.report.defects.find((x) => x.finding === defect.finding);
    assert.ok(d, `QA found ${defect.finding}: ${JSON.stringify(result.report.defects)}`);
    assert.equal(d.status, 'verified');
    assert.equal(d.foundIn, 1);
    assert.equal(d.verifiedIn, 2);
    assert.deepEqual(d.fixTasks, [`repair-1-${defect.gate}`]);
    // Fresh evidence: the verification comes from review 2, and it exists.
    assert.ok(d.evidence[0].startsWith('evidence/qa/review-1/'));
    assert.ok(d.verification[0].startsWith('evidence/qa/review-2/'));
    for (const f of [...d.evidence, ...d.verification]) assert.ok(existsSync(join(p.dir, f)), f);
    assert.ok(statSync(join(p.dir, d.verification[0])).mtimeMs >= statSync(join(p.dir, d.evidence[0])).mtimeMs);

    const state = loadProject(p.name, { workspace: p.workspace });
    assert.equal(state.phase, 'QUALITY_REVIEW');
    assert.equal(state.repairLoops, 1);
    const ledger = readLedger(p.name, { workspace: p.workspace });
    const reviews = ledger.filter((e) => e.data.event === 'qa_review');
    assert.deepEqual(reviews.map((e) => e.actor), ['qa-verifier', 'qa-verifier']);
    assert.ok(reviews[1].data.verified.includes(d.id));
    // Verification is recorded by the QA Verifier, never by the builder.
    assert.ok(!ledger.some((e) => e.actor === 'builder' && e.data.event === 'qa_review'));
  });
}

test('a builder that only claims a fix never closes a defect, and the loop escalates after 3 repairs', async () => {
  const p = project('seo-two-h1');
  const opts = { workspace: p.workspace, gates: ['seo'] };
  // Even a verifier that accepts the builder's work does not close the defect.
  const result = await runRepairLoop(p.name, { ...opts, worker: claimingBuilder, verifier: async () => ({ ok: true, code: 0, output: 'ok' }) });
  assert.equal(result.outcome, 'escalated');
  const d = result.report.defects.find((x) => x.finding === 'h1-count');
  assert.equal(d.status, 'escalated');
  assert.deepEqual(d.fixTasks, ['repair-1-seo', 'repair-2-seo', 'repair-3-seo']);
  assert.deepEqual(d.history.map((h) => h.status), ['found', 'still-open', 'still-open', 'still-open', 'escalated']);
  assert.equal(result.report.escalated, true);
  assert.equal(loadProject(p.name, { workspace: p.workspace }).repairLoops, 3);
  assert.match(readFileSync(join(p.dir, 'reports/escalation.md'), 'utf8'), /D-001 seo h1-count/);
  assert.ok(readLedger(p.name, { workspace: p.workspace }).some((e) => e.data.event === 'repair_escalated'));
  assert.match(readFileSync(join(p.dir, 'reports/qa-log.md'), 'utf8'), /## Review 4/);
});

test('with the default gate verifier, a claimed fix fails its task, and the defect stays open', async () => {
  const p = project('secret-env-file');
  const result = await runRepairLoop(p.name, { workspace: p.workspace, gates: ['secrets'], worker: claimingBuilder });
  assert.equal(result.outcome, 'escalated');
  const task = readJson(join(p.dir, 'board', 'repair-1-secrets.json'));
  assert.equal(task.status, 'blocked');
  assert.match(readFileSync(join(p.dir, 'evidence/tasks/repair-1-secrets/attempt-2-verify.log'), 'utf8'), /env-file/);
});

test('the known-good site passes the full quality floor with no repair', { skip: noBrowser }, async () => {
  const p = project('known-good');
  const result = await runRepairLoop(p.name, { workspace: p.workspace, browser, adapters, screenshots: false, worker: claimingBuilder });
  assert.equal(result.outcome, 'passed');
  assert.equal(result.loops, 0);
  assert.deepEqual(result.report.qualityFloor, { met: true, failing: [] });
  assert.equal(readdirSync(join(p.dir, 'evidence/qa/review-1')).length, 11);
});

test('the repair loop runs only in quality review', async () => {
  const p = project('known-good');
  const stateFile = join(p.dir, 'project.json');
  writeJsonAtomic(stateFile, { ...readJson(stateFile), phase: 'BUILD' });
  await assert.rejects(runRepairLoop(p.name, { workspace: p.workspace, gates: ['seo'], worker: claimingBuilder }), /repair loop runs in QUALITY_REVIEW/);
});

test('repair tasks are valid contracts that keep the builder out of evidence, reports and locked content', async () => {
  const p = project('claim-unknown-source');
  const { report } = await qaReview(p.name, { workspace: p.workspace, gates: ['claims', 'seo'] });
  const tasks = repairTasks(p.name, report, 1, { workspace: p.workspace });
  assert.deepEqual(tasks.map((t) => t.id), ['repair-1-claims']);
  const [t] = tasks;
  assert.equal(check('task', t).valid, true, check('task', t).errors.join('\n'));
  assert.equal(t.agent, 'builder');
  assert.ok(t.owns_files.includes('content/claims.json'));
  for (const p of ['evidence/**', 'reports/**', 'content/pages/**', 'intake/**']) assert.ok(t.must_not_touch.includes(p));
  assert.equal(t.verify, `forge gates ${p.name} --gate claims`);
  assert.ok(t.inputs.includes('reports/defects.json'));
  assert.ok(t.acceptance[0].startsWith('D-001 fixed:'));
});

// mergeReview is pure: these cover the rules without running gates.
const at = new Date('2026-10-28T00:00:00Z');
const result = (gate, status, findings = [], error) => ({ gate, gateVersion: '0.1.0', status, startedAt: at.toISOString(), finishedAt: at.toISOString(), findings, evidence: [], ...(error ? { error } : {}) });
const finding = (id, severity = 'serious', location) => ({ id, severity, message: id, ...(location ? { location } : {}) });
const review = (number, results, evidenceFor = (g) => [`evidence/qa/review-${number}/${g}.json`]) => ({ project: 'p', number, now: at, results, floor: { met: false, failing: [] }, evidenceFor });

test('mergeReview: a gate that errors is a critical defect; minor findings are advisories', () => {
  const r = mergeReview(null, review(1, [result('routes', 'error', [], { code: 'UNAVAILABLE', message: 'no browser' }), result('seo', 'fail', [finding('h1-count'), finding('og-missing', 'minor')])]));
  assert.deepEqual(r.defects.map((d) => [d.id, d.finding, d.severity]), [['D-001', 'gate-error', 'critical'], ['D-002', 'h1-count', 'serious']]);
  assert.equal(r.advisories, 1);
});

test('mergeReview: a finding without evidence is discarded', () => {
  const r = mergeReview(null, review(1, [result('seo', 'fail', [finding('h1-count')])], () => null));
  assert.deepEqual(r.defects, []);
  assert.equal(r.discarded, 1);
});

test('mergeReview: a gate that did not run again verifies nothing; a fixed defect that returns is reopened', () => {
  const first = mergeReview(null, review(1, [result('seo', 'fail', [finding('h1-count', 'serious', '/a')])]));
  const notRun = mergeReview(first, review(2, [result('claims', 'pass')]));
  assert.equal(notRun.defects[0].status, 'open');
  const errored = mergeReview(first, review(2, [result('seo', 'error', [], { code: 'X', message: 'x' })]));
  assert.equal(errored.defects.find((d) => d.finding === 'h1-count').status, 'open');
  const fixed = mergeReview(first, review(2, [result('seo', 'pass')]));
  assert.equal(fixed.defects[0].status, 'verified');
  const back = mergeReview(fixed, review(3, [result('seo', 'fail', [finding('h1-count', 'serious', '/a')])]));
  assert.equal(back.defects[0].status, 'open');
  assert.equal(back.defects[0].verifiedIn, undefined);
  assert.deepEqual(back.defects[0].history.map((h) => h.status), ['found', 'verified', 'reopened']);
  assert.equal(back.defects.length, 1);
});

test('forge qa reviews a project and lists its open defects', async () => {
  const p = project('seo-two-h1');
  writeFileSync(join(p.root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const { log } = console;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  let code;
  try {
    code = await cmdQa(p.root, [p.name, '--gate', 'seo']);
  } finally {
    console.log = log;
  }
  assert.equal(code, 1);
  assert.match(out.join('\n'), /D-001 open\s+seo h1-count/);
  assert.ok(existsSync(join(p.dir, 'reports/defects.json')));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigMissing, PermissionDenied, SchemaInvalid } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import {
  MAX_REPAIR_LOOPS,
  PHASES,
  advancePhase,
  approve,
  createProject,
  hasApproval,
  loadProject,
  requireApproval,
} from '../../src/core/project.mjs';
import { reconcileProject } from '../../src/core/recovery.mjs';
import { check } from '../../src/core/schemas.mjs';
import { projectPaths, writeJsonAtomic } from '../../src/core/workspace.mjs';
import { newProject, tmpWorkspace } from './helpers.mjs';

const lastEntry = (project, opts) => ledger.read(project, opts).at(-1);

// Walks a project forward to `target`, approving each exit gate on the way.
function walkTo(project, opts, target) {
  for (;;) {
    const { phase } = loadProject(project, opts);
    if (phase === target) return;
    const gate = PHASES.find((p) => p.name === phase).exitApproval;
    if (gate && !hasApproval(project, gate, opts)) approve(project, gate, opts);
    const next = phase === 'QUALITY_REVIEW' ? 'PREVIEW_REPORT' : PHASES[PHASES.findIndex((p) => p.name === phase) + 1].name;
    advancePhase(project, next, opts);
  }
}

test('createProject writes project.json and a project_created ledger entry', () => {
  const workspace = tmpWorkspace();
  const state = createProject('harbor-home', { workspace, brief: 'samples/briefs/business.md' });
  assert.equal(state.phase, 'CREATED');
  assert.deepEqual(loadProject('harbor-home', { workspace }), state);
  const [entry] = ledger.read('harbor-home', { workspace });
  assert.equal(entry.seq, 1);
  assert.equal(entry.type, 'project_created');
  assert.equal(entry.data.brief, 'samples/briefs/business.md');
});

test('creating the same project twice is refused', () => {
  const { project, opts } = newProject();
  assert.throws(() => createProject(project, opts), PermissionDenied);
});

test('bad project ids and missing projects give typed errors', () => {
  const workspace = tmpWorkspace();
  assert.throws(() => createProject('../escape', { workspace }), SchemaInvalid);
  assert.throws(() => loadProject('nope', { workspace }), (e) => e instanceof ConfigMissing && /forge new nope/.test(e.hint));
});

test('phases move forward one step at a time', () => {
  const { project, opts } = newProject();
  assert.equal(advancePhase(project, 'INTAKE', opts).phase, 'INTAKE');
  assert.deepEqual(lastEntry(project, opts).data, { from: 'CREATED', to: 'INTAKE' });
});

test('an illegal transition is refused and the refusal is recorded', () => {
  const { project, opts } = newProject();
  assert.throws(() => advancePhase(project, 'BUILD', opts), PermissionDenied);
  const entry = lastEntry(project, opts);
  assert.equal(entry.type, 'refusal');
  assert.match(entry.data.reason, /Illegal transition/);
  assert.equal(loadProject(project, opts).phase, 'CREATED');
});

test('leaving intake needs B1; the refusal is recorded until the operator approves', () => {
  const { project, opts } = newProject();
  advancePhase(project, 'INTAKE', opts);
  assert.throws(
    () => advancePhase(project, 'RESEARCH', opts),
    (e) => e instanceof PermissionDenied && /B1 not recorded/.test(e.message) && /forge approve demo B1/.test(e.hint),
  );
  assert.deepEqual(lastEntry(project, opts).data, { action: 'phase INTAKE -> RESEARCH', reason: 'B1 not recorded' });

  const approval = approve(project, 'B1', { ...opts, note: 'brief ok' });
  assert.equal(approval.actor, 'operator');
  assert.deepEqual(approval.data, { approval: 'B1', phase: 'INTAKE', note: 'brief ok' });
  assert.equal(advancePhase(project, 'RESEARCH', opts).phase, 'RESEARCH');
});

test('every exit approval (B1, B2, B3, B6, B7) is enforced on the way to handoff', () => {
  const { project, opts } = newProject();
  const gated = PHASES.filter((p) => p.exitApproval).map((p) => p.exitApproval);
  assert.deepEqual(gated, ['B1', 'B2', 'B3', 'B6', 'B7']);
  walkTo(project, opts, 'HANDOFF');
  const refusals = ledger.read(project, opts).filter((e) => e.type === 'refusal');
  assert.equal(refusals.length, 0);
  assert.deepEqual(
    ledger.read(project, opts).filter((e) => e.type === 'approval').map((e) => e.data.approval),
    gated,
  );
});

test('approval codes are checked', () => {
  const { project, opts } = newProject();
  assert.throws(() => approve(project, 'B9', opts), SchemaInvalid);
  assert.equal(approve(project, 'A0', opts).data.approval, 'A0');
});

test('requireApproval refuses an action without its approval and records why', () => {
  const { project, opts } = newProject();
  assert.throws(() => requireApproval(project, 'B7', 'deploy --production', opts), PermissionDenied);
  assert.deepEqual(lastEntry(project, opts).data, { action: 'deploy --production', reason: 'B7 not recorded' });
  approve(project, 'B7', opts);
  assert.equal(requireApproval(project, 'B7', 'deploy --production', opts), true);
});

test(`repair loops back to quality review at most ${MAX_REPAIR_LOOPS} times, then escalates`, () => {
  const { project, opts } = newProject();
  walkTo(project, opts, 'QUALITY_REVIEW');
  for (let i = 1; i <= MAX_REPAIR_LOOPS; i++) {
    assert.equal(advancePhase(project, 'REPAIR', opts).repairLoops, i);
    advancePhase(project, 'QUALITY_REVIEW', opts);
  }
  assert.throws(() => advancePhase(project, 'REPAIR', opts), /escalate to the operator/);
  approve(project, 'B6', opts);
  advancePhase(project, 'PREVIEW_REPORT', opts);
});

test('project.json is rebuilt from the ledger after a crash between the two writes', () => {
  const { project, opts } = newProject();
  advancePhase(project, 'INTAKE', opts);
  // Simulate the ledger write landing and the state write being lost.
  const paths = projectPaths(project, opts);
  const stale = JSON.parse(readFileSync(paths.state, 'utf8'));
  stale.phase = 'CREATED';
  writeJsonAtomic(paths.state, stale);

  const { changed, state } = reconcileProject(project, opts);
  assert.equal(changed, true);
  assert.equal(state.phase, 'INTAKE');
  assert.equal(loadProject(project, opts).phase, 'INTAKE');
  assert.equal(reconcileProject(project, opts).changed, false);
});

test('ledger seq increases by one and callers cannot set seq, ts or project', () => {
  const { project, opts } = newProject();
  const a = ledger.append(project, { actor: 'cli', type: 'note', data: {} }, opts);
  const b = ledger.append(project, { actor: 'cli', type: 'note', data: {}, seq: 99, project: 'other', ts: 'x' }, opts);
  assert.equal(b.seq, a.seq + 1);
  assert.equal(b.project, project);
  assert.ok(check('ledgerEntry', b).valid);
});

test('ledger rejects entries that break the schema, such as an agent approving', () => {
  const { project, opts } = newProject();
  assert.throws(() => ledger.append(project, { actor: 'builder', type: 'approval', data: { approval: 'B1' } }, opts), SchemaInvalid);
  assert.equal(ledger.read(project, opts).length, 1);
});

test('a torn last ledger line is removed and recorded; a corrupt middle line is an error', () => {
  const { project, opts } = newProject();
  const file = projectPaths(project, opts).ledger;
  appendFileSync(file, '{"seq": 2, "ts": "2026');
  assert.equal(ledger.read(project, opts).length, 1);

  const entry = ledger.append(project, { actor: 'cli', type: 'note', data: { message: 'after crash' } }, opts);
  const all = ledger.read(project, opts);
  assert.deepEqual(all.map((e) => e.seq), [1, 2, 3]);
  assert.equal(all[1].data.code, 'LEDGER_TORN_LINE');
  assert.equal(entry.seq, 3);

  writeFileSync(file, 'not json\n' + readFileSync(file, 'utf8'));
  assert.throws(() => ledger.read(project, opts), SchemaInvalid);
});

test('atomic writes leave no temp files behind', () => {
  const { project, opts } = newProject();
  advancePhase(project, 'INTAKE', opts);
  const files = readdirSync(join(opts.workspace, project));
  assert.ok(!files.some((f) => f.endsWith('.tmp')), files.join(', '));
});

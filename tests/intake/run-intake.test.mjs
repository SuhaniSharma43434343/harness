// T15: the Project Manager intake workflow. It asks, records, writes the brief, plan and
// estimate, stops before B1 and never records an approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdIntake } from '../../src/cli/intake.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { createProject, loadProject } from '../../src/core/project.mjs';
import { check } from '../../src/core/schemas.mjs';
import { estimateScope, loadRates } from '../../src/intake/estimate.mjs';
import { runIntake } from '../../src/intake/run.mjs';
import { shapeAnswer } from '../../src/intake/shape.mjs';
import { loadApproaches } from '../../src/registry/load.mjs';
import { selectApproaches } from '../../src/registry/select.mjs';

const recommendAll = async (qs) => qs.map(() => 'use-recommendation');
const sample = (type) => JSON.parse(readFileSync(new URL(`../../samples/briefs/${type}.json`, import.meta.url), 'utf8'));

function setup(name, material) {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-intake-'));
  let brief;
  if (material) {
    brief = join(workspace, `${name}-material.json`);
    writeFileSync(brief, JSON.stringify(material));
  }
  createProject(name, { workspace, brief });
  return { workspace, dir: join(workspace, name) };
}

test('intake from client material asks the rest, writes the four files and stops before B1', async () => {
  const s = sample('showroom');
  const material = { projectType: s.projectType, client: s.client, goals: s.goals, features: { interactive: ['3d-product'] } };
  const { workspace, dir } = setup('atelier', material);
  const asked = [];
  const r = await runIntake('atelier', {
    workspace,
    ask: async (qs) => {
      asked.push(...qs.map((q) => q.id));
      return qs.map(() => 'use-recommendation');
    },
  });

  assert.equal(r.status, 'ready');
  for (const f of ['brief.json', 'facts.json', 'estimate.json', 'plan.md']) assert.ok(existsSync(join(dir, 'intake', f)), f);
  assert.equal(check('brief', r.brief).valid, true);
  assert.equal(r.brief.status, 'ready');
  assert.equal(check('estimate', r.estimate).valid, true);
  assert.ok(!asked.some((id) => ['q-project-type', 'q-client-name', 'q-industry', 'q-showroom-goals', 'q-interactive'].includes(id)));
  assert.ok(asked.includes('q-models3d'), 'the 3D answer in the material triggers the models follow-up');
  // The material asked for 3D and the recommended device floor (mid) allows it; the recommended
  // motion (2) adds the scroll story and the shader band.
  assert.deepEqual(r.decision.decisions.filter((d) => d.selected).map((d) => d.approach), ['APP-01', 'APP-02', 'APP-03', 'APP-05']);

  const entries = ledger.read('atelier', { workspace });
  assert.ok(!entries.some((e) => e.type === 'approval'), 'intake never records an approval');
  assert.ok(entries.some((e) => e.type === 'note' && e.data.event === 'intake_finished' && e.data.status === 'ready'));
  assert.equal(loadProject('atelier', { workspace }).phase, 'INTAKE');

  const plan = readFileSync(join(dir, 'intake', 'plan.md'), 'utf8');
  assert.match(plan, /# Plan: Atelier Seating/);
  assert.match(plan, /forge approve atelier B1/);
});

// Found in the T28 release run: the showroom brief lost its integrations and Spline scene URL,
// which no question fills, so APP-04 was not selected.
test('fields of the brief file that no question fills are kept in the brief', async () => {
  const s = sample('flagship');
  const { workspace } = setup('orbit', s);
  const r = await runIntake('orbit', { workspace, ask: recommendAll });
  assert.deepEqual(r.brief.integrations, s.integrations);
  assert.equal(r.brief.features.splineSceneUrl, s.features.splineSceneUrl);
  assert.ok(r.decision.decisions.find((d) => d.approach === 'APP-04').selected);
});

test('unanswered questions leave intake at needs-answers, and a second run continues', async () => {
  const { workspace, dir } = setup('half-done', { projectType: 'launch' });
  const first = await runIntake('half-done', { workspace, ask: async (qs) => qs.map((q) => (q.id === 'q-tier' ? 'M' : undefined)) });
  assert.equal(first.status, 'needs-answers');
  assert.ok(first.missing.includes('goals'));
  assert.ok(!first.missing.includes('tier'));
  assert.ok(!existsSync(join(dir, 'intake', 'estimate.json')));

  const asked = [];
  const second = await runIntake('half-done', {
    workspace,
    ask: async (qs) => {
      asked.push(...qs.map((q) => q.id));
      return qs.map(() => 'use-recommendation');
    },
  });
  assert.equal(second.status, 'ready');
  assert.ok(!asked.includes('q-tier'), 'the answer from the first run is kept');
  assert.equal(second.facts.facts.find((f) => f.field === 'tier').status, 'known');
});

test('with a worker, the client material is read into facts through a runner task', async () => {
  const { workspace, dir } = setup('from-prose');
  mkdirSync(join(dir, 'intake', 'material'), { recursive: true });
  writeFileSync(join(dir, 'intake', 'material', 'email.txt'), 'We are Harbor Home, a renovation company. We want more quote requests.');
  const worker = async ({ projectDir }) => {
    writeFileSync(
      join(projectDir, 'intake', 'facts.json'),
      JSON.stringify({
        project: 'from-prose',
        schemaVersion: '0.1.0',
        facts: [
          { field: 'projectType', status: 'known', value: 'business', source: { kind: 'material', ref: 'intake/material/email.txt:1' }, assumption: false },
          { field: 'client.name', status: 'known', value: 'Harbor Home', source: { kind: 'material', ref: 'intake/material/email.txt:1' }, assumption: false },
        ],
      }),
    );
    return { evidence: ['intake/facts.json'] };
  };
  const asked = [];
  const r = await runIntake('from-prose', {
    workspace,
    worker,
    verifier: async () => ({ ok: true, code: 0, output: 'ok' }),
    ask: async (qs) => {
      asked.push(...qs.map((q) => q.id));
      return qs.map(() => 'use-recommendation');
    },
  });
  assert.equal(r.status, 'ready');
  assert.equal(r.brief.client.name, 'Harbor Home');
  assert.ok(!asked.includes('q-client-name'));
  assert.ok(asked.includes('q-business-goals'));
});

test('intake refuses to run outside P1 and needs an ask function', async () => {
  const { workspace } = setup('late');
  await assert.rejects(runIntake('late', { workspace }), TypeError);
  writeFileSync(join(workspace, 'late', 'project.json'), JSON.stringify({ ...loadProject('late', { workspace }), phase: 'BUILD' }));
  await assert.rejects(runIntake('late', { workspace, ask: recommendAll }), /Intake runs in P1/);
});

test('estimateScope is deterministic, counts approaches and checks the budget', () => {
  const { approaches, matrix } = loadApproaches();
  const brief = sample('flagship');
  const decision = selectApproaches(brief, approaches, matrix, { now: new Date(0) });
  const a = estimateScope(brief, decision);
  assert.deepEqual(a, estimateScope(brief, decision));
  assert.deepEqual(a.approaches, ['APP-01', 'APP-02', 'APP-03', 'APP-04', 'APP-05', 'APP-07']);
  assert.ok(a.lines.some((l) => l.item === 'APP-07 module'));
  assert.ok(a.hours.min < a.hours.max);
  assert.equal(a.withinBudget, null);

  const tight = estimateScope({ ...brief, constraints: { ...brief.constraints, budget: { currency: 'USD', max: 1000 } } }, decision);
  assert.equal(tight.withinBudget, false);
  assert.ok(tight.assumptions.some((s) => /over the client budget/.test(s)));

  const plain = estimateScope(sample('business'));
  assert.deepEqual(plain.approaches, ['APP-01']);
  assert.ok(plain.assumptions.some((s) => /No approach decision yet/.test(s)));
  assert.ok(plain.cost.min < a.cost.min);

  const rates = { ...loadRates(), hourlyRate: { min: 0, max: 0 } };
  assert.equal(estimateScope(sample('business'), undefined, { rates }).cost.max, 0);
});

test('typed text becomes the brief shape for structured fields', () => {
  const q = (field) => ({ kind: 'text', fills: [field] });
  assert.deepEqual(shapeAnswer(q('goals'), 'More quote requests; Rank locally'), [
    { id: 'more-quote-requests-1', statement: 'More quote requests' },
    { id: 'rank-locally-2', statement: 'Rank locally' },
  ]);
  assert.deepEqual(shapeAnswer(q('audience'), 'Homeowners: find a trusted builder'), [{ segment: 'Homeowners', need: 'find a trusted builder' }]);
  assert.deepEqual(shapeAnswer(q('pages'), 'Home; About us').map((p) => p.slug), ['/', '/about-us']);
  assert.equal(shapeAnswer(q('client.name'), 'Acme'), 'Acme');
  assert.deepEqual(shapeAnswer({ kind: 'single', fills: ['tier'] }, 'M'), 'M');
});

test('forge intake --use-recommendations writes a ready brief', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  createProject('cli-intake', { workspace: join(root, 'ws') });
  const answers = join(root, 'answers.json');
  writeFileSync(answers, JSON.stringify({ 'q-project-type': 'portfolio', 'q-client-name': 'Studio North', 'q-portfolio-goals': 'Win more bookings' }));
  const { log } = console;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await cmdIntake(root, ['cli-intake', '--answers', answers, '--use-recommendations']), 0);
  } finally {
    console.log = log;
  }
  assert.match(out.join('\n'), /forge approve cli-intake B1/);
  const brief = JSON.parse(readFileSync(join(root, 'ws', 'cli-intake', 'intake', 'brief.json'), 'utf8'));
  assert.equal(brief.client.name, 'Studio North');
  assert.deepEqual(brief.goals, [{ id: 'win-more-bookings-1', statement: 'Win more bookings' }]);
  assert.ok(!brief.assumptions.includes('goals'));
});

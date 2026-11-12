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
  // The material asked for 3D and the recommended device floor (mid) allows it.
  assert.deepEqual(r.decision.decisions.filter((d) => d.selected).map((d) => d.approach), ['APP-01', 'APP-03']);

  const entries = ledger.read('atelier', { workspace });
  assert.ok(!entries.some((e) => e.type === 'approval'), 'intake never records an approval');
  assert.ok(entries.some((e) => e.type === 'note' && e.data.event === 'intake_finished' && e.data.status === 'ready'));
  assert.equal(loadProject('atelier', { workspace }).phase, 'INTAKE');

  const plan = readFileSync(join(dir, 'intake', 'plan.md'), 'utf8');
  assert.match(plan, /# Plan: Atelier Seating/);
  assert.match(plan, /forge approve atelier B1/);
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
  // The business has no specific playbook, so the general business playbook asks the goals question
  // in the place of the generic one (it is deeper, and it records the primary action).
  assert.ok(asked.includes('q-general-business-goals'));
  assert.ok(!asked.includes('q-business-goals'));
  assert.equal(r.brief.business.industryId, 'general-business');
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
  assert.deepEqual(a.approaches, ['APP-01', 'APP-02', 'APP-03', 'APP-04', 'APP-07']);
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
  assert.deepEqual(
    shapeAnswer(q('audience'), 'Homeowners: a builder they can trust | wants: a fixed quote | proof: finished jobs nearby | action: book a home visit\nLandlords: quick turnarounds | Action: request a quote'),
    [
      { segment: 'Homeowners', need: 'a builder they can trust', wants: 'a fixed quote', proof: 'finished jobs nearby', action: 'book a home visit' },
      { segment: 'Landlords', need: 'quick turnarounds', action: 'request a quote' },
    ],
    'audience views: each part after the need is optional',
  );
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

test('audience views are optional brief fields, shown in the plan and asked for by every project type', async () => {
  const { check } = await import('../../src/core/schemas.mjs');
  const { renderPlan } = await import('../../src/intake/plan.mjs');
  const { loadRegistry } = await import('../../src/registry/load.mjs');
  const { readFileSync } = await import('node:fs');
  const brief = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));
  assert.equal(check('brief', brief).valid, true, 'a brief without views still validates');
  brief.audience = [{ segment: 'Homeowners', need: 'a builder they can trust', wants: 'a fixed quote', proof: 'finished jobs nearby', action: 'book a home visit' }];
  assert.equal(check('brief', brief).valid, true, check('brief', brief).errors.join('; '));
  assert.equal(check('brief', { ...brief, audience: [{ segment: 'x', need: 'y', action: '' }] }).valid, false, 'an empty action is refused');
  const plan = renderPlan(brief, null, { hours: { min: 1, max: 2 }, cost: { min: 1, max: 2, currency: 'USD' }, rateVersion: 'test', lines: [], assumptions: [] });
  assert.ok(plan.includes('- Homeowners: a builder they can trust; wants: a fixed quote; needs to see: finished jobs nearby; should: book a home visit'), plan);
  const { questions } = loadRegistry();
  const audience = questions.questions.filter((x) => x.fills.length === 1 && x.fills[0] === 'audience');
  assert.ok(audience.length >= 7, "one per project type, and one more per industry playbook");
  for (const x of audience) {
    assert.match(x.prompt, /wants: .* proof: .* action: /);
    assert.ok(x.recommendation.value.every((v) => v.action), x.id);
  }
});

test('the pre-build questions: typed answers become the new brief fields', () => {
  const q = (field) => ({ kind: 'text', fills: [field] });
  assert.deepEqual(shapeAnswer(q('audience'), 'Homeowners: a builder they trust | action: book a visit | from: Instagram, search | mood: wary'), [
    { segment: 'Homeowners', need: 'a builder they trust', action: 'book a visit', arrivesFrom: ['Instagram', 'search'], mood: 'wary' },
  ]);
  assert.deepEqual(shapeAnswer(q('truths'), 'History: fitting boats in this harbour since 1962\nThe only yard with its own slipway'), [
    { text: 'fitting boats in this harbour since 1962', kind: 'history' },
    { text: 'The only yard with its own slipway' },
  ]);
  assert.deepEqual(shapeAnswer(q('jobs'), 'Call\nBook a visit\nCall\nDirections\nMenu\nOrder'), ['Call', 'Book a visit', 'Directions', 'Menu'], 'at most four, no repeats');
  assert.deepEqual(shapeAnswer(q('contentRules'), 'never on /, /about: Smith\nalways on *: Licence 12345\nalways: Consent text\nnot a rule'), [
    { rule: 'never', text: 'Smith', pages: ['/', '/about'] },
    { rule: 'always', text: 'Licence 12345', pages: ['*'] },
    { rule: 'always', text: 'Consent text', pages: ['*'] },
  ], 'with no pages, every page; a line that is not a rule is dropped');
  assert.deepEqual(shapeAnswer(q('access'), 'domain: Harbor-Home.com, client will give\ndns: we have access\nphotos: usable, in Drive\nlogo: good\nmenus: in a PDF'), {
    domain: { name: 'harbor-home.com', status: 'client-will-give' },
    dns: 'have-access',
    assets: [{ item: 'photos', quality: 'usable', where: 'in Drive' }, { item: 'logo', quality: 'good' }, { item: 'menus', quality: 'unknown', where: 'in a PDF' }],
  });
  assert.deepEqual(shapeAnswer(q('client.languages'), 'English'), ['en']);
});

test('the new brief fields validate when present and are refused when wrong; old briefs still validate', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../../samples/briefs/', import.meta.url);
  for (const f of readdirSync(dir)) assert.equal(check('brief', JSON.parse(readFileSync(new URL(f, dir), 'utf8'))).valid, true, f);
  const brief = JSON.parse(readFileSync(new URL('business.json', dir), 'utf8'));
  const full = {
    ...brief,
    audience: [{ ...brief.audience[0], arrivesFrom: ['Instagram'], mood: 'wary' }],
    truths: [{ text: 'Fitting boats here since 1962', kind: 'history' }],
    jobs: ['Call', 'Book a visit'],
    contentRules: [{ rule: 'never', text: 'Smith', pages: ['/'] }, { rule: 'always', text: 'Licence 12345', pages: ['*'] }],
    access: { domain: { name: 'harbor-home.com', status: 'client-will-give' }, dns: 'unknown', assets: [{ item: 'logo', quality: 'good' }] },
  };
  assert.deepEqual(check('brief', full).errors, []);
  const bad = (patch, why) => assert.equal(check('brief', { ...full, ...patch }).valid, false, why);
  bad({ jobs: ['a', 'b', 'c', 'd', 'e'] }, 'more than four jobs');
  bad({ truths: Array.from({ length: 7 }, (_, i) => ({ text: `t${i}` })) }, 'more than six truths');
  bad({ truths: [{ text: 'x', kind: 'vibe' }] }, 'an unknown kind of truth');
  bad({ contentRules: [{ rule: 'sometimes', text: 'x', pages: ['/'] }] }, 'a rule is never or always');
  bad({ contentRules: [{ rule: 'never', text: 'x', pages: ['home'] }] }, 'pages are slugs or *');
  bad({ access: { assets: [{ item: 'logo', quality: 'great' }] } }, 'quality is good, usable, poor or unknown');
  bad({ access: { domain: { name: 'not a domain' } } }, 'a domain name');
  bad({ audience: [{ ...brief.audience[0], mood: '' }] }, 'an empty mood');
});

test('the plan shows the new fields, warns with fewer than three truths, and lists what to ask for on day one', async () => {
  const { renderPlan } = await import('../../src/intake/plan.mjs');
  const brief = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));
  const est = { hours: { min: 1, max: 2 }, cost: { min: 1, max: 2, currency: 'USD' }, rateVersion: 'test', lines: [], assumptions: [] };
  const bare = renderPlan(brief, null, est);
  assert.match(bare, /\*\*None given\.\*\* The design rests on one of these facts/);
  assert.match(bare, /Ask the client for, now:\*\* the domain name; who controls the domain; DNS access; what material exists/);
  const plan = renderPlan({
    ...brief,
    audience: [{ ...brief.audience[0], arrivesFrom: ['Instagram'], mood: 'wary' }],
    truths: [{ text: 'A' }, { text: 'B' }, { text: 'C', kind: 'number' }],
    jobs: ['Call'],
    contentRules: [{ rule: 'never', text: 'Smith', pages: ['/'] }, { rule: 'never', text: 'Jones', pages: ['*'] }, { rule: 'always', text: 'Licence 1', pages: ['*'] }],
    access: { domain: { name: 'harbor-home.com', status: 'have-access' }, dns: 'have-access', assets: [{ item: 'photos', quality: 'unknown' }] },
  }, null, est);
  assert.match(plan, /arrives from: Instagram; mood: wary/);
  assert.doesNotMatch(plan, /given\.\*\* The design rests/, 'three truths: no warning');
  assert.match(plan, /- C \(number\)/);
  assert.match(plan, /## One-tap jobs[\s\S]*- Call/);
  assert.match(plan, /- Never on `\/`: "Smith"/);
  assert.match(plan, /- Never on any page: "Jones"/, '"never on every page" would read as "not on all pages"');
  assert.match(plan, /- Always on every page: "Licence 1"/);
  assert.match(plan, /Ask the client for, now:\*\* the quality of the photos/);
});

test('intake asks the pre-build questions, and "none" recommendations leave the brief valid', async () => {
  const { loadRegistry } = await import('../../src/registry/load.mjs');
  const { questions } = loadRegistry();
  const byId = new Map(questions.questions.map((x) => [x.id, x]));
  for (const id of ['q-truths', 'q-jobs', 'q-access', 'q-content-rules', 'q-languages', 'q-deadline', 'q-existing-site']) {
    assert.ok(byId.has(id), id);
    assert.ok(byId.get(id).prompt.length <= 300, `${id} fits the question bank's prompt limit`);
    assert.equal(byId.get(id).appliesTo.projectTypes, 'all');
  }
  for (const x of questions.questions.filter((y) => y.fills[0] === 'audience')) assert.match(x.prompt, /from: .* mood: /, x.id);

  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  createProject('prebuild', { workspace: join(root, 'ws') });
  const answers = join(root, 'answers.json');
  writeFileSync(answers, JSON.stringify({ 'q-project-type': 'business', 'q-client-name': 'Harbor Home', 'q-business-goals': 'More enquiries', 'q-jobs': 'Call\nBook a visit' }));
  const { log } = console;
  console.log = () => {};
  try {
    assert.equal(await cmdIntake(root, ['prebuild', '--answers', answers, '--use-recommendations']), 0);
  } finally {
    console.log = log;
  }
  const brief = JSON.parse(readFileSync(join(root, 'ws', 'prebuild', 'intake', 'brief.json'), 'utf8'));
  assert.deepEqual(check('brief', brief).errors, []);
  assert.deepEqual(brief.jobs, ['Call', 'Book a visit'], 'an answer is used');
  assert.equal(brief.constraints.deadline, undefined, 'no deadline is left unset, not null');
  assert.equal(brief.client.existingSite, undefined);
  assert.ok(brief.assumptions.includes('constraints.deadline'), 'and recorded as an assumption');
  const plan = readFileSync(join(root, 'ws', 'prebuild', 'intake', 'plan.md'), 'utf8');
  assert.match(plan, /## Day-one access/);
});

test('intake asks for brand colours and fonts, and the plan says what to ask for when a font is not open', async () => {
  const q = (field) => ({ kind: 'text', fills: [field] });
  assert.deepEqual(shapeAnswer(q('brand.existingAssets.colours'), 'Navy #1F4E79, then #F2A65A; also #123 and #1f4e79 again'), ['#1f4e79', '#f2a65a', '#112233']);
  assert.deepEqual(shapeAnswer(q('brand.existingAssets.colours'), 'none'), []);
  assert.deepEqual(shapeAnswer(q('brand.existingAssets.colours'), '#12345g'), [], 'not a colour');
  assert.deepEqual(shapeAnswer(q('brand.existingAssets.fonts'), 'Playfair Display, Inter\nInter; Gotham, Futura'), ['Playfair Display', 'Inter', 'Gotham']);
  assert.deepEqual(shapeAnswer(q('brand.existingAssets.fonts'), 'None.'), []);

  const { loadRegistry } = await import('../../src/registry/load.mjs');
  const byId = new Map(loadRegistry().questions.questions.map((x) => [x.id, x]));
  for (const id of ['q-brand-colours', 'q-brand-fonts']) {
    assert.ok(byId.get(id).prompt.length <= 300, `${id} fits the prompt limit`);
    assert.equal(byId.get(id).appliesTo.projectTypes, 'all');
    assert.equal(byId.get(id).round, 2);
  }

  const { renderPlan } = await import('../../src/intake/plan.mjs');
  const brief = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));
  const est = { hours: { min: 1, max: 2 }, cost: { min: 1, max: 2, currency: 'USD' }, rateVersion: 'test', lines: [], assumptions: [] };
  assert.doesNotMatch(renderPlan(brief, null, est), /## Brand/, 'nothing given: no section');
  const plan = renderPlan({ ...brief, brand: { ...brief.brand, existingAssets: { colours: ['#1f4e79'], fonts: ['Playfair Display', 'Gotham'] } } }, null, est);
  assert.match(plan, /## Brand[\s\S]*- Colours: `#1f4e79`\. The first direction is built from them/);
  assert.match(plan, /- Fonts: Playfair Display, Gotham\. Playfair Display is open, so the first direction uses it\./);
  assert.match(plan, /Ask the client for, now:\*\* the licence and font files for Gotham, or approval to use the closest open font instead\./);
  assert.deepEqual(check('brief', { ...brief, brand: { ...brief.brand, existingAssets: { colours: ['#1f4e79'], fonts: ['Gotham'] } } }).errors, [], 'the shapes are valid brief values');
});

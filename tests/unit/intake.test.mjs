import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigInvalid, SchemaInvalid } from '../../src/core/errors.mjs';
import { draftBrief, validateBrief } from '../../src/intake/brief.mjs';
import { intakeView, recordAnswer, REQUIRED_FIELDS, selectQuestions } from '../../src/intake/questions.mjs';
import { matchOption, parseTyped } from '../../src/intake/typed.mjs';
import { loadQuestionBank, loadRegistry, REGISTRY_DIR } from '../../src/registry/load.mjs';

const bank = loadQuestionBank();
const byId = (id) => bank.questions.find((q) => q.id === id);
const empty = (project = 'demo') => ({ project, schemaVersion: '0.1.0', facts: [] });
const known = (field, value) => ({ field, status: 'known', value, source: { kind: 'material' }, assumption: false });
const withFacts = (...facts) => ({ ...empty(), facts });
const ids = (qs) => qs.map((q) => q.id);

test('the bank has core questions and goals, audience, pages and forms for each of the 7 types', () => {
  for (const type of ['business', 'launch', 'showroom', 'portfolio', 'event', 'nonprofit', 'flagship']) {
    for (const part of ['goals', 'audience', 'pages', 'forms']) assert.ok(byId(`q-${type}-${part}`), `q-${type}-${part}`);
  }
  // Every required brief field can be asked for.
  const fills = new Set(bank.questions.flatMap((q) => q.fills));
  for (const f of REQUIRED_FIELDS) assert.ok(fills.has(f), `nothing asks for ${f}`);
});

test('every recommendation is a valid answer to its own question', () => {
  const facts = empty('demo');
  for (const q of bank.questions) {
    const rec = 'value' in q.recommendation ? q.recommendation.value : 'demo';
    assert.doesNotThrow(() => recordAnswer(facts, q, rec), q.id);
  }
});

test('with nothing known, only questions for every project type are asked, project type first', () => {
  const qs = selectQuestions({}, empty(), bank);
  assert.equal(qs[0].id, 'q-project-type');
  assert.ok(qs.length >= 5 && qs.length <= 10);
  for (const q of qs) assert.equal(q.appliesTo.projectTypes, 'all');
});

test('type questions follow the project type, and tier S skips the special-features question', () => {
  const launch = ids(selectQuestions({}, withFacts(known('projectType', 'launch')), bank));
  assert.ok(launch.includes('q-launch-goals'));
  assert.ok(!launch.some((id) => id.startsWith('q-business-')));
  const small = ids(selectQuestions({}, withFacts(known('projectType', 'launch'), known('tier', 'S')), bank));
  assert.ok(!small.includes('q-interactive'));
});

test('questions wait for their round unless a follow-up asks for them', () => {
  const base = [known('projectType', 'nonprofit'), known('tier', 'M')];
  assert.ok(!ids(selectQuestions({}, withFacts(...base), bank, { max: 50 })).includes('q-logo'));
  assert.ok(ids(selectQuestions({}, withFacts(...base), bank, { round: 2, max: 50 })).includes('q-logo'));

  // q-play-is-the-point is round 2, but answering "game" asks for it now.
  let facts = withFacts(...base);
  facts = recordAnswer(facts, byId('q-interactive'), ['game', '3d-product']);
  const next = ids(selectQuestions({}, facts, bank, { max: 50 }));
  assert.ok(next.includes('q-play-is-the-point'));
  assert.ok(next.includes('q-models3d'));
  assert.ok(!next.includes('q-interactive'), 'an answered question is not asked again');
});

test('askWhen holds a question back until it applies', () => {
  const facts = withFacts(known('projectType', 'event'), known('features.interactive', ['shader-background']));
  assert.ok(!ids(selectQuestions({}, facts, bank, { round: 3, max: 50 })).includes('q-play-is-the-point'));
});

test('two questions that fill the same field are not asked together, and max caps the list', () => {
  const extra = structuredClone(bank);
  extra.questions.push({ ...byId('q-tier'), id: 'q-tier-again', weight: 10 });
  const qs = selectQuestions({}, withFacts(known('projectType', 'business')), extra, { max: 50 });
  assert.equal(qs.filter((q) => q.fills.includes('tier')).length, 1);
  assert.equal(selectQuestions({}, empty(), bank, { max: 3 }).length, 3);
});

test('selectQuestions refuses an invalid bank', () => {
  assert.throws(() => selectQuestions({}, empty(), { questions: [] }), SchemaInvalid);
});

test('a real answer becomes a known fact and replaces an earlier one', () => {
  let facts = recordAnswer(empty(), byId('q-tier'), 'use-recommendation');
  assert.equal(facts.facts[0].status, 'inferred');
  facts = recordAnswer(facts, byId('q-tier'), 'L', { now: new Date('2026-10-28T00:00:00Z') });
  assert.deepEqual(facts.facts, [
    { field: 'tier', status: 'known', value: 'L', source: { kind: 'answer', questionId: 'q-tier' }, assumption: false, recordedAt: '2026-10-28T00:00:00.000Z' },
  ]);
});

test('use-recommendation records an inferred fact with the reason, from a value or another field', () => {
  const tier = recordAnswer(empty(), byId('q-tier'), 'use-recommendation').facts[0];
  assert.deepEqual(tier, {
    field: 'tier',
    status: 'inferred',
    value: 'M',
    source: { kind: 'recommendation', questionId: 'q-tier' },
    assumption: true,
    reason: byId('q-tier').recommendation.reason,
  });
  const name = recordAnswer(empty('acme-tools'), byId('q-client-name'), 'use-recommendation').facts[0];
  assert.equal(name.value, 'acme-tools');
});

test('answers are checked against the question kind', () => {
  assert.throws(() => recordAnswer(empty(), byId('q-tier'), 'XL'), SchemaInvalid);
  assert.throws(() => recordAnswer(empty(), byId('q-tone'), ['loud']), SchemaInvalid);
  assert.throws(() => recordAnswer(empty(), byId('q-logo'), 'yes'), SchemaInvalid);
  assert.throws(() => recordAnswer(empty(), byId('q-industry'), ''), SchemaInvalid);
  assert.equal(recordAnswer(empty(), byId('q-motion-intensity'), 0).facts[0].value, 0);
});

test('typed answers match option numbers, values, labels and the start of a label, in any case', () => {
  const answer = (id, text) => parseTyped(byId(id), text).answer;
  // What an operator typed in a real run (2026-10-29), which used to fail at the end of the round.
  assert.equal(answer('q-project-type', 'A product or campaign launch'), 'launch');
  assert.equal(answer('q-tier', 'up to 12 pages'), 'M');
  assert.equal(answer('q-device-floor', 'mid-range phones from the last 3 years'), 'mid');
  assert.equal(answer('q-motion-intensity', 'cinematic'), 3);
  assert.deepEqual(answer('q-tone', 'trustworthy'), ['trustworthy']);
  assert.equal(answer('q-accessibility', 'AAA'), 'WCAG 2.2 AAA');
  assert.equal(answer('q-accessibility', 'aa'), 'WCAG 2.2 AA');
  assert.deepEqual(answer('q-interactive', 'A data visualisation'), ['data-visualisation']);
  // Numbers are positions in the list shown, even when the values are numbers too.
  assert.equal(answer('q-tier', '2'), 'M');
  assert.equal(answer('q-motion-intensity', '2'), 1);
  assert.equal(answer('q-tier', 'l'), 'L');
  assert.deepEqual(answer('q-interactive', '4, data visualisation, 4'), ['scroll-story', 'data-visualisation']);
  assert.deepEqual(answer('q-interactive', 'none'), []);
  assert.equal(answer('q-logo', 'No'), false);
  assert.equal(answer('q-industry', 'education'), 'education');
  assert.equal(answer('q-tier', ''), 'use-recommendation');
});

test('a typed answer that fits no option, or more than one, is an error to ask again, not a guess', () => {
  const error = (id, text) => parseTyped(byId(id), text).error;
  assert.match(error('q-tier', 'XL'), /not one of the options/);
  assert.match(error('q-tier', '9'), /no option 9/);
  assert.match(error('q-interactive', '3d'), /more than one option/);
  assert.match(error('q-logo', 'maybe'), /yes or no/);
  assert.equal(matchOption(byId('q-interactive'), 'a 3d scene').value, '3d-scene');
  // Every option label in the bank is accepted as typed.
  for (const q of bank.questions) for (const o of q.options ?? []) assert.equal(matchOption(q, o.label).value, o.value, `${q.id}: ${o.label}`);
});

test('a question that fills several fields takes an object keyed by field', () => {
  const q = { ...byId('q-industry'), id: 'q-client', fills: ['client.name', 'client.industry'] };
  const facts = recordAnswer(empty(), q, { 'client.name': 'Acme', 'client.industry': 'tools' });
  assert.deepEqual(facts.facts.map((f) => [f.field, f.value]), [['client.name', 'Acme'], ['client.industry', 'tools']]);
  assert.throws(() => recordAnswer(empty(), q, 'Acme'), SchemaInvalid);
});

test('intakeView lays facts over the partial brief', () => {
  const view = intakeView({ project: 'demo', brand: { tone: ['bold'] } }, withFacts(known('brand.motionIntensity', 2)));
  assert.deepEqual(view, { project: 'demo', brand: { tone: ['bold'], motionIntensity: 2 } });
});

test('validateBrief reports missing fields and assumptions that do not match the facts', () => {
  const sample = JSON.parse(readFileSync(new URL('../../samples/briefs/showroom.json', import.meta.url), 'utf8'));
  const facts = {
    project: sample.project,
    schemaVersion: '0.1.0',
    facts: [
      known('projectType', 'showroom'),
      { field: 'tier', status: 'inferred', value: 'M', source: { kind: 'recommendation', questionId: 'q-tier' }, assumption: true, reason: 'r' },
    ],
  };
  const r = validateBrief(sample, facts);
  assert.equal(r.valid, false);
  assert.ok(r.errors.includes('tier is inferred but not listed in brief.assumptions'));
  assert.ok(r.errors.includes('brief.assumptions lists brand.motionIntensity, which has no inferred fact'));
  assert.ok(r.missing.includes('goals') && !r.missing.includes('tier'));

  const draft = draftBrief(facts, { project: sample.project, base: { ...sample, assumptions: [] } });
  assert.deepEqual(draft.assumptions, ['tier']);
  assert.deepEqual(validateBrief(draft, facts).errors, []);
  assert.equal(validateBrief({ ...draft, project: 'other' }, facts).valid, false);
});

test('loadRegistry returns the question bank, approaches and matrix together', () => {
  const r = loadRegistry();
  assert.ok(r.questions.questions.length > 20);
  assert.equal(r.approaches.length, 8);
  assert.ok(r.matrix.matrix.business);
});

test('loadQuestionBank rejects duplicate ids, unknown follow-ups and mixed versions', () => {
  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-questions-'));
    cpSync(REGISTRY_DIR, dir, { recursive: true });
    return dir;
  };
  const edit = (dir, file, fn) => {
    const p = join(dir, 'questions', file);
    writeFileSync(p, JSON.stringify(fn(JSON.parse(readFileSync(p, 'utf8')))));
  };
  const dup = copy();
  edit(dup, 'launch.json', (b) => ({ ...b, questions: [...b.questions, { ...b.questions[0], id: 'q-tier' }] }));
  assert.throws(() => loadQuestionBank(dup), (e) => e instanceof ConfigInvalid && /q-tier is defined twice/.test(e.hint));

  const follow = copy();
  edit(follow, 'core.json', (b) => {
    b.questions[0].followUps = [{ when: { field: 'tier', op: 'eq', value: 'L' }, ask: ['q-nope'] }];
    return b;
  });
  assert.throws(() => loadQuestionBank(follow), (e) => /q-nope, which does not exist/.test(e.hint));

  const version = copy();
  edit(version, 'event.json', (b) => ({ ...b, bankVersion: '0.2.0' }));
  assert.throws(() => loadQuestionBank(version), (e) => /disagree on bankVersion/.test(e.hint));
});

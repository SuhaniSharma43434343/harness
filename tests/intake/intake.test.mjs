// T14 intake tests (acceptance criterion A5): for the 7 sample briefs, one per project type,
// intake asks 0 questions the client material already answers, asks 5 to 10 in the first
// round, and records an assumption for every "use your recommendation".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftBrief, validateBrief } from '../../src/intake/brief.mjs';
import { recordAnswer, selectQuestions } from '../../src/intake/questions.mjs';
import { loadQuestionBank } from '../../src/registry/load.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const bank = loadQuestionBank();
const TYPES = readdirSync(DIR)
  .filter((f) => f.endsWith('.material.json'))
  .map((f) => f.replace('.material.json', ''));

test('there is client material for all 7 project types', () => {
  assert.deepEqual(TYPES.sort(), ['business', 'event', 'flagship', 'launch', 'nonprofit', 'portfolio', 'showroom']);
});

for (const type of TYPES) {
  test(`${type}: no known question asked, 5 to 10 first, every recommendation recorded as an assumption`, () => {
    const material = JSON.parse(readFileSync(join(DIR, `${type}.material.json`), 'utf8'));
    const fromMaterial = new Set(material.facts.map((f) => f.field));
    const brief = { project: material.project };
    let facts = material;
    const asked = new Set();
    let recommended = 0;

    for (const round of [1, 2, 3]) {
      // Within a round, keep asking until nothing new comes up (follow-ups arrive this way).
      for (;;) {
        const questions = selectQuestions(brief, facts, bank, { round });
        if (round === 1 && asked.size === 0) {
          assert.ok(questions.length >= 5 && questions.length <= 10, `round 1 asked ${questions.length}`);
        }
        if (!questions.length) break;
        for (const q of questions) {
          assert.ok(!q.fills.every((f) => fromMaterial.has(f)), `${q.id} asks what the material already says`);
          assert.ok(!asked.has(q.id), `${q.id} was asked twice`);
          asked.add(q.id);
          facts = recordAnswer(facts, q, 'use-recommendation');
          recommended += q.fills.length;
        }
      }
    }

    const inferred = facts.facts.filter((f) => f.status === 'inferred');
    assert.equal(inferred.length, recommended);
    for (const f of inferred) {
      assert.equal(f.assumption, true);
      assert.equal(f.source.kind, 'recommendation');
      assert.ok(f.reason.length > 0);
    }
    // Material facts are never overwritten.
    for (const f of material.facts) assert.deepEqual(facts.facts.find((x) => x.field === f.field), f);

    const draft = draftBrief(facts, { project: material.project });
    const result = validateBrief(draft, facts);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.missing, []);
    assert.equal(draft.status, 'draft');
    assert.deepEqual(new Set(draft.assumptions), new Set(inferred.map((f) => f.field)));
  });
}

test('a brief whose every field is known gets 0 questions', () => {
  const brief = JSON.parse(readFileSync(join(DIR, '..', '..', 'samples', 'briefs', 'flagship.json'), 'utf8'));
  const fields = [...new Set(bank.questions.flatMap((q) => q.fills))];
  const facts = {
    project: brief.project,
    schemaVersion: '0.1.0',
    facts: fields.map((field) => ({ field, status: 'known', value: 'x', source: { kind: 'material' }, assumption: false })),
  };
  for (const round of [1, 2, 3]) assert.deepEqual(selectQuestions(brief, facts, bank, { round }), []);
});

// Industry playbooks: what each kind of business needs from its site. Intake detects the industry
// from the owner's own words, asks that industry's questions, builds the page set for the tier,
// and records the one action the site is built to make happen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProject } from '../../src/core/project.mjs';
import { check } from '../../src/core/schemas.mjs';
import { runIntake } from '../../src/intake/run.mjs';
import { selectQuestions } from '../../src/intake/questions.mjs';
import { deriveIndustry, detectIndustry, FALLBACK_INDUSTRY, loadIndustries, pagesFor, playbookQuestions, resolveBusiness } from '../../src/registry/industries.mjs';
import { loadQuestionBank } from '../../src/registry/load.mjs';

const industries = loadIndustries();
const byId = (id) => industries.find((p) => p.id === id);

function workspaceWith(name) {
  const workspace = mkdtempSync(join(tmpdir(), 'forge-playbook-'));
  createProject(name, { workspace });
  return workspace;
}

// Answers with the given values by question id, and the recommendation for everything else.
const answerWith = (given, asked = []) => async (qs, { round }) => {
  asked.push(...qs.map((q) => ({ id: q.id, round })));
  return qs.map((q) => (q.id in given ? given[q.id] : 'use-recommendation'));
};

test('every playbook loads, is consistent, and has the fallback beside it', () => {
  assert.ok(industries.length >= 5);
  assert.ok(industries.some((p) => p.id === FALLBACK_INDUSTRY));
  for (const id of ['real-estate', 'restaurant-cafe', 'healthcare-clinic', 'professional-services']) assert.ok(byId(id), id);
  for (const pb of industries) {
    assert.deepEqual(check('industryPlaybook', pb).errors, [], pb.id);
    assert.ok(pb.conversions.some((c) => c.id === pb.primaryDefault), `${pb.id}: a primary action`);
    assert.ok(pb.questions.length >= 6, `${pb.id}: the deep questions are worth asking`);
  }
});

test('the compiled questions are valid and merge into one bank with unique ids', () => {
  const bank = loadQuestionBank();
  const ids = bank.questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const pb of industries) {
    const qs = playbookQuestions(pb);
    assert.ok(qs.length >= 14, `${pb.id} compiles ${qs.length} questions`);
    assert.ok(qs.every((q) => ids.includes(q.id)));
    assert.ok(qs.some((q) => q.fills[0] === 'business.primaryAction'), `${pb.id} asks for the primary action`);
    assert.equal(qs.filter((q) => q.fills[0] === 'pages').length, 3, `${pb.id} recommends a page set for each tier`);
  }
});

test('the industry is detected from the owner\'s own words, the longest keyword wins, and no match falls back', () => {
  const cases = [
    ['A premium real estate developer in Vadodara', 'real-estate'],
    ['estate agent', 'real-estate'],
    ['Chai cafe near Parul University', 'restaurant-cafe'],
    ['Dental clinic for families', 'healthcare-clinic'],
    ['Chartered accountants', 'professional-services'],
  ];
  for (const [text, want] of cases) assert.equal(detectIndustry(text, industries)?.id, want, text);
  assert.equal(detectIndustry('wedding photography', industries), null);
  assert.equal(detectIndustry('forestry', industries), null, 'a keyword inside another word does not match');
});

test('a bigger tier gets a bigger site: 5 pages for S, 9 or more for M, more than 12 for L, each with a call to action', () => {
  for (const pb of industries) {
    const [s, m, l] = ['S', 'M', 'L'].map((t) => pagesFor(pb, t));
    assert.equal(s.length, 5, `${pb.id} S`);
    assert.ok(m.length >= 9 && m.length <= 12, `${pb.id} M has ${m.length}`);
    assert.ok(l.length > 12, `${pb.id} L has ${l.length}`);
    for (const p of [...s, ...m, ...l]) assert.ok(p.cta.length > 2 && p.purpose.length > 10);
    assert.ok(s.every((p) => m.some((x) => x.slug === p.slug)), 'M keeps every S page');
    assert.equal(s[0].slug, '/');
  }
});

test('resolveBusiness names the primary action, the hero items and the sections the pages need', () => {
  const re = byId('real-estate');
  const b = resolveBusiness(re, {});
  assert.equal(b.primaryConversion.label, 'Book a site visit');
  assert.deepEqual(b.secondaryConversions.map((s) => s.id), ['brochure', 'whatsapp', 'call']);
  assert.match(b.heroMustHave[0], /"Book a site visit".*first and most prominent/);
  assert.ok(b.heroMustHave.some((h) => /Download brochure/.test(h)), 'the brochure is in the hero');
  assert.ok(!b.heroMustHave.some((h) => /Call now/.test(h)), 'a secondary action that is not a hero item stays out of the hero');
  assert.ok(b.requiredSections['/'].length >= 5);

  // The owner's answers win, and the primary action never repeats as a secondary one.
  const chosen = resolveBusiness(re, { business: { primaryAction: 'brochure', secondaryActions: ['brochure', 'book-visit'] } });
  assert.equal(chosen.primaryConversion.label, 'Download brochure');
  assert.deepEqual(chosen.secondaryConversions.map((s) => s.id), ['book-visit']);
  assert.equal(resolveBusiness(undefined, {}), undefined);
});

test('deriveIndustry records the playbook as an assumption, and an answer is never overwritten', () => {
  const facts = (extra = []) => ({ project: 'p', schemaVersion: '0.1.0', facts: [
    { field: 'projectType', status: 'known', value: 'business', source: { kind: 'answer' }, assumption: false },
    { field: 'client.industry', status: 'known', value: 'boutique real estate brokerage', source: { kind: 'answer' }, assumption: false },
    ...extra,
  ] });
  const derived = deriveIndustry(facts(), industries);
  const f = derived.facts.find((x) => x.field === 'business.industryId');
  assert.equal(f.value, 'real-estate');
  assert.equal(f.status, 'inferred');
  assert.equal(f.assumption, true);
  assert.match(f.reason, /Real estate/);
  const answered = facts([{ field: 'business.industryId', status: 'known', value: 'restaurant-cafe', source: { kind: 'answer' }, assumption: false }]);
  assert.equal(deriveIndustry(answered, industries), answered, 'an answered industry is kept');
  assert.equal(deriveIndustry({ ...facts(), facts: facts().facts.slice(0, 1) }, industries).facts.length, 1, 'nothing to detect before the owner describes the business');
});

test('a real estate owner is asked real estate questions, gets 11 pages at tier M, and the hero leads with a site visit', async () => {
  const workspace = workspaceWith('skyline');
  const asked = [];
  const r = await runIntake('skyline', {
    workspace,
    ask: answerWith({ 'q-project-type': 'business', 'q-tier': 'M', 'q-client-name': 'Skyline Homes', 'q-industry': 'A real estate developer building apartments in Vadodara' }, asked),
  });
  assert.equal(r.status, 'ready', JSON.stringify(r.errors));
  const ids = asked.map((a) => a.id);

  // The generic business questions are replaced by the industry's own.
  for (const generic of ['q-business-goals', 'q-business-audience', 'q-business-pages', 'q-business-forms']) assert.ok(!ids.includes(generic), `${generic} was not asked`);
  for (const own of ['q-real-estate-goals', 'q-real-estate-primary', 'q-real-estate-pages-m', 'q-real-estate-offering', 'q-real-estate-lead-channel', 'q-real-estate-trust']) assert.ok(ids.includes(own), `${own} was asked`);
  assert.ok(!ids.includes('q-real-estate-pages-s') && !ids.includes('q-real-estate-pages-l'), 'only the tier\'s page set is offered');
  // The industry is known after round 1, so its questions come in rounds 2 and 3, and there are many.
  assert.ok(asked.filter((a) => a.round === 1).every((a) => !a.id.startsWith('q-real-estate')));
  assert.ok(asked.length >= 25, `${asked.length} questions in all`);

  const b = r.brief;
  assert.equal(b.business.industryId, 'real-estate');
  assert.equal(b.business.primaryConversion.label, 'Book a site visit');
  assert.equal(b.pages.length, 11);
  assert.equal(b.pages[0].cta, 'Book a site visit', 'the home page leads to the primary action');
  assert.ok(b.business.heroMustHave.some((h) => /Download brochure/.test(h)));
  assert.deepEqual(b.features.forms.map((f) => f.id), ['site-visit', 'brochure']);
  assert.equal(b.business.details.offering, 'residential-sale');
  assert.ok(b.assumptions.includes('business.industryId'));
  assert.deepEqual(check('brief', b).errors, []);
  assert.match(r.estimate.assumptions.join(' '), /./);
});

test('what the owner says about the primary action changes the home page, and the plan says what the site is built to do', async () => {
  const workspace = workspaceWith('brochure-first');
  const r = await runIntake('brochure-first', {
    workspace,
    ask: answerWith({ 'q-project-type': 'business', 'q-tier': 'S', 'q-client-name': 'Greenfield', 'q-industry': 'plots and real estate', 'q-real-estate-primary': 'brochure' }),
  });
  assert.equal(r.brief.business.primaryConversion.label, 'Download brochure');
  assert.equal(r.brief.pages[0].cta, 'Download brochure');
  assert.equal(r.brief.pages.length, 5);
  const { readFileSync } = await import('node:fs');
  const plan = readFileSync(join(workspace, 'brochure-first', 'intake', 'plan.md'), 'utf8');
  assert.match(plan, /What the site is built to do/);
  assert.match(plan, /\*\*Download brochure\*\*/);
  assert.match(plan, /Material the client should supply/);
});

test('a business with no playbook of its own gets the general playbook, so it still gets a full site and deep questions', async () => {
  const workspace = workspaceWith('odd');
  const asked = [];
  const r = await runIntake('odd', {
    workspace,
    ask: answerWith({ 'q-project-type': 'business', 'q-tier': 'M', 'q-client-name': 'Odd Jobs', 'q-industry': 'bespoke candle workshop' }, asked),
  });
  assert.equal(r.brief.business.industryId, 'general-business');
  assert.ok(r.brief.pages.length >= 9);
  assert.ok(asked.some((a) => a.id === 'q-general-business-offering'));
  assert.equal(r.brief.business.primaryConversion.label, 'Send an enquiry');
});

test('a question a playbook adds is only asked once the industry is known', () => {
  const bank = loadQuestionBank();
  const facts = { project: 'p', schemaVersion: '0.1.0', facts: [] };
  const round2 = selectQuestions({ project: 'p' }, facts, bank, { round: 2 }).map((q) => q.id);
  assert.ok(!round2.some((id) => id.startsWith('q-real-estate')), 'no industry, no industry questions');
});

test('brief.business is optional: a brief with none still validates', () => {
  const brief = JSON.parse(JSON.stringify(
    { schemaVersion: '0.1.0', status: 'draft', project: 'x', projectType: 'business', tier: 'S', client: { name: 'X', industry: 'shop' }, goals: [{ id: 'g', statement: 'Get enquiries' }], audience: [{ segment: 'a', need: 'b' }], pages: [{ slug: '/', title: 'Home', purpose: 'Start', cta: 'Go' }], brand: { tone: ['warm'], motionIntensity: 1 }, constraints: { deviceFloor: 'mid', accessibility: 'WCAG 2.2 AA' }, assumptions: [] },
  ));
  assert.deepEqual(check('brief', brief).errors, []);
});

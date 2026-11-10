// One-prompt mode: forge go. The words become the intake answers, everything else uses the
// playbook's recommendation as an assumption, and the run stops only for what the operator owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyBlockers, runGo, summarise } from '../../src/cli/go.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { loadProject } from '../../src/core/project.mjs';
import { extractFromPrompt } from '../../src/intake/express.mjs';
import { loadIndustries } from '../../src/registry/industries.mjs';

const industries = loadIndustries();
const workspace = () => mkdtempSync(join(tmpdir(), 'forge-go-'));

test('the words give the name, what the business does, the kind of site and the size', () => {
  const a = extractFromPrompt('Build me a website for Skyline Homes, a real estate developer in Vadodara', industries);
  assert.equal(a.answers['q-client-name'], 'Skyline Homes');
  assert.match(a.answers['q-industry'], /real estate developer in Vadodara/);
  assert.equal(a.answers['q-project-type'], 'business');
  assert.equal(a.answers['q-tier'], 'M', 'no size words: a medium site, said out loud as an assumption');
  assert.ok(a.assumed.some((x) => /11 pages/.test(x)));

  assert.equal(extractFromPrompt('A big complete website for Greenfield Plots, plots and real estate', industries).answers['q-tier'], 'L');
  assert.equal(extractFromPrompt('A simple website for Dr Rao, a dental clinic', industries).answers['q-tier'], 'S');
  assert.equal(extractFromPrompt('Portfolio site called Studio North for my photography work', industries).answers['q-project-type'], 'portfolio');
  assert.equal(extractFromPrompt('Name: Chai Bistro\nA cafe near Parul University', industries).answers['q-client-name'], 'Chai Bistro');
  assert.deepEqual(extractFromPrompt('   ', industries).answers, {}, 'nothing said, nothing assumed');
});

test('a prompt with no name asks the operator for the name, then once for what is unique, and Enter skips that', async () => {
  const ws = workspace();
  const asked = [];
  const r = await runGo('nameless', {
    workspace: ws,
    prompt: 'a website for a dental clinic',
    askOperator: async (qs) => {
      asked.push(...qs.map((q) => q.id));
      return qs.map((q) => (q.id === 'q-client-name' ? 'Smile Dental' : undefined));
    },
    designRun: async () => ({ reason: 'reached', spentUsd: 0 }),
    repair: async () => ({ outcome: 'passed', loops: 0, report: { defects: [] } }),
  });
  assert.deepEqual(asked, ['q-client-name', 'q-truths']);
  assert.equal(r.status, 'ready');
  const brief = JSON.parse(readFileSync(join(ws, 'nameless', 'intake', 'brief.json'), 'utf8'));
  assert.equal(brief.client.name, 'Smile Dental');
  assert.equal(brief.business.industryId, 'healthcare-clinic');
});

test('without a name and nobody to ask, go says what is missing instead of guessing', async () => {
  const r = await runGo('stuck', { workspace: workspace(), prompt: 'a website for a dental clinic' });
  assert.equal(r.status, 'needs-answers');
  assert.ok(r.missing.includes('client.name'));
});

test('the missing direction and its B2 approval are one decision for the operator', () => {
  const c = classifyBlockers(['a chosen direction in design/directions.json', 'approval B2 (forge approve p B2)']);
  assert.deepEqual(c.decisions.map((d) => d.kind), ['direction']);
  assert.equal(c.other.length, 0);
});

test('blockers split into what the operator decides and what is something else', () => {
  const c = classifyBlockers(['approval B1 (forge approve p B1)', 'approval B2 (forge approve p B2)', 'licence not cleared: font.woff2 (uncertain)', 'task x is blocked: nope']);
  assert.deepEqual(c.decisions.map((d) => d.kind), ['approval', 'direction', 'licence']);
  assert.equal(c.decisions[0].code, 'B1');
  assert.equal(c.other.length, 1);
});

// A workflow that stops where the real one does: at B1, at B2, at B3, then reaches visual QA.
function fakeFlow(project, ws) {
  const stops = [
    ['approval B1 (forge approve ' + project + ' B1)'],
    ['approval B2 (forge approve ' + project + ' B2)'],
    ['approval B3 (forge approve ' + project + ' B3)'],
  ];
  let i = 0;
  return async () => {
    if (i === 1) {
      mkdirSync(join(ws, project, 'design'), { recursive: true });
      writeFileSync(join(ws, project, 'design', 'directions.json'), JSON.stringify({ status: 'proposed', directions: [{ id: 'D1', name: 'Warm', rationale: 'a warm look' }, { id: 'D2', name: 'Bold', rationale: 'a bold look' }] }));
    }
    return i < stops.length ? { reason: 'needs', blockers: stops[i++], stoppedAt: 'X', spentUsd: 1 } : { reason: 'reached', spentUsd: 1 };
  };
}
const repair = async () => ({ outcome: 'passed', loops: 1, report: { defects: [] } });
const PROMPT = 'Build me a website for Skyline Homes, a real estate developer in Vadodara';

test('with no way to ask, go stops at B1 and says how to approve it; it records nothing', async () => {
  const ws = workspace();
  const r = await runGo('skyline', { workspace: ws, prompt: PROMPT, designRun: fakeFlow('skyline', ws), repair });
  assert.equal(r.status, 'waiting');
  assert.equal(r.needs.kind, 'approval');
  assert.equal(r.needs.code, 'B1');
  assert.match(r.needs.covers, /plan/);
  assert.ok(!ledger.read('skyline', { workspace: ws }).some((e) => e.type === 'approval'), 'go never approves for the operator');
  assert.ok(existsSync(join(ws, 'skyline', 'intake', 'plan.md')));
  assert.equal(JSON.parse(readFileSync(join(ws, 'skyline', 'intake', 'brief.json'), 'utf8')).pages.length, 11);
});

test('the operator\'s own flags carry it through B1, the direction and B3 to a built site', async () => {
  const ws = workspace();
  const said = [];
  const r = await runGo('skyline', { workspace: ws, prompt: PROMPT, approve: ['B1', 'B3'], direction: 'D2', designRun: fakeFlow('skyline', ws), repair, say: (s) => said.push(s) });
  assert.equal(r.status, 'ready');
  assert.equal(r.qa.outcome, 'passed');
  assert.equal(r.spentUsd, 5, "one extra stop, for the media step");
  const codes = ledger.read('skyline', { workspace: ws }).filter((e) => e.type === 'approval').map((e) => e.data.approval);
  assert.deepEqual(codes, ['B1', 'B2', 'B3']);
  assert.equal(JSON.parse(readFileSync(join(ws, 'skyline', 'design', 'directions.json'), 'utf8')).chosen, 'D2');
  assert.ok(said.some((s) => /Built to make visitors|Understood/.test(s)));
  assert.equal(loadProject('skyline', { workspace: ws }).phase, 'INTAKE', 'the stub did not advance the phase');
});

test('a yes typed at the terminal approves; a no leaves the run waiting', async () => {
  const ws = workspace();
  const decide = async (need) => (need.kind === 'approval' ? need.code === 'B1' : 'D1');
  const r = await runGo('skyline', { workspace: ws, prompt: PROMPT, decide, designRun: fakeFlow('skyline', ws), repair });
  assert.equal(r.status, 'waiting');
  assert.equal(r.needs.code, 'B3', 'B1 was said yes to, the direction was chosen, B3 was said no to');
  const codes = ledger.read('skyline', { workspace: ws }).filter((e) => e.type === 'approval').map((e) => e.data.approval);
  assert.deepEqual(codes, ['B1', 'B2']);
});

test('a rerun continues the same project without asking the prompt again', async () => {
  const ws = workspace();
  await runGo('skyline', { workspace: ws, prompt: PROMPT, designRun: fakeFlow('skyline', ws), repair });
  const again = await runGo('skyline', { workspace: ws, approve: ['B1', 'B3'], direction: 'D1', designRun: fakeFlow('skyline', ws), repair });
  assert.equal(again.status, 'ready');
});

test('a stop that is not the operator\'s (budget, error, a blocked task) is reported, not hidden', async () => {
  const ws = workspace();
  const budget = await runGo('a', { workspace: ws, prompt: PROMPT, designRun: async () => ({ reason: 'budget', stoppedAt: 'BUILD', spentUsd: 3 }), repair });
  assert.equal(budget.status, 'stopped');
  assert.equal(budget.reason, 'budget');
  const blocked = await runGo('a', { workspace: ws, designRun: async () => ({ reason: 'needs', blockers: ['task t is blocked: x'], stoppedAt: 'BUILD', spentUsd: 0 }), repair });
  assert.equal(blocked.status, 'stopped');
  assert.deepEqual(blocked.detail, ['task t is blocked: x']);
});

test('the summary names the primary action, the pages and the assumptions', () => {
  const lines = summarise({
    project: 'p', client: { name: 'Skyline', industry: 'real estate' }, pages: [{ title: 'Home' }, { title: 'Projects' }],
    business: { primaryConversion: { label: 'Book a site visit' }, secondaryConversions: [{ label: 'Download brochure' }] }, assumptions: ['a', 'b'],
  });
  assert.match(lines.join('\n'), /Built to make visitors: Book a site visit/);
  assert.match(lines.join('\n'), /Also offered: Download brochure/);
  assert.match(lines.join('\n'), /2 pages: Home, Projects/);
  assert.match(lines.join('\n'), /2 assumption/);
});

test('what the owner says is unique (truths) reaches the design stages; the visitor questions are assumptions', async () => {
  const ws = workspace();
  const r = await runGo('story', {
    workspace: ws,
    prompt: PROMPT,
    askOperator: async (qs) => qs.map(() => 'Only builder in Waghodia with a RERA-registered project; 12 years; Hand-picked Italian marble'),
    designRun: async () => ({ reason: 'reached', spentUsd: 0 }),
    repair,
  });
  assert.equal(r.status, 'ready');
  const b = JSON.parse(readFileSync(join(ws, 'story', 'intake', 'brief.json'), 'utf8'));
  assert.deepEqual(b.truths.map((x) => x.text), ['Only builder in Waghodia with a RERA-registered project', '12 years', 'Hand-picked Italian marble']);
  assert.deepEqual(b.business.visitorSources, ['google-search', 'instagram']);
  assert.equal(b.business.visitorDevice, 'phone-mostly');
  assert.ok(b.assumptions.includes('business.visitorDevice'));
  const { businessAcceptance } = await import('../../src/core/planner.mjs');
  assert.match(businessAcceptance(b, 'direction').join(' '), /concept must rest on one of these facts/);
  assert.match(businessAcceptance(b, 'copy').join(' '), /register each as a claim/);
  assert.match(businessAcceptance(b, 'section-plan').join(' '), /Visitors arrive from: google-search, instagram/);
  const none = { ...b, truths: [] };
  assert.ok(!businessAcceptance(none, 'direction').join(' ').includes('no competitor can claim'), 'an unknown is never presented as a fact');
});

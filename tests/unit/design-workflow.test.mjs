import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { advanceProject, exitBlockers } from '../../src/core/advance.mjs';
import { listTasks, saveTask, transitionTask } from '../../src/core/board.mjs';
import { PermissionDenied } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { businessAcceptance, formAction, pageTaskId, planPhase, specTask, writeStubs } from '../../src/core/planner.mjs';
import { actionFor } from '../../plugins/form-function/index.mjs';
import { approve, hasApproval, loadProject, PHASES, returnToPhase } from '../../src/core/project.mjs';
import { check } from '../../src/core/schemas.mjs';
import { writeJsonAtomic } from '../../src/core/workspace.mjs';
import { buildTargets, MAX_STAGE_RETURNS, retryBuildTask, retryStage, runDesignWorkflow, sendBack } from '../../src/design/manager.mjs';
import { CHECKS, contentRuleProblems, funnelProblems, isSuperseded, loadMethodologies, readiness, sectionUse, writeLockedPages } from '../../src/design/spec.mjs';
import { createBudget, limitedWorker } from '../../src/core/spend.mjs';
import { classifyGate } from '../../src/design/release.mjs';
import { mix, tokensFromDirection } from '../../src/site/tokens.mjs';
import { STUB_MARK, stubsLeft, withSiteLock } from '../../src/qa/visual.mjs';
import { addTasks, newProject, task } from './helpers.mjs';
import { agentsForPhase } from '../../src/core/agents.mjs';

const BRIEF = {
  schemaVersion: '0.1.0', status: 'ready', project: 'demo', projectType: 'business', tier: 'S',
  client: { name: 'Harbor Home', industry: 'home renovation', languages: ['en'] },
  goals: [{ id: 'leads', statement: 'Get enquiries' }],
  audience: [{ segment: 'Homeowners', need: 'A fair price' }],
  pages: [{ slug: '/', title: 'Home', purpose: 'Start an enquiry', cta: 'Book a visit' }],
  features: { forms: [], interactive: [] },
  brand: { tone: ['warm'], motionIntensity: 1 },
  constraints: { deviceFloor: 'low', accessibility: 'WCAG 2.2 AA' },
  integrations: [], assumptions: [],
};
const FONT = (family) => ({ family, category: 'sans', source: 'fontsource', licence: 'OFL-1.1' });
const COLOURS = { bg: '#fbf8f3', fg: '#1f1b16', primary: '#2f6b5a', accent: '#8a3b12', muted: '#5d554b', surface: '#f2ede5', border: '#ddd5ca', onPrimary: '#ffffff', onAccent: '#ffffff', link: '#2f6b5a' };
const CHOSEN = { id: 'dir-a', name: 'A', rationale: 'r', typography: { display: FONT('Fraunces'), body: FONT('Lora'), scaleRatio: 1.25 }, colour: { mode: 'light', tokens: COLOURS, contrast: [] }, motionIntensity: 1, layout: 'editorial', approaches: ['APP-01'], renders: { desktop: 'a.png', mobile: 'b.png' } };

function write(dir, file, data) {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// A complete, good specification. Tests break one part at a time.
function spec() {
  const tokens = tokensFromDirection(CHOSEN);
  const section = (id, pattern, extra = {}) => ({
    id, purpose: 'Say what makes the firm different', pattern,
    composition: 'A large headline sits across eight columns on the left, with the photograph bleeding off the right edge and overlapping the next section by a third',
    hierarchy: 'Headline first, then the photograph, then the supporting sentence',
    background: 'The warm paper background', typography: 'Display face at the largest step',
    assets: ['kitchen'], motion: ['rise'],
    responsive: { desktop: 'Two offset columns', tablet: 'Two even columns', mobile: 'One column with the photograph first' },
    ...extra,
  });
  return {
    'research/summary.md': 'x'.repeat(300),
    'research/sources.json': { sources: [{ id: 'brief', title: 'Brief', kind: 'client', ref: 'intake/brief.json' }] },
    'research/positioning.json': {
      business: 'A family renovation firm in Portland', audienceInsights: ['Owners of old houses fear surprise costs'], objectives: ['More enquiries'],
      positioning: 'The contractor who treats a crooked old house like a ship: nothing square, everything fitted',
      differentiators: ['Fixed itemised quotes', 'A site lead every day'],
      competitors: [{ name: 'Casco Build', observation: 'Sells on dream-home imagery' }, { name: 'Bay Renovations', observation: 'A generic card template' }],
      references: [1, 2, 3].map((n) => ({ name: `Reference ${n}`, url: `https://example.com/${n}`, whatToLearn: 'An offset editorial grid' })),
    },
    'design/approach-decision.json': { decisions: loadMethodologies().map((m) => ({ approach: m.id, selected: m.id === 'APP-01', reason: 'r' })) },
    'design/directions.json': { project: 'demo', schemaVersion: '0.1.0', status: 'chosen', chosen: 'dir-a', approval: { code: 'B2', ledgerSeq: 1 }, directions: [CHOSEN] },
    'design/direction.json': {
      project: 'demo', primaryApproach: 'APP-01',
      concept: 'A renovation firm that talks like a ship carpenter: plain, exact, and proud of tight joints',
      whyThisApproach: 'The fixed quote is an argument, and arguments are read',
      interpretation: {
        philosophy: 'Plain words set large, because the promise is the design', principles: ['Say the price rule first'], visualIdentity: 'A carpenter\'s rule along every margin', personality: ['Plain', 'Exact'],
        composition: 'Offset columns measured off a visible rule', contentStyle: 'Short and specific', assetTreatment: 'Unretouched site photos', motionConcept: 'Things settle into place', scrollConcept: 'Native scrolling', responsive: 'The rule moves to the top edge',
      },
      rejected: loadMethodologies().filter((m) => m.id !== 'APP-01').map((m) => ({ approach: m.id, reason: 'Not suited to a practical service business' })),
      combination: [],
    },
    'design/design-system.json': {
      personality: 'Plain and exact', visualLanguage: ['A ruled margin', 'Numbered sections', 'Tight photo crops'],
      color: { primary: tokens.color.primary, secondary: '#445566', accent: tokens.color.accent, background: tokens.color.bg, surface: tokens.color.surface, text: tokens.color.fg, muted: tokens.color.muted, usage: 'Accent only on calls to action' },
      typography: { display: 'Fraunces', body: 'Lora', pairingReason: 'A sturdy serif over a bookish one', hierarchy: ['Display', 'Heading', 'Subheading', 'Body', 'Label'].map((role, i) => ({ role, size: `${5 - i}rem`, weight: 400, lineHeight: 1.2 })) },
      spacing: { scale: ['8px', '16px', '32px', '64px'], sectionRhythm: 'Alternating tight and generous' }, grid: { columns: 12, gutter: '24px', maxWidth: '1320px', rules: 'Images may break the right edge' },
      surfaces: { borders: 'One hairline rule', shadows: 'None', radius: 'Square corners', treatments: 'Paper surfaces' },
      responsive: { desktop: 'Twelve columns', tablet: 'Eight columns', mobile: 'Four columns with the rule on top' },
    },
    'design/section-plan.json': { pages: [{ slug: '/', sections: [section('promise', 'statement', { motion: ['rise', 'cta-rule', 'count', 'settle', 'drift'], funnel: 'awareness' }), section('quote-rule', 'editorial-split', { funnel: 'interest' }), section('old-houses', 'asymmetric', { assets: [], funnel: 'interest' }), section('process', 'list-editorial', { assets: [], funnel: 'desire' }), section('proof', 'quote-feature', { assets: [], funnel: 'action' })] }] },
    'research/crux.json': { buckets: {
      about: { items: [{ text: 'A family firm that fits old Portland houses', source: 'brief' }], gaps: [] },
      whatWeDo: { items: [{ text: 'Kitchens, bathrooms and whole-house renovations', source: 'brief' }], gaps: [] },
      ourWork: { items: [], gaps: ['Which finished jobs can we show, with the owners\' permission?'] },
      resourceHub: { items: [], gaps: ['Is there a guide or a checklist the firm would share?'] },
      reachUs: { items: [{ text: 'Book a home visit', source: 'assumption' }], gaps: [] },
    } },
    'design/motion-plan.json': {
      concept: 'Things settle into place', loading: 'Text first, then images', navigation: 'Header stays put', pageTransitions: 'A short crossfade', reducedMotion: 'Everything shows, nothing moves',
      motions: [
        { id: 'rise', kind: 'scroll', trigger: 'On entering view', behaviour: 'Rises 12px and settles', purpose: 'Marks each promise as a new point' },
        { id: 'cta-rule', kind: 'hover', trigger: 'Hover on a call to action', behaviour: 'A rule slides under the label', purpose: 'Confirms the link is live and ready' },
        { id: 'settle', kind: 'transition', trigger: 'On leaving a page', behaviour: 'The page settles out in 300ms', purpose: 'Shows the visitor moved to a new place' },
        { id: 'drift', kind: 'ambient', trigger: 'Always on', behaviour: 'The ruled margin drifts a pixel', purpose: 'Keeps the page feeling alive and measured' },
        { id: 'count', kind: 'micro', trigger: 'On entering view', behaviour: 'The number ticks once', purpose: 'Draws the eye to the guarantee length' },
      ],
    },
    'design/asset-plan.json': { treatment: 'Unretouched', assets: [{ id: 'kitchen', kind: 'svg', description: 'A detailed section drawing of a joined kitchen beam', source: 'authored', alt: 'A kitchen beam, drawn in section' }] },
    'content/copy.json': {
      brandStory: 'Harbor Home was started by a ship carpenter who found old Portland houses behave like old boats: nothing is square, and everything has to be fitted to what is really there. That is still how the firm works.',
      voice: 'Plain and exact', nav: [{ label: 'Home', href: '/' }],
      footer: { tagline: 'Fitted to what is really there', contact: ['(207) 555-0142'], columns: [], legal: 'Licensed and insured in Maine' },
      pages: [{
        slug: '/', title: 'Home', description: 'Harbor Home renovates old Portland houses to a fixed, itemised quote.', cta: { label: 'Book a visit', href: 'tel:2075550142' },
        sections: ['promise', 'quote-rule', 'old-houses', 'process', 'proof'].map((id, i) => ({
          id, headline: ['The price we quote is the price you pay', 'If we priced it wrong, that is our problem', 'Nothing in your house is square. We expected that', 'A visit, a drawing, then a quote', 'They told us what it would cost'][i],
          body: ['Every job starts with a free home visit and an itemised written quote from Harbor Home, and it changes only if you change the plan. Every line says what it pays for, so you can see where the money goes before anyone lifts a tool.'],
        })),
      }],
    },
    'design/review.json': { verdict: 'ready', summary: 'The specification holds together', findings: [] },
    'assets/register.json': { assets: [] },
  };
}

function fullProject(overrides = {}) {
  const { project, opts, workspace } = newProject('demo');
  const dir = join(workspace, project);
  write(dir, 'intake/brief.json', BRIEF);
  for (const [file, data] of Object.entries({ ...spec(), ...overrides })) write(dir, file, data);
  return { project, opts, dir };
}

const setPhase = (dir, phase) => {
  const f = join(dir, 'project.json');
  writeJsonAtomic(f, { ...JSON.parse(readFileSync(f, 'utf8')), phase });
};

test('all eight approaches have a complete methodology that passes the schema', () => {
  const all = loadMethodologies();
  assert.equal(all.length, 8);
  for (const m of all) {
    assert.deepEqual(check('methodology', m).errors, [], m.id);
    assert.ok(m.provenance.interpreted.length, `${m.id} says what is interpretation`);
  }
});

test('a complete specification is ready', () => {
  const { dir } = fullProject();
  const r = readiness(dir);
  assert.deepEqual(r.stages.flatMap((s) => s.problems), []);
  assert.equal(r.ready, true);
});

test('each missing specification is named, and blocks the phase that owes it', () => {
  const { project, opts, dir } = (() => {
    const p = newProject('demo');
    const d = join(p.workspace, p.project);
    write(d, 'intake/brief.json', BRIEF);
    return { ...p, dir: d };
  })();
  const r = readiness(dir);
  assert.equal(r.ready, false);
  assert.deepEqual(r.stages.filter((s) => !s.ok).map((s) => s.id), ['research', 'direction', 'design-system', 'section-plan', 'motion-plan', 'asset-plan', 'copy', 'asset-files']);
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  assert.ok(exitBlockers(project, opts).some((b) => /design-system.json is missing/.test(b)));
  setPhase(dir, 'TECHNICAL_PLAN');
  planPhase(project, opts);
  assert.ok(exitBlockers(project, opts).some((b) => /review.json/.test(b)));
});

test('the build is refused until the whole specification passes', () => {
  const s = spec();
  const { project, opts, dir } = fullProject({ 'design/motion-plan.json': { ...s['design/motion-plan.json'], motions: s['design/motion-plan.json'].motions.slice(1) } });
  setPhase(dir, 'BUILD');
  assert.throws(() => planPhase(project, opts), /specification is not complete/);
  assert.equal(existsSync(join(dir, 'site')), false, 'no site was started');
});

test('section checks catch vague, card-only and repetitive plans', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections[0].composition = 'A section with a heading';
  plan.pages[0].sections[1].responsive.mobile = plan.pages[0].sections[1].responsive.desktop;
  for (const x of plan.pages[0].sections) x.pattern = 'card-grid';
  const { dir } = fullProject({ 'design/section-plan.json': plan });
  const problems = CHECKS['section-plan'](dir);
  for (const want of [/too vague/, /must differ from desktop/, /three sections in a row/, /card or grid layouts/, /at least four different/, /not part of APP-01/]) {
    assert.ok(problems.some((p) => want.test(p)), want.source);
  }
});

test('copy checks catch labels, stock phrases, thin text and sections with no copy', () => {
  const s = spec();
  const copy = structuredClone(s['content/copy.json']);
  copy.pages[0].sections[0].headline = 'Our services';
  copy.pages[0].sections[1].body = ['Unlock your dream home with seamless, world-class renovations.'];
  copy.pages[0].sections[2].body = [];
  copy.pages[0].sections.pop();
  const { dir } = fullProject({ 'content/copy.json': copy });
  const problems = CHECKS.copy(dir);
  for (const want of [/only labels the section/, /stock phrase/, /a headline alone/, /proof has no copy/]) assert.ok(problems.some((p) => want.test(p)), want.source);
});

test('approaches are not mixed: only a justified, allowed combination passes', () => {
  const s = spec();
  const direction = structuredClone(s['design/direction.json']);
  direction.combination = [{ approach: 'APP-05', reason: 'It would look nice' }];
  direction.rejected = direction.rejected.filter((r) => r.approach !== 'APP-05');
  const { dir } = fullProject({ 'design/direction.json': direction });
  const problems = CHECKS.direction(dir);
  assert.ok(problems.some((p) => /does not combine with APP-05/.test(p)));

  direction.combination = [];
  direction.primaryApproach = 'APP-03';
  const other = fullProject({ 'design/direction.json': direction });
  assert.ok(CHECKS.direction(other.dir).some((p) => /APP-03 is not selected/.test(p)));

  const skipped = structuredClone(s['design/direction.json']);
  skipped.rejected = skipped.rejected.slice(1);
  assert.ok(CHECKS.direction(fullProject({ 'design/direction.json': skipped }).dir).some((p) => /all 8 approaches/.test(p)));
});

test('the design system must keep the fonts and colours approved at B2', () => {
  const s = spec();
  const system = structuredClone(s['design/design-system.json']);
  system.color.primary = '#ff00ff';
  system.typography.display = 'Comic Sans';
  const problems = CHECKS['design-system'](fullProject({ 'design/design-system.json': system }).dir);
  assert.ok(problems.some((p) => /color.primary must be/.test(p)));
  assert.ok(problems.some((p) => /display face/.test(p)));
});

test('locked pages are written from the copy, in plan order, with bespoke sections', () => {
  const { dir } = fullProject();
  writeLockedPages(dir);
  const page = readFileSync(join(dir, 'content/pages/index.md'), 'utf8');
  assert.match(page, new RegExp(sectionUse('APP-01', 'quote-rule')));
  assert.match(page, /APP-01\/QuoteRule/);
  assert.match(page, /status: "locked"/);
  assert.ok(page.indexOf('Promise') < page.indexOf('QuoteRule'));
  assert.match(page.split('---').at(-1), /The price we quote is the price you pay/, 'the body repeats the copy for content parity');
});

test('sending work back returns to the stage with its findings, and voids only what it changes', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'TECHNICAL_PLAN');
  approve(project, 'B3', opts);
  approve(project, 'B2', opts);
  const out = sendBack(project, 'section-plan', ['promise: the composition is too vague'], opts);
  assert.equal(out.returned, true);
  assert.equal(loadProject(project, opts).phase, 'UX_DESIGN_SYSTEM');
  assert.equal(hasApproval(project, 'B3', opts), true, 'the plan changed, not the approved copy');
  assert.equal(hasApproval(project, 'B2', opts), true, 'the direction did not change');
  assert.equal(existsSync(join(dir, 'design/review.json')), false, 'the old review no longer counts');
  const fix = listTasks(project, opts).find((t) => t.id === 'section-plan-fix-1');
  assert.ok(fix.acceptance[0].includes('too vague'), 'the fix task carries the finding');
  assert.equal(fix.agent, 'creative-director');
  setPhase(dir, 'TECHNICAL_PLAN');
  sendBack(project, 'copy', ['batch: stock phrase'], opts);
  assert.equal(hasApproval(project, 'B3', opts), false, 'the copy must be approved again');
  assert.equal(hasApproval(project, 'B2', opts), true);
});

test('a copy return also syncs the section plan, so later reviews never judge against stale beats', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'TECHNICAL_PLAN');
  sendBack(project, 'copy', ['the-pour: invented recipe steps'], opts);
  const fix = listTasks(project, opts).find((t) => t.id === 'copy-fix-1');
  const sync = listTasks(project, opts).find((t) => t.id === 'section-plan-sync-1');
  assert.ok(fix && sync, 'both the copy fix and the plan sync are on the board');
  assert.deepEqual(sync.depends_on, [fix.id], 'the plan syncs after the corrected copy exists');
  assert.equal(sync.agent, 'creative-director');
  assert.ok(sync.acceptance.some((a) => /match the corrected copy/.test(a)));
  assert.ok(ledger.read(project, opts).some((e) => e.data?.event === 'design_plan_synced'));
});

test('research sorts the facts into five buckets, each traceable, with gaps as client questions', () => {
  const s = spec();
  assert.deepEqual(CHECKS.research(fullProject().dir), []);
  const crux = structuredClone(s['research/crux.json']);
  crux.buckets.ourWork.gaps = [];
  crux.buckets.about.items.push({ text: 'Forty years of trade experience', source: 'website' });
  const problems = CHECKS.research(fullProject({ 'research/crux.json': crux }).dir);
  assert.ok(problems.some((p) => /Our Work is empty/.test(p)), JSON.stringify(problems));
  assert.ok(problems.some((p) => /cites website, which is not in research\/sources.json/.test(p)), JSON.stringify(problems));
  const { dir } = fullProject();
  rmSync(join(dir, 'research/crux.json'));
  assert.ok(CHECKS.research(dir).some((p) => /research\/crux.json is missing/.test(p)));
});

test('sections follow the visitor journey: awareness to action, stepping back only after an action', () => {
  const page = (slug, stages) => ({ slug, sections: stages.map((f, i) => ({ id: `s${i}`, ...(f ? { funnel: f } : {}) })) });
  assert.deepEqual(funnelProblems(page('/', ['awareness', 'interest', 'desire', 'action'])), []);
  assert.deepEqual(funnelProblems(page('/', ['awareness', 'action', 'interest', 'desire', 'action'])), [], 'a mid-page call to action starts the next loop');
  assert.deepEqual(funnelProblems(page('/privacy', ['none', 'none'])), [], 'utility pages sit outside the journey');
  assert.deepEqual(funnelProblems(page('/contact', ['action'])), []);
  assert.ok(funnelProblems(page('/', ['awareness', 'desire', 'interest', 'action']))[0].includes('only steps back after a call to action'));
  assert.ok(funnelProblems(page('/services', ['interest', 'desire'])).some((p) => /ends on "desire"/.test(p)));
  assert.ok(funnelProblems(page('/', ['interest', 'action'])).some((p) => /open with awareness/.test(p)));
  assert.ok(funnelProblems(page('/', ['awareness', null, 'action']))[0].includes('give every section a funnel stage'));
  const plan = structuredClone(spec()['design/section-plan.json']);
  plan.pages[0].sections[4].funnel = 'desire';
  assert.ok(CHECKS['section-plan'](fullProject({ 'design/section-plan.json': plan }).dir).some((p) => /ends on "desire"/.test(p)));
});

test('a section plan cannot invent operational facts, and a registered claim covers real ones', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections[0].composition = 'A day-on-site timeline from 9:00 to 4:30pm runs across eight columns, each stop priced from ₹120';
  const { dir } = fullProject({ 'design/section-plan.json': plan });
  const problems = CHECKS['section-plan'](dir);
  assert.ok(problems.some((p) => /operational fact/.test(p) && /9:00/.test(p)), JSON.stringify(problems));
  const covered = fullProject({
    'design/section-plan.json': plan,
    'content/claims.json': { claims: [{ text: 'A day-on-site timeline from 9:00 to 4:30pm runs across eight columns, each stop priced from ₹120', source: 'brief' }] },
  });
  assert.ok(!CHECKS['section-plan'](covered.dir).some((p) => /operational fact/.test(p)));
});

test('a transition that says nothing is refused; a real one passes', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections[0].transition = { toNext: 'fades' };
  plan.pages[0].sections[1].transition = { toNext: 'The rule carries across the seam into the next section, which answers it', device: 'On mobile the rule becomes the top border' };
  const { dir } = fullProject({ 'design/section-plan.json': plan });
  const problems = CHECKS['section-plan'](dir);
  assert.ok(problems.some((p) => /transition.toNext/.test(p)));
  assert.equal(problems.filter((p) => /transition.toNext/.test(p)).length, 1, 'only the empty one is refused');
});

test('a stage sent back too many times escalates instead of looping', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  for (let i = 0; i < MAX_STAGE_RETURNS; i++) assert.equal(sendBack(project, 'section-plan', ['still vague'], opts).returned, true);
  const out = sendBack(project, 'section-plan', ['still vague'], opts);
  assert.equal(out.escalated, true);
  assert.ok(ledger.read(project, opts).some((e) => e.data?.event === 'design_escalated'));
});

test('a refused call never uses up a stage\'s returns: the workflow stops for the budget', async () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  const worker = async () => ({ evidence: ['x'], costUsd: 1 });
  const r = await runDesignWorkflow(project, { ...opts, worker, verifier: async () => ({ ok: true, code: 0, output: 'ok' }), maxUsd: 1, concurrency: 1, stopBefore: 'ASSETS_LICENSING' });
  assert.equal(r.reason, 'budget');
  assert.ok(listTasks(project, opts).some((t) => t.status === 'blocked' && /spend limit/.test(t.blocked_reason)), 'the next call really was refused');
  assert.ok(!ledger.read(project, opts).some((e) => e.data?.event === 'design_returned'), 'nothing was sent back');
  assert.ok(!ledger.read(project, opts).some((e) => e.data?.event === 'design_escalated'));
});

test('the operator\'s retry reissues an escalated stage, and only the operator\'s decision resets the limit', () => {
  const { project, opts, dir } = fullProject();
  rmSync(join(dir, 'content/copy.json'));
  setPhase(dir, 'CONTENT');
  for (let i = 0; i < MAX_STAGE_RETURNS; i++) sendBack(project, 'copy', ['content/copy.json is missing'], opts);
  assert.equal(sendBack(project, 'copy', ['still missing'], opts).escalated, true);
  for (const id of ['copy-fix-1', 'copy-fix-2']) transitionTask(project, id, 'blocked', { reason: 'Attempt 1 failed: refused', ...opts });

  const out = retryStage(project, 'copy', { note: 'The operator added money', ...opts });
  assert.deepEqual([out.returned, out.attempt], [true, 3]);
  const tasks = listTasks(project, opts);
  const fix = tasks.find((t) => t.id === 'copy-fix-3');
  assert.equal(fix.status, 'pending');
  assert.ok(fix.acceptance[0].includes('The operator added money'));
  for (const id of ['copy-fix-1', 'copy-fix-2']) assert.ok(isSuperseded(tasks.find((t) => t.id === id), tasks), `${id} no longer counts`);
  assert.ok(!tasks.some((t) => t.id === 'section-plan-sync-3'), 'copy that never existed made no plan stale');
  assert.ok(!exitBlockers(project, opts).some((b) => /copy-fix-[12]/.test(b)));
  const note = ledger.read(project, opts).find((e) => e.data?.event === 'design_retry_authorized');
  assert.deepEqual([note.actor, note.data.stage], ['operator', 'copy']);

  setPhase(dir, 'TECHNICAL_PLAN');
  assert.ok(!exitBlockers(project, opts).some((b) => /copy-fix-[12] and/.test(b)), 'superseded tasks hold no claim on their files');
  setPhase(dir, 'CONTENT');
  assert.equal(sendBack(project, 'copy', ['again'], opts).attempt, 4);
  assert.equal(sendBack(project, 'copy', ['and again'], opts).escalated, true, 'the fresh limit is still a limit');
  assert.throws(() => retryStage(project, 'asset-files', { note: 'x', ...opts }), /not a stage an agent works on/);
  assert.throws(() => retryStage(project, 'copy', { ...opts }), /needs the operator/);
});

test('work cannot be returned once it is in quality review, or forward', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'QUALITY_REVIEW');
  assert.throws(() => returnToPhase(project, 'CONTENT', opts), /Refused/);
  setPhase(dir, 'CONTENT');
  assert.throws(() => returnToPhase(project, 'BUILD', opts), /Refused/);
});

test('the workflow returns a failed stage, then continues once it is fixed, without asking', async () => {
  const s = spec();
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  for (const f of ['design/section-plan.json', 'design/design-system.json', 'design/motion-plan.json', 'design/asset-plan.json']) writeFileSync(join(dir, f), '{}');
  const ran = [];
  let passesLeft = 1;
  const worker = async ({ task }) => {
    ran.push(task.id);
    const file = { 'design-system': 'design/design-system.json', 'section-plan': 'design/section-plan.json', 'motion-plan': 'design/motion-plan.json', 'asset-plan': 'design/asset-plan.json' }[task.id.replace(/-fix-\d+$/, '')];
    write(dir, file, s[file]);
    return { evidence: [file], costUsd: 0.5 };
  };
  // The verifier fails the section plan on its first pass, as a checker would.
  const verifier = async (command) => {
    if (/check section-plan/.test(command) && passesLeft-- > 0) return { ok: false, code: 1, output: 'vague' };
    return { ok: true, code: 0, output: 'ok' };
  };
  const r = await runDesignWorkflow(project, { ...opts, worker, verifier, stopBefore: 'CONTENT', maxUsd: 100 });
  assert.equal(r.reason, 'reached');
  assert.deepEqual(ran.filter((t) => t === 'section-plan').length, 2, 'the failed stage ran again');
  assert.ok(ran.includes('motion-plan'));
  assert.equal(r.spentUsd, 2.5);
});

test('a blocked stage task stops counting once its fix task is done, and the workflow moves on', async () => {
  const s = spec();
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  write(dir, 'design/section-plan.json', '{}');
  let fails = 2; // Both attempts of the first task fail; the fix task then succeeds.
  const worker = async ({ task }) => {
    const file = { 'design-system': 'design/design-system.json', 'section-plan': 'design/section-plan.json', 'motion-plan': 'design/motion-plan.json', 'asset-plan': 'design/asset-plan.json' }[task.id.replace(/-fix-\d+$/, '')];
    write(dir, file, s[file]);
    return { evidence: [file] };
  };
  const verifier = async (command) => (/check section-plan/.test(command) && fails-- > 0 ? { ok: false, code: 1, output: 'vague' } : { ok: true, code: 0, output: 'ok' });
  const r = await runDesignWorkflow(project, { ...opts, worker, verifier, stopBefore: 'CONTENT' });
  assert.equal(r.reason, 'reached');
  const tasks = listTasks(project, opts);
  assert.equal(tasks.find((t) => t.id === 'section-plan').status, 'blocked');
  assert.equal(tasks.find((t) => t.id === 'section-plan-fix-1').status, 'done');
  assert.ok(!tasks.some((t) => t.id === 'section-plan-fix-2'), 'one return was enough');
});

test('a claim in the copy needs a registered source before anything is built', () => {
  const s = spec();
  const copy = structuredClone(s['content/copy.json']);
  copy.pages[0].sections[0].body = ['Every job carries a 5-year written guarantee on all the work we do for you, in writing and signed.'];
  const { dir } = fullProject({ 'content/copy.json': copy });
  assert.ok(CHECKS.copy(dir).some((p) => /makes a claim/.test(p)));
  write(dir, 'content/claims.json', { claims: [{ text: '5-year written guarantee', source: 'nowhere' }] });
  assert.ok(CHECKS.copy(dir).some((p) => /cites nowhere/.test(p)));
  write(dir, 'content/claims.json', { claims: [{ text: '5-year written guarantee', source: 'brief' }] });
  assert.ok(!CHECKS.copy(dir).some((p) => /claim|cites/.test(p)));
});

test('the spending limit is hard, survives restarts, and counts failed attempts', async () => {
  const { dir } = fullProject();
  const file = join(dir, 'reports', 'spend.json');
  const budgets = [createBudget({ file, limitUsd: 1 }), createBudget({ file: join(dir, 'reports', 'total.json'), limitUsd: 5 })];
  const seen = [];
  const worker = limitedWorker(async (job) => {
    seen.push(job.maxBudgetUsd);
    if (seen.length === 2) throw Object.assign(new Error('failed'), { costUsd: 0.3 });
    return { evidence: ['x'], costUsd: 0.6 };
  }, budgets);
  await worker({});
  await worker({}).catch(() => {});
  assert.deepEqual(seen, [1, 0.4], 'the call may spend only what is left');
  await assert.rejects(worker({}), /spending limit/);
  assert.equal(seen.length, 2, 'no call started');
  assert.equal(createBudget({ file, limitUsd: 1 }).spent(), 0.9, 'a new process sees what was spent');
  assert.equal(budgets[1].spent(), 0.9);
});

test('the workflow stops for the budget instead of sending stages back', async () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  write(dir, 'design/section-plan.json', '{}');
  const r = await runDesignWorkflow(project, { ...opts, worker: async () => ({ evidence: ['x'] }), budgetExhausted: () => true, stopBefore: 'CONTENT' });
  assert.equal(r.reason, 'budget');
  assert.deepEqual(listTasks(project, opts), []);
});

test('release outcomes: only a pass is passed; what needs the operator is blocked, not hidden', () => {
  const facts = { siteUrl: null, forms: true, uncertainPackages: ['gsap'] };
  const gate = (name, status, ...ids) => ({ gate: name, status, findings: ids.map((id) => ({ id, severity: 'serious', message: 'gsap@3.15.0 licence' })) });
  assert.equal(classifyGate(gate('routes', 'pass'), facts).outcome, 'passed');
  assert.equal(classifyGate(gate('claims', 'fail', 'unsourced-claim'), facts).outcome, 'failed');
  assert.equal(classifyGate(gate('seo', 'fail', 'canonical-missing'), facts).outcome, 'blocked');
  assert.equal(classifyGate(gate('seo', 'fail', 'canonical-missing', 'title-missing'), facts).outcome, 'failed', 'a real SEO fault is not excused');
  assert.equal(classifyGate(gate('seo', 'fail', 'canonical-missing'), { ...facts, siteUrl: 'https://x.example' }).outcome, 'failed');
  assert.equal(classifyGate(gate('dependencies', 'fail', 'licence-not-allowed'), facts).outcome, 'blocked');
  assert.equal(classifyGate(gate('dependencies', 'fail', 'licence-not-allowed'), { ...facts, uncertainPackages: [] }).outcome, 'failed');
  assert.equal(classifyGate(gate('forms', 'pass'), { ...facts, forms: false }).outcome, 'not-applicable');
  assert.equal(classifyGate({ gate: 'performance', status: 'error', findings: [], error: { code: 'UNAVAILABLE' } }, facts).outcome, 'blocked');
});

test('the spend limit stops the workflow', async () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  for (const f of ['design/section-plan.json', 'design/design-system.json']) writeFileSync(join(dir, f), '{}');
  const worker = async () => ({ evidence: ['x'], costUsd: 1 });
  const verifier = async () => ({ ok: false, code: 1, output: 'no' });
  const r = await runDesignWorkflow(project, { ...opts, worker, verifier, maxUsd: 1, stopBefore: 'CONTENT' }).catch((e) => e);
  assert.ok(r.reason || /spend limit/.test(r.message));
});

test('phases still advance in order once the design evidence is there', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  assert.deepEqual(advanceProject(project, opts), { from: 'UX_DESIGN_SYSTEM', to: 'CONTENT' });
  assert.ok(PHASES.some((p) => p.name === 'CONTENT'));
});

const BUSINESS = {
  industryId: 'real-estate',
  primaryConversion: { id: 'book-visit', label: 'Book a site visit', kind: 'book' },
  secondaryConversions: [{ id: 'brochure', label: 'Download brochure', kind: 'download', hero: true }],
  heroMustHave: ['The primary action "Book a site visit" as the first and most prominent button'],
  requiredSections: { '/': ['hero with the project headline and the primary action', 'buyer testimonials'] },
  compliance: ['Never promise returns the client has not given as facts with a source'],
};

test('the home hero must carry the business\'s primary action, in the plan and in the copy', () => {
  const s = spec();
  // The good specification never mentions the action, so both checks name it.
  const none = fullProject({ 'intake/brief.json': { ...BRIEF, business: BUSINESS } });
  const planProblems = CHECKS['section-plan'](none.dir);
  assert.ok(planProblems.some((p) => /home hero must carry the primary action "Book a site visit"/.test(p)));
  assert.ok(planProblems.some((p) => /also carry "Download brochure"/.test(p)));
  assert.ok(CHECKS.copy(none.dir).some((p) => /home hero \(promise\) must offer the primary action "Book a site visit"/.test(p)));

  // A brief with no business section is not held to any of this.
  const plain = fullProject();
  assert.ok(!CHECKS['section-plan'](plain.dir).some((p) => /primary action/.test(p)));
  assert.ok(!CHECKS.copy(plain.dir).some((p) => /primary action/.test(p)));

  // Name the action in the first section and in the hero copy, and both checks pass.
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections[0].hierarchy = 'The "Book a site visit" button first with "Download brochure" beside it, then the photograph';
  const copy = structuredClone(s['content/copy.json']);
  copy.pages[0].sections[0].body[0] += ' Book a site visit with Harbor Home today.';
  const ok = fullProject({ 'intake/brief.json': { ...BRIEF, business: BUSINESS }, 'design/section-plan.json': plan, 'content/copy.json': copy });
  assert.ok(!CHECKS['section-plan'](ok.dir).some((p) => /primary action|also carry/.test(p)));
  assert.ok(!CHECKS.copy(ok.dir).some((p) => /primary action/.test(p)));
});

test('the stages that decide the look and the words are told what the business exists to do', () => {
  const brief = { ...BRIEF, business: BUSINESS };
  const plan = businessAcceptance(brief, 'section-plan').join(' | ');
  assert.match(plan, /exists to make one thing happen: "Book a site visit"/);
  assert.match(plan, /first section of the home page is the hero/);
  assert.match(plan, /hero with the project headline/);
  assert.match(businessAcceptance(brief, 'copy').join(' | '), /call to action label is exactly "Book a site visit"/);
  assert.match(businessAcceptance(brief, 'copy').join(' | '), /\(not provided by the client\)/);
  assert.match(businessAcceptance(brief, 'copy').join(' | '), /Never promise returns/);
  assert.match(businessAcceptance(brief, 'review').join(' | '), /blocking finding against the section plan/);
  assert.match(businessAcceptance(brief, 'research').join(' | '), /real-estate business/);
  assert.deepEqual(businessAcceptance(BRIEF, 'copy'), []);
  // The contract the agent receives carries them.
  assert.ok(specTask('demo', 'section-plan', brief).acceptance.some((a) => /Book a site visit/.test(a)));
  assert.ok(!specTask('demo', 'section-plan', BRIEF).acceptance.some((a) => /Book a site visit/.test(a)));
});

test('craft: a short, flat, centred site is refused before anything is built', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections = plan.pages[0].sections.slice(0, 3);
  for (const x of plan.pages[0].sections) x.composition = 'A centred headline over a photograph with two buttons under it, all sitting level in one tidy column';
  const motion = structuredClone(s['design/motion-plan.json']);
  motion.motions = motion.motions.slice(0, 3).map((m) => ({ ...m, kind: 'hover' }));
  const { dir } = fullProject({ 'design/section-plan.json': plan, 'design/motion-plan.json': motion });
  const plans = CHECKS['section-plan'](dir).join('\n');
  assert.match(plans, /the home page has 3 sections/);
  assert.match(plans, /home hero is a centred layout/);
  const motions = CHECKS['motion-plan'](dir).join('\n');
  assert.match(motions, /3 motions; define at least 5/);
  assert.match(motions, /at least three kinds/);
  assert.match(motions, /scroll-linked/);
});

test('craft: sections that never break the grid are refused when the plan is long enough to need it', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  const more = plan.pages[0].sections;
  while (more.length < 7) more.push({ ...structuredClone(more[0]), id: `extra-${more.length}`, pattern: more.length % 2 ? 'statement' : 'stats-band' });
  for (const x of more) x.composition = 'Heading on the left across six columns with a paragraph on the right across five columns, level and evenly spaced';
  const { dir } = fullProject({ 'design/section-plan.json': plan });
  assert.match(CHECKS['section-plan'](dir).join('\n'), /only 0 of 7 sections break the grid/);
});

test('craft: legal pages are as long as their text needs, and their plain sections do not count against the grid', () => {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  const home = plan.pages[0].sections;
  while (home.length < 7) home.push({ ...structuredClone(home[0]), id: `extra-${home.length}`, pattern: home.length % 2 ? 'statement' : 'stats-band' });
  // Exactly a third of the designed sections break the grid.
  const designed = plan.pages.flatMap((p) => p.sections);
  const third = Math.ceil(designed.length / 3);
  designed.forEach((x, i) => { x.composition = i < third ? 'Oversized photograph bleeding off the right edge across seven columns, the headline overlapping it' : 'Heading on the left across six columns with a paragraph on the right across five columns, level and evenly spaced'; });
  const text = 'Plain text in one readable column of eight columns, left aligned, with headings set in the body face and a rule between parts';
  const page = (slug, n, funnel) => ({
    slug,
    sections: Array.from({ length: n }, (_, i) => ({ ...structuredClone(home[6]), id: `${slug.slice(1)}-text-${i}`, funnel, composition: text })),
  });
  const brief = (...slugs) => ({ ...BRIEF, pages: [...BRIEF.pages, ...slugs.map((slug) => ({ slug, title: slug.slice(1), purpose: 'Legal and practical text', cta: 'Get in touch' }))] });
  plan.pages.push(page('/privacy', 2, 'none'), page('/terms', 2, 'none'));
  assert.ok(Math.ceil((designed.length + 4) / 3) > third, 'counting the legal sections would fail the grid rule');
  const { dir } = fullProject({ 'design/section-plan.json': plan, 'intake/brief.json': brief('/privacy', '/terms') });
  const problems = CHECKS['section-plan'](dir).join('\n');
  assert.doesNotMatch(problems, /must NOT have|must have|not a page in the brief/, 'the plan is valid, so the checks below ran');
  assert.doesNotMatch(problems, /\/privacy has 2 sections|\/terms has 2 sections/);
  assert.doesNotMatch(problems, /break the grid/, 'the four legal sections are left out of the count');
  // A short page that is not legal text still needs its sections.
  plan.pages.push(page('/services', 2, 'action'));
  const { dir: d2 } = fullProject({ 'design/section-plan.json': plan, 'intake/brief.json': brief('/privacy', '/terms', '/services') });
  assert.match(CHECKS['section-plan'](d2).join('\n'), /\/services has 2 sections; an inner page needs at least \d/);
});

test('craft: the guide is copied into the project and every design stage reads it', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  planPhase(project, opts);
  assert.ok(existsSync(join(dir, 'design', 'reference', 'craft', 'awwwards.md')));
  for (const stage of ['direction', 'design-system', 'section-plan', 'motion-plan', 'copy']) {
    const t = specTask(project, stage, BRIEF);
    assert.ok(t.inputs.includes('design/reference/craft/**'), `${stage} reads the craft guide`);
    assert.match(t.acceptance.join(' '), /awwwards\.md/, `${stage} is told to follow it`);
  }
});

test('media: the chosen 3D object and video must be placed where the media step said, and listed in the asset plan', () => {
  const media = {
    threeD: { decision: 'chosen', id: 'tea_set_01', title: 'Tea Set 01', creator: 'Other', licence: 'CC0', file: 'models/tea_set_01.glb', concept: 'a teapot', position: 'below the hero' },
    video: { decision: 'chosen', id: 'loop1', role: 'hero-loop', page: '/', section: 'hero', mp4: 'video/loop1.mp4', webm: 'video/loop1.webm', poster: 'video/loop1-poster.webp', source: 'Supplied by the client', licence: 'Supplied by the client' },
  };
  // Nothing placed: both are refused.
  let { dir } = fullProject({ 'intake/brief.json': { ...BRIEF, media } });
  let plans = CHECKS['section-plan'](dir).join('\n');
  assert.match(plans, /one section must list the asset "model-tea-set-01"/);
  assert.match(plans, /one section must list the asset "video-loop1"/);
  assert.match(CHECKS['asset-plan'](dir).join('\n'), /needs the asset "model-tea-set-01"/);

  // The 3D object in the hero is refused; a hero loop outside the hero is refused.
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  plan.pages[0].sections[0].assets = ['kitchen', 'model-tea-set-01'];
  plan.pages[0].sections[1].assets = ['kitchen', 'video-loop1'];
  ({ dir } = fullProject({ 'intake/brief.json': { ...BRIEF, media }, 'design/section-plan.json': plan }));
  plans = CHECKS['section-plan'](dir).join('\n');
  assert.match(plans, /3D object "model-tea-set-01" is in the home hero/);
  assert.match(plans, /hero loop and belongs in the first section/);

  // Placed correctly: the media problems go away.
  plan.pages[0].sections[0].assets = ['kitchen', 'video-loop1'];
  plan.pages[0].sections[1].assets = ['kitchen', 'model-tea-set-01'];
  ({ dir } = fullProject({ 'intake/brief.json': { ...BRIEF, media }, 'design/section-plan.json': plan }));
  plans = CHECKS['section-plan'](dir).join('\n');
  assert.doesNotMatch(plans, /must list the asset|is in the home hero|belongs in the first section/);
});

// Two pages: the home page, and /about with two sections of its own.
function twoPages() {
  const s = spec();
  const plan = structuredClone(s['design/section-plan.json']);
  const home = plan.pages[0];
  plan.pages.push({ slug: '/about', sections: [
    { ...structuredClone(home.sections[1]), id: 'story', pattern: 'editorial-split', funnel: 'awareness' },
    { ...structuredClone(home.sections[2]), id: 'method', pattern: 'asymmetric', funnel: 'interest' },
    { ...structuredClone(home.sections[4]), id: 'visit', funnel: 'action' },
  ] });
  const copy = structuredClone(s['content/copy.json']);
  const homeCopy = copy.pages[0];
  copy.pages.push({
    ...structuredClone(homeCopy), slug: '/about', title: 'About', description: 'Who Harbor Home is, and the old Portland houses the firm has fitted.',
    sections: [
      { ...structuredClone(homeCopy.sections[1]), id: 'story', headline: 'A ship carpenter who came ashore in Portland' },
      { ...structuredClone(homeCopy.sections[2]), id: 'method', headline: 'Every beam fitted to what is really there' },
      { ...structuredClone(homeCopy.sections[4]), id: 'visit', headline: 'Walk us round the house that worries you' },
    ],
  });
  copy.nav.push({ label: 'About', href: '/about' });
  const brief = { ...BRIEF, pages: [...BRIEF.pages, { slug: '/about', title: 'About', purpose: 'Earn trust', cta: 'Book a visit' }] };
  const p = fullProject({ 'design/section-plan.json': plan, 'content/copy.json': copy });
  write(p.dir, 'intake/brief.json', brief);
  return p;
}

test('the build is planned as a shared foundation, then one task per page with its own files', () => {
  const { project, opts, dir } = twoPages();
  assert.deepEqual(readiness(dir).stages.flatMap((s) => s.problems), [], 'the two-page fixture is a complete specification');
  write(dir, 'site/package.json', '{}');
  write(dir, 'site/src/site.json', { forms: { visit: { purpose: 'Book a home visit', destination: 'none-yet', action: null, page: '/about', fields: [] } } });
  setPhase(dir, 'BUILD');
  const tasks = planPhase(project, opts);
  assert.deepEqual(tasks.map((t) => t.id), ['build-foundation', 'build-page-home', 'build-page-about']);
  const [foundation, home, about] = tasks;
  for (const t of [home, about]) assert.deepEqual(t.depends_on, ['build-foundation']);
  const file = (id) => `site/src/sections/${sectionUse('APP-01', id)}.astro`;
  assert.deepEqual(home.owns_files, ['promise', 'quote-rule', 'old-houses', 'process', 'proof'].map(file));
  assert.deepEqual(about.owns_files, ['story', 'method', 'visit'].map(file));
  assert.ok(foundation.owns_files.includes('site/public/**') && foundation.owns_files.includes('site/package.json'));
  for (const t of [home, about]) {
    assert.ok(!t.owns_files.some((f) => foundation.owns_files.some((g) => f.startsWith(g.replace('**', '')))), 'no page owns a shared file');
    assert.ok(t.must_not_touch.includes('site/src/styles/**') && t.must_not_touch.includes('site/public/**'));
  }
  assert.match(home.verify, /site-build --page ['"]?\/['"]?$/);
  assert.match(about.verify, /site-build --page ['"]?\/about['"]?$/);
  // site.json's page for a form is only a guess; the section plan decides, so every page is told.
  for (const t of [home, about]) {
    const form = t.acceptance.find((a) => a.startsWith('Forms: '));
    assert.ok(form, `${t.id} is told how to build a form`);
    assert.ok(form.includes('"visit"') && form.includes(`"${formAction('visit')}"`) && /never invent another address/.test(form) && /Never show success without sending/.test(form));
  }
  assert.equal(formAction('visit'), actionFor('visit'), "the address is the form plugin's own endpoint");
  for (const id of ['promise', 'quote-rule', 'old-houses', 'process', 'proof', 'story', 'method', 'visit']) {
    assert.match(readFileSync(join(dir, file(id)), 'utf8'), new RegExp(`${STUB_MARK}="${id}"`), `${id} has a placeholder, so the site builds`);
  }
  assert.equal(stubsLeft(dir).length, 8);
});

test('placeholders never overwrite a built section, and the build phase cannot end with one left', () => {
  const { project, opts, dir } = fullProject();
  const built = `site/src/sections/${sectionUse('APP-01', 'promise')}.astro`;
  write(dir, built, '<section class="promise">Built</section>\n');
  writeStubs(dir, 'APP-01', spec()['design/section-plan.json']);
  assert.equal(readFileSync(join(dir, built), 'utf8'), '<section class="promise">Built</section>\n');
  assert.equal(stubsLeft(dir).length, 4);
  setPhase(dir, 'BUILD');
  write(dir, 'site/dist/index.html', '<html></html>');
  assert.ok(exitBlockers(project, opts).some((b) => /4 still a placeholder/.test(b)));
  for (const f of stubsLeft(dir)) write(dir, f, '<section>Built</section>\n');
  assert.ok(!exitBlockers(project, opts).some((b) => /placeholder/.test(b)));
});

test('an integration failure goes back only to the task that can fix it, with only its findings', () => {
  const ids = ['build-foundation', 'build-page-home', 'build-page-about', 'build-page-about-fix-1', 'build-page-services'];
  const about = '- routes.missing [/about]: no page';
  assert.deepEqual(buildTargets(ids, [about]), [{ id: 'build-page-about-fix-1', findings: [about] }], 'the page named, at its latest attempt');
  const home = '- parity.text [/ @ 375px]: text differs';
  const form = '- form-unusable [/services (contact)]: the submit button could not be clicked';
  assert.deepEqual(buildTargets(ids, [home, form]), [{ id: 'build-page-home', findings: [home] }, { id: 'build-page-services', findings: [form] }]);
  const shared = '- forms.endpoint: no endpoint';
  assert.deepEqual(buildTargets(ids, [shared, about]), [{ id: 'build-foundation', findings: [shared] }, { id: 'build-page-about-fix-1', findings: [about] }], 'a finding with no page goes to the foundation, not to every page');
  assert.deepEqual(buildTargets(ids, ['- x [/gone]: y']), [{ id: 'build-foundation', findings: ['- x [/gone]: y'] }], 'a route with no page task is shared work too');
  assert.deepEqual(buildTargets(ids, []), [], 'a gate that could not run sends nothing back: the operator decides');
  assert.deepEqual(buildTargets(['build-foundation', 'build-sections', 'build-sections-fix-1'], ['- x [/]: y']), [{ id: 'build-sections-fix-1', findings: ['- x [/]: y'] }], 'a project planned before per-page builds');
  assert.equal(pageTaskId('/'), 'build-page-home');
  assert.equal(pageTaskId('/Our Work/'), 'build-page-our-work');
});

test('calls running at the same time share what is left, so together they never pass the limit', async () => {
  const { dir } = fullProject();
  const budgets = [createBudget({ file: join(dir, 'reports', 'spend.json'), limitUsd: 2 })];
  const given = [];
  const release = [];
  const worker = limitedWorker((job) => new Promise((resolve) => {
    given.push(job.maxBudgetUsd);
    release.push(() => resolve({ evidence: ['x'], costUsd: 0.8 }));
  }), budgets, { parallel: 2 });
  const a = worker({});
  const b = worker({});
  assert.deepEqual(given, [1, 1], 'each running call holds its share');
  await assert.rejects(worker({}), /spending limit/, 'nothing is left that no running call holds');
  assert.equal(given.length, 2, 'the refused call never started');
  release.splice(0).forEach((r) => r());
  await Promise.all([a, b]);
  assert.equal(budgets[0].spent(), 1.6);
  const c = worker({});
  assert.equal(given.at(-1), 0.25, 'half of $0.40 is too small to use, so one call gets the smallest useful amount');
  await assert.rejects(worker({}), /spending limit/, 'and a second call at the same time is refused');
  release.splice(0).forEach((r) => r());
  await c;
});

test('one build of the site at a time: a second waits, and a lock left by a crash is taken over', async () => {
  const { dir } = fullProject();
  const events = [];
  const job = (name) => withSiteLock(dir, async () => {
    events.push(`${name} start`);
    await new Promise((r) => setTimeout(r, 30));
    events.push(`${name} end`);
    return name;
  }, { pollMs: 5 });
  assert.deepEqual(await Promise.all([job('a'), job('b')]), ['a', 'b']);
  assert.deepEqual(events, ['a start', 'a end', 'b start', 'b end']);
  mkdirSync(join(dir, 'locks', 'site-build'), { recursive: true });
  const later = Date.now() + 16 * 60 * 1000;
  assert.equal(await withSiteLock(dir, async () => 'ran', { pollMs: 5, now: () => later }), 'ran');
  assert.equal(existsSync(join(dir, 'locks', 'site-build')), false, 'the lock is released');
  await assert.rejects(withSiteLock(dir, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(join(dir, 'locks', 'site-build')), false, 'and released when the build fails');
});

test('the copy check refuses copy that breaks the brief content rules', () => {
  const { dir } = fullProject();
  const rules = (contentRules) => write(dir, 'intake/brief.json', { ...BRIEF, contentRules });
  rules([{ rule: 'never', text: 'ITEMISED  quote', pages: ['/'] }]);
  const copyText = JSON.stringify(spec()['content/copy.json']).toLowerCase();
  assert.ok(copyText.includes('itemised'), 'the fixture copy says "itemised quote"');
  assert.ok(CHECKS.copy(dir).some((p) => /"ITEMISED {2}quote" must never appear on this page/.test(p)), 'case and spacing do not hide it');
  rules([{ rule: 'always', text: 'Licence 12345', pages: ['*'] }]);
  assert.ok(CHECKS.copy(dir).some((p) => /\/: "Licence 12345" must appear on this page/.test(p)));
  rules([{ rule: 'always', text: 'Licensed and insured in Maine', pages: ['*'] }]);
  assert.ok(!CHECKS.copy(dir).some((p) => /content rule/.test(p)), 'a line in the footer is on every page');
  rules([{ rule: 'never', text: 'Smith', pages: ['/gone'] }]);
  assert.ok(CHECKS.copy(dir).some((p) => /names \/gone, which has no copy/.test(p)));
  rules([]);
  assert.deepEqual(contentRuleProblems(spec()['content/copy.json'], []), []);
});

test('the contracts use the pre-build answers: truths, jobs, arrival and mood, content rules', () => {
  const brief = {
    ...BRIEF,
    audience: [{ ...BRIEF.audience[0], arrivesFrom: ['Instagram'], mood: 'wary' }],
    truths: [{ text: 'Fitted three hundred crooked Portland kitchens' }],
    jobs: ['Book a visit', 'Call'],
    contentRules: [{ rule: 'always', text: 'Licensed and insured in Maine', pages: ['*'] }, { rule: 'never', text: 'Casco', pages: ['*'] }],
  };
  const lines = (stage, b = brief) => specTask('demo', stage, b).acceptance;
  assert.ok(lines('research').some((a) => /"Fitted three hundred crooked Portland kitchens"/.test(a) && /only 1 of the three to six/.test(a) && /questions for the client/.test(a)));
  assert.ok(lines('direction').some((a) => /The concept rests on one of the facts only this business can claim/.test(a)));
  assert.ok(lines('section-plan').some((a) => /these jobs in one tap: "Book a visit", "Call"/.test(a)));
  assert.ok(lines('section-plan').some((a) => /arrives from or its mood/.test(a)));
  assert.ok(lines('copy').some((a) => /content rules\. Always on every page: "Licensed and insured in Maine"\. Never on any page: "Casco"/.test(a)));
  // Without the new fields, only the research line about missing truths is added.
  assert.ok(lines('research', BRIEF).some((a) => /gives none of the three to six/.test(a)));
  for (const stage of ['direction', 'section-plan', 'copy']) assert.ok(!lines(stage, BRIEF).some((a) => /one tap|arrives from|content rules|rests on one of the facts/.test(a)), stage);
});

test('the operator can give a build task out of retries one more attempt, with its own findings', () => {
  const { project, opts, dir } = fullProject();
  for (const id of ['build-foundation', 'build-page-home', 'build-page-contact', 'build-page-contact-fix-1', 'build-page-contact-fix-2']) {
    addTasks(project, opts, task(id));
    saveTask(project, { ...listTasks(project, opts).find((t) => t.id === id), status: 'done', evidence: ['evidence/x.log'] }, opts);
  }
  write(dir, 'evidence/gates/forms.json', { gate: 'forms', status: 'fail', findings: [
    { id: 'not-sent', severity: 'critical', message: '/contact (contact) showed success without sending anything', location: '/contact (contact)' },
    { id: 'x', severity: 'serious', message: 'on home', location: '/' },
  ] });
  setPhase(dir, 'INTEGRATION_TESTS');
  assert.throws(() => retryBuildTask(project, 'build-page-contact', { ...opts }), /reason as its note/);
  assert.throws(() => retryBuildTask(project, 'build-page-nowhere', { note: 'n', ...opts }), /no build task build-page-nowhere/);
  const { task: id } = retryBuildTask(project, 'build-page-contact', { note: 'Post to the form endpoint and show the real result', ...opts });
  assert.equal(id, 'build-page-contact-fix-3', 'past the usual limit of 2');
  const fix = listTasks(project, opts).find((t) => t.id === id);
  assert.equal(fix.status, 'pending');
  assert.ok(fix.acceptance.includes('Fix: operator: Post to the form endpoint and show the real result'));
  assert.ok(fix.acceptance.some((a) => /not-sent \[\/contact \(contact\)\]/.test(a)), 'the findings for this page');
  assert.ok(!fix.acceptance.some((a) => /on home/.test(a)), 'and not another page\'s');
  assert.equal(loadProject(project, opts).phase, 'BUILD', 'back to the build to do it');
  assert.ok(ledger.read(project, opts).some((e) => e.actor === 'operator' && e.data?.event === 'build_retry_authorized' && e.data.task === 'build-page-contact'));
  assert.throws(() => retryBuildTask(project, 'build-page-contact', { note: 'again', ...opts }), /is pending/, 'not while an attempt is waiting');
});

test('the licence register is written alongside the copy, so the asset phase has nothing to wait for', () => {
  const { project, opts, dir } = fullProject();
  assert.ok(agentsForPhase('CONTENT').includes('asset-rights'));
  setPhase(dir, 'CONTENT');
  const planned = planPhase(project, opts);
  const register = planned.find((t) => t.id === 'asset-register');
  assert.ok(register && planned.some((t) => t.agent === 'content-ux'), 'both tasks are planned in the copy phase');
  assert.ok(!register.inputs.includes('content/copy.json'), 'the register does not wait for the copy');
  assert.deepEqual(register.depends_on, []);
  assert.ok(!register.owns_files.some((f) => planned.find((t) => t.agent === 'content-ux').owns_files.includes(f)), 'no shared files, so they run at the same time');
  setPhase(dir, 'ASSETS_LICENSING');
  assert.deepEqual(planPhase(project, opts), [], 'nothing new to do after B3');
});

// Workflow 2, Stage 1: the Truth Doc. A project planned before it keeps the old research rules.
const TRUTH = {
  onliness: { statement: 'The only renovation firm in Portland run by a ship carpenter', source: 'brief' },
  boundaries: {
    whatItIs: [{ text: 'Renovation of old houses in Portland, to a fixed itemised quote', source: 'brief' }],
    whatItIsNot: [{ text: 'Not a new-build contractor, and no work outside Portland', source: 'assumption' }],
  },
  personas: [{ segment: 'Homeowners', wants: ['A kitchen that fits a crooked room'], needs: ['A fair, fixed price'], desiredAction: 'Book a home visit', source: 'brief' }],
};
const BUYER_QUESTIONS = [
  { question: 'How much does a kitchen renovation cost in an old house?', category: 'pricing', gap: 'What is the usual price range for a kitchen?' },
  { question: 'What goes wrong when a house is not square?', category: 'problems', source: 'brief' },
  { question: 'Is a fixed quote better than time and materials?', category: 'comparisons', source: 'assumption' },
  { question: 'What do past clients say?', category: 'reviews', gap: 'Which past clients would share a review?' },
  { question: 'What are the best renovation firms for old Portland houses?', category: 'best', gap: 'Which local awards or listings name the firm?' },
  { question: 'Can you work around a listed facade?', category: 'edge', gap: 'Has the firm worked on listed buildings?' },
];
function truthProject(extra = {}) {
  const s = spec();
  const competitors = s['research/positioning.json'].competitors.map((c) => ({ ...c, learn: 'How it shows prices', avoid: 'Stock dream-home photos' }));
  const positioning = { ...s['research/positioning.json'], competitors, ...TRUTH, ...(extra.positioning ?? {}) };
  const crux = { ...s['research/crux.json'], buyerQuestions: extra.buyerQuestions ?? BUYER_QUESTIONS };
  return fullProject({ 'research/positioning.json': positioning, 'research/crux.json': crux, 'design/reference/workflow.json': { version: 2 } });
}

test('the crux schema keeps the five buckets and needs a source or a gap for every buyer question', () => {
  const crux = spec()['research/crux.json'];
  assert.deepEqual(check('crux', crux).errors, [], 'an older crux without buyer questions is still valid');
  assert.deepEqual(check('crux', { ...crux, buyerQuestions: BUYER_QUESTIONS }).errors, []);
  assert.ok(!check('crux', { ...crux, buyerQuestions: [{ question: 'How much does it cost?', category: 'pricing' }] }).valid, 'neither a source nor a gap');
  assert.ok(!check('crux', { ...crux, buyerQuestions: [{ question: 'How much does it cost?', category: 'price', source: 'brief' }] }).valid, 'not a Big 5 category');
  const { about: _about, ...four } = crux.buckets;
  assert.ok(!check('crux', { buckets: four }).valid, 'all five buckets are required');
  assert.deepEqual(check('positioning', { ...spec()['research/positioning.json'], ...TRUTH }).errors, []);
  assert.ok(!check('positioning', { ...spec()['research/positioning.json'], onliness: { statement: 'Only us' } }).valid, 'an onliness statement needs its source');
});

test('a project planned before workflow 2 keeps the old research rules', () => {
  const { dir } = fullProject();
  assert.ok(!existsSync(join(dir, 'design/reference/workflow.json')));
  assert.deepEqual(CHECKS.research(dir), []);
});

test('workflow 2 research needs the Truth Doc: onliness, what it is and is not, personas, Big 5 buyer questions', () => {
  const { dir } = fullProject({ 'design/reference/workflow.json': { version: 2 } });
  const problems = CHECKS.research(dir).join('\n');
  assert.match(problems, /give the onliness statement/);
  assert.match(problems, /say what the product or service is/);
  assert.match(problems, /say what it is not/);
  assert.match(problems, /no persona for "Homeowners"/);
  assert.match(problems, /say what to learn from Casco Build, or what to avoid/);
  for (const label of ['pricing and costs', 'problems and risks', 'comparisons', 'reviews', 'best-in-class guides']) assert.match(problems, new RegExp(`no buyer question about ${label}`));

  assert.deepEqual(CHECKS.research(truthProject().dir), [], 'a complete Truth Doc passes');
  // An onliness the client has not given is a gap, not an invention.
  assert.deepEqual(CHECKS.research(truthProject({ positioning: { onliness: { gap: 'What can only Harbor Home claim?' } } }).dir), []);
  const bad = truthProject({
    positioning: { personas: [{ ...TRUTH.personas[0], source: 'website' }] },
    buyerQuestions: [...BUYER_QUESTIONS.slice(1), { question: 'What does it cost per square foot?', category: 'pricing', source: 'price-list' }],
  });
  const b = CHECKS.research(bad.dir).join('\n');
  assert.match(b, /the persona "Homeowners" cites website, which is not in research\/sources.json/);
  assert.match(b, /the question "What does it cost per square foot\?" cites price-list/);
});

test('planning research starts workflow 2: the marker, the crux schema for the agent, and the Truth Doc contract', () => {
  const { project, opts, dir } = fullProject();
  for (const f of ['research/positioning.json', 'research/crux.json']) rmSync(join(dir, f));
  setPhase(dir, 'RESEARCH');
  const added = planPhase(project, opts);
  assert.deepEqual(added.map((t) => t.id), ['research']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'design/reference/workflow.json'), 'utf8')).version, 2);
  assert.ok(existsSync(join(dir, 'design/reference/crux.schema.json')));
  const t = added[0];
  assert.ok(t.inputs.includes('design/reference/crux.schema.json'));
  const acceptance = t.acceptance.join('\n');
  for (const word of ['"onliness"', '"boundaries"', '"whatItIsNot"', '"personas"', '"desiredAction"', '"buyerQuestions"', 'Big 5', '"learn"', '"avoid"', 'research/screenshots/']) assert.ok(acceptance.includes(word), word);
  // A project past research is never moved to workflow 2.
  const later = fullProject();
  setPhase(later.dir, 'UX_DESIGN_SYSTEM');
  planPhase(later.project, later.opts);
  assert.ok(!existsSync(join(later.dir, 'design/reference/workflow.json')));
});

test('research ends only when the operator confirms the Truth Doc, and a changed fact needs a new confirmation', async () => {
  const { factsBlockers, confirmFacts, writeTruthDoc } = await import('../../src/design/truth.mjs');
  const { project, opts, dir } = truthProject();
  setPhase(dir, 'RESEARCH');
  const { file } = writeTruthDoc(dir);
  const doc = readFileSync(join(dir, file), 'utf8');
  assert.match(doc, /## What only this business can claim\n\nThe only renovation firm in Portland run by a ship carpenter \[brief\]/);
  assert.match(doc, /\*\*Is not:\*\* Not a new-build contractor, and no work outside Portland \*\(assumption: confirm with the client\)\*/);
  assert.match(doc, /### Homeowners \[brief\][\s\S]*The one action: Book a home visit/);
  assert.match(doc, /### Our Work\n\n- \*\*Ask the client:\*\* Which finished jobs can we show/);
  assert.match(doc, /### Pricing and costs\n\n- How much does a kitchen renovation cost in an old house\? \*\*Ask the client:\*\* What is the usual price range/);
  assert.match(doc, /Casco Build[^\n]*Learn: How it shows prices Avoid: Stock dream-home photos/);

  assert.match(exitBlockers(project, opts).join('\n'), /facts confirmation: read research\/truth-doc.md, then run forge facts demo confirm/);
  assert.throws(() => confirmFacts(project, opts), /needs your note/);
  const entry = confirmFacts(project, { note: 'Checked every fact against the client email of 10 Nov', ...opts });
  assert.equal(entry.actor, 'operator');
  assert.equal(entry.data.event, 'facts_confirmed');
  assert.deepEqual(check('ledgerEntry', entry).errors, []);
  assert.deepEqual(factsBlockers(project, dir, opts), []);
  assert.ok(!exitBlockers(project, opts).some((b) => b.startsWith('facts confirmation')));

  // A fact changes after the confirmation: the operator must look again.
  const p = JSON.parse(readFileSync(join(dir, 'research/positioning.json'), 'utf8'));
  p.onliness.statement = 'The only renovation firm in Maine with its own slipway';
  write(dir, 'research/positioning.json', p);
  assert.equal(factsBlockers(project, dir, opts).length, 1);
});

test('research that is not finished cannot be confirmed, and an older project never waits for a confirmation', async () => {
  const { factsBlockers, confirmFacts } = await import('../../src/design/truth.mjs');
  const v2 = fullProject({ 'design/reference/workflow.json': { version: 2 } });
  assert.throws(() => confirmFacts(v2.project, { note: 'Looked', ...v2.opts }), /Research is not finished/);
  assert.deepEqual(factsBlockers(v2.project, v2.dir, v2.opts), [], 'unfinished research reports its own problems, not a confirmation');
  const v1 = fullProject();
  setPhase(v1.dir, 'RESEARCH');
  assert.deepEqual(factsBlockers(v1.project, v1.dir, v1.opts), []);
  assert.ok(!exitBlockers(v1.project, v1.opts).some((b) => b.startsWith('facts confirmation')));
});

test('forge go treats the facts confirmation as a decision for the operator', async () => {
  const { classifyBlockers } = await import('../../src/cli/go.mjs');
  const blocker = 'facts confirmation: read research/truth-doc.md, then run forge facts demo confirm --note "<what you checked>"';
  const { decisions, other } = classifyBlockers([blocker]);
  assert.deepEqual(decisions, [{ kind: 'facts', detail: blocker }]);
  assert.deepEqual(other, []);
});

test('forge facts writes the Truth Doc, then records the confirmation with the operator note', async () => {
  const { cmdFacts } = await import('../../src/cli/facts.mjs');
  const { project, dir } = truthProject();
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: dirname(dir) }));
  const out = [];
  const { log, error } = console;
  console.log = (s) => out.push(String(s));
  console.error = (s) => out.push(String(s));
  try {
    assert.equal(cmdFacts(root, []), 2, 'no project: usage');
    assert.equal(cmdFacts(root, [project]), 0);
    assert.ok(existsSync(join(dir, 'research/truth-doc.md')));
    assert.match(out.join('\n'), /Then: forge facts demo confirm --note/);
    assert.equal(cmdFacts(root, [project, 'confirm', '--note', 'Checked against the client email']), 0);
    assert.match(out.at(-1), /Recorded the facts confirmation for demo/);
    assert.equal(cmdFacts(root, [project]), 0);
    assert.match(out.at(-1), /The facts are confirmed for this version of the Truth Doc/);
  } finally {
    console.log = log;
    console.error = error;
  }
  const unfinished = fullProject({ 'design/reference/workflow.json': { version: 2 } });
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: dirname(unfinished.dir) }));
  console.log = () => {};
  try {
    assert.equal(cmdFacts(root, [unfinished.project]), 1, 'research with problems: nothing to confirm');
  } finally {
    console.log = log;
  }
});

// Workflow 2, Stage 1.5 and Step 3: the identity is locked at B2, and every page is planned as the
// six-step hierarchy with each section's crux bucket and media named.
const IDENTITY = {
  logo: 'A temporary wordmark set in the display face, hung from the ruled margin at the top left',
  navigation: 'A ruled bar that reads like a carpenter rule, with the page names marked as measurements along it',
  buttons: 'Square-cornered tabs with a heavy underline rule; pressing one drops the rule two pixels, focus draws the full outline',
  signature: 'A measured rule runs down every page margin, with section numbers marked like inches',
};
const COMPONENTS = {
  navigation: { style: 'A ruled bar with page names marked along it like measurements', desktop: 'Full width under the wordmark', mobile: 'A bottom bar with the three main jobs', scroll: 'Stays put and thins to the rule alone' },
  buttons: { shape: 'Square tabs sitting on a heavy underline rule', primary: 'Ink tab on paper', secondary: 'Rule only, no fill', states: { hover: 'The rule thickens', active: 'The tab drops two pixels', focus: 'A full outline in the accent colour' } },
};
const FAQ_ITEMS = [
  ['Will the quote change once the walls are open?', 'No. The itemised quote changes only if you change the plan, and anything found behind a wall is priced and agreed with you in writing before work on it starts.'],
  ['Can you work with what is already in the house?', 'Yes. Old floors, beams and doors are measured and fitted rather than replaced, because a crooked house usually holds more good timber than a new one would bring.'],
  ['What if my house is listed or in a conservation area?', 'The site lead checks what the rules allow before the drawing is made, and the quote names any part of the work that needs permission first.'],
  ['Do you do small jobs as well as whole houses?', 'Kitchens, bathrooms and single rooms are most of the work, and a whole-house renovation is planned room by room so you can live in the rest of it.'],
  ['How do I start, and what does the first visit cost?', 'Book a home visit. The site lead measures the room, talks through what you want, and the drawing and the itemised quote follow in writing.'],
];
// Workflow 2 art direction, atmosphere and section visuals, for the complete fixture.
const ART = {
  visualConcept: 'The house as a ship carpenter sees it: measured lines, warm timber light and nothing square',
  storytelling: 'Each page walks from the crooked room to the fitted result, one measured step at a time',
  typography: 'A sturdy serif at poster scale for one line per page, a bookish serif for reading, tight leading on display lines',
  layout: 'A twelve column grid measured off a visible rule, with images bleeding off one edge and text cards overlapping them',
  hero: { archetype: 'type-behind-subject', description: 'The firm name split across the width at poster scale, with a cut-out of the site lead and his rule standing in the gap' },
  navigation: { archetype: 'floating-glass-pill', description: 'A compact pill floating near the top centre with the wordmark, three links and a dark call to action, over a frosted fill' },
  footer: { archetype: 'cropped-wordmark-footer', description: 'The firm name set across the full width at poster scale, its baseline cut by the bottom edge, with the links in a thin row above' },
  transitions: 'Sections hand over along the measured rule, which carries across each seam into the next section',
  imageTreatment: 'Unretouched site photographs in a warm duotone of timber and forest green, cropped tight on hands and joints',
  gallery: 'One large finished room with two smaller details stacked beside it, specifications floating on glass chips',
  background: { effect: 'A soft radial light from the top of the hero, like a window on an old staircase', technique: 'css-scroll-timeline' },
  shader: { use: false, why: 'A renovation firm needs warm photographs more than a moving background' },
  threeD: { use: false, why: 'There is no product to turn, and phones on site are slow' },
  icons: 'Thin two pixel line icons drawn like carpenter marks, at twenty four pixels, in the text colour',
  microInteractions: ['The rule under a link thickens on hover', 'A button drops two pixels when pressed', 'The quote total ticks once when it scrolls in'],
};
const ATMOSPHERE = {
  surfaces: { base: '#fbf8f3', raised: '#f2ede5', sunken: '#ece5da', glass: { fill: 'rgba(251, 248, 243, 0.72)', blur: '14px', border: 'rgba(31, 27, 22, 0.12)', use: 'The floating navigation pill only' } },
  borders: { subtle: '#ddd5ca', strong: '#1f1b16', glow: 'rgba(47, 107, 90, 0.35)' },
  radius: { sm: '6px', md: '14px', lg: '28px' },
  elevation: { low: '0 1px 2px rgba(31, 27, 22, 0.08)', mid: '0 8px 24px rgba(31, 27, 22, 0.10)', high: '0 24px 60px rgba(31, 27, 22, 0.14)' },
  gradients: [{ name: 'window-light', kind: 'radial', stops: ['#f2ede5', '#fbf8f3'], use: 'The light behind the hero' }],
  lighting: 'One warm radial light from the top of the hero, like a window on an old staircase',
  texture: { kind: 'paper', opacity: 0.05 },
  motion: { easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)', fast: '150ms', base: '300ms', slow: '600ms' },
};
const VISUALS = { promise: 'type-behind-subject', 'quote-rule': 'editorial-split-overlap', 'old-houses': 'asymmetric-feature-gallery', process: 'sticky-stack', proof: 'pull-quote-portrait', decide: 'split-faq-index' };
const visual = (archetype) => ({
  archetype, focalPoint: 'The large display line, then the photograph',
  layers: { back: 'The warm window light', mid: 'The duotone photograph', front: 'The type and the call to action' },
  imageTreatment: 'Warm duotone, cropped tight on the joint', interaction: 'Hovering the image lifts it two pixels',
  transitionIn: 'Rises twelve pixels and settles on entry', mobileComposition: 'The photograph first, the text card overlapping its foot',
});
const CHROME = {
  navigation: { archetype: 'floating-glass-pill', composition: 'A pill near the top centre with the wordmark, links and a call to action', mobile: 'The links fold into one menu button inside the pill', behaviour: 'Stays put and gains a soft shadow once the hero has passed' },
  footer: { archetype: 'cropped-wordmark-footer', composition: 'The firm name across the full width, its baseline cut off', mobile: 'The wordmark stays, the links stack', behaviour: 'The wordmark rises into place as it scrolls in' },
};

function v2Spec() {
  const s = spec();
  const home = s['design/section-plan.json'].pages[0];
  const steps = [
    ['promise', 1, 'about', 'custom-authored'], ['quote-rule', 2, 'whatWeDo', 'custom-authored'], ['old-houses', 3, 'whatWeDo', 'none'],
    ['process', 4, 'whatWeDo', 'none'], ['proof', 5, 'reachUs', 'none'],
  ];
  for (const [id, step, bucket, media] of steps) Object.assign(home.sections.find((x) => x.id === id), { hierarchyStep: step, contentBucket: bucket, media });
  home.sections.push({ ...structuredClone(home.sections[4]), id: 'decide', pattern: 'list-editorial', assets: [], funnel: 'action', hierarchyStep: 6, contentBucket: 'reachUs', media: 'x-factor-tool' });
  home.flow = 'primary';
  for (const sec of home.sections) sec.visual = visual(VISUALS[sec.id]);
  s['design/section-plan.json'].chrome = structuredClone(CHROME);
  const copy = s['content/copy.json'];
  copy.pages[0].sections.push({ id: 'decide', headline: 'What people ask before they book', items: FAQ_ITEMS.map(([title, text]) => ({ title, text })), cta: { label: 'Book a visit', href: 'tel:2075550142' } });
  return {
    ...s,
    'design/direction.json': { ...s['design/direction.json'], identity: IDENTITY, artDirection: structuredClone(ART) },
    'design/design-system.json': { ...s['design/design-system.json'], components: COMPONENTS, atmosphere: structuredClone(ATMOSPHERE) },
    'design/reference/workflow.json': { version: 2 },
  };
}
const v2Project = (change = (x) => x) => fullProject(change(v2Spec()));
const V2_STAGES = ['direction', 'design-system', 'section-plan', 'asset-plan', 'copy'];

test('a complete workflow 2 specification passes: identity, components, six steps, buckets, media, a deep FAQ', () => {
  const { dir } = v2Project();
  for (const stage of V2_STAGES) assert.deepEqual(CHECKS[stage](dir), [], stage);
});

test('a project planned before workflow 2 is not held to the identity or the hierarchy', () => {
  const { dir } = fullProject();
  for (const stage of V2_STAGES) assert.deepEqual(CHECKS[stage](dir), [], stage);
});

test('the identity is locked before B2: logo, navigation, buttons and a signature, each a real sentence', () => {
  let { dir } = v2Project((s) => ({ ...s, 'design/direction.json': { ...s['design/direction.json'], identity: undefined } }));
  assert.match(CHECKS.direction(dir).join('\n'), /lock the identity before B2 in "identity"/);
  ({ dir } = v2Project((s) => ({ ...s, 'design/direction.json': { ...s['design/direction.json'], identity: { ...IDENTITY, navigation: 'A sticky header', buttons: 'Rounded' } } })));
  const p = CHECKS.direction(dir).join('\n');
  assert.match(p, /identity.navigation must describe the navigation bar's own style/);
  assert.match(p, /identity.buttons must describe the button style/);
});

test('the design system refuses default buttons, a no-name navigation bar, purple gradients and glass as the whole language', () => {
  const ds = (change) => v2Project((s) => ({ ...s, 'design/design-system.json': change(structuredClone(s['design/design-system.json'])) })).dir;
  assert.match(CHECKS['design-system'](ds((x) => ({ ...x, components: undefined }))).join('\n'), /define the navigation bar and the buttons in "components"/);
  const defaults = CHECKS['design-system'](ds((x) => { x.components.buttons.shape = 'Rounded rectangle'; x.components.navigation.style = 'Links in a row'; return x; })).join('\n');
  assert.match(defaults, /components.buttons.shape is a default/);
  assert.match(defaults, /components.navigation.style must say what makes this navigation bar this brand's/);
  assert.match(CHECKS['design-system'](ds((x) => ({ ...x, color: { ...x.color, secondary: '#7c3aed' }, visualLanguage: [...x.visualLanguage, 'A violet gradient wash behind every hero'] }))).join('\n'), /purple-violet gradient/);
  assert.doesNotMatch(CHECKS['design-system'](ds((x) => ({ ...x, visualLanguage: [...x.visualLanguage, 'A paper-to-sand gradient at the foot of each page'] }))).join('\n'), /purple-violet/, 'a gradient in the brand colours is fine');
  assert.match(CHECKS['design-system'](ds((x) => ({ ...x, atmosphere: { ...x.atmosphere, surfaces: { ...x.atmosphere.surfaces, glass: { ...x.atmosphere.surfaces.glass, use: 'Every panel and card' } } } }))).join('\n'), /glass on every surface is decoration/);
});

test('every section names its step, bucket and media; a primary page runs the six steps in order', () => {
  const plan = (change) => v2Project((s) => { change(s['design/section-plan.json']); return s; }).dir;
  let p = CHECKS['section-plan'](plan((x) => { delete x.pages[0].sections[2].hierarchyStep; delete x.pages[0].sections[2].media; })).join('\n');
  assert.match(p, /old-houses: name its hierarchyStep, media/);
  assert.match(p, /a primary page runs all six steps; it is missing 3 \(the risk or cost of not acting\)/);
  p = CHECKS['section-plan'](plan((x) => { x.pages[0].sections[3].hierarchyStep = 2; })).join('\n');
  assert.match(p, /\/: step 2 \(wants and needs\) comes after step 3 \(the risk or cost of not acting\); the hierarchy only moves forward/);
  assert.match(CHECKS['section-plan'](plan((x) => { delete x.pages[0].flow; })).join('\n'), /\/: give the page a flow/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].flow = 'supporting'; })).join('\n'), /the home page is a primary page/);
  // A supporting page may skip steps but never goes back.
  const supporting = (steps) => plan((x) => { x.pages[0].flow = 'supporting'; x.pages[0].slug = '/'; x.pages[0].sections.forEach((s, i) => { s.hierarchyStep = steps[i]; }); });
  assert.doesNotMatch(CHECKS['section-plan'](supporting([1, 2, 4, 4, 5, 6])).join('\n'), /only moves forward/);
});

test('a section never stands on an empty bucket or on decoration, and its media needs a matching asset', () => {
  const plan = (change) => v2Project((s) => { change(s['design/section-plan.json']); return s; }).dir;
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[4].contentBucket = 'ourWork'; })).join('\n'), /proof: the ourWork bucket has no facts in research\/crux.json; plan around its gap/);
  assert.doesNotMatch(CHECKS['section-plan'](plan((x) => { Object.assign(x.pages[0].sections[4], { contentBucket: 'ourWork', purpose: 'Plans around the ourWork gap: no finished jobs yet' }); })).join('\n'), /bucket has no facts/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[2].background = 'Floating orbs drift behind the text'; })).join('\n'), /old-houses: floating orbs, blobs and random 3D are decoration with no job/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[0].media = 'photo'; })).join('\n'), /promise: its media is photo, so it needs an asset of kind photo/);
});

test('a 3D asset the operator did not choose is refused', () => {
  const { dir } = v2Project((s) => {
    s['design/asset-plan.json'].assets.push({ id: 'spinning-house', kind: '3d', description: 'A slowly turning model of a house for the hero', source: 'authored', alt: 'A model house' });
    s['design/section-plan.json'].pages[0].sections[0].assets.push('spinning-house');
    return s;
  });
  assert.match(CHECKS['asset-plan'](dir).join('\n'), /spinning-house is a 3D asset the operator did not choose/);
});

test('step 6 is a deep decision FAQ: five real questions answered in full, then the call to action', () => {
  const { dir } = v2Project((s) => {
    const faq = s['content/copy.json'].pages[0].sections.find((x) => x.id === 'decide');
    faq.items = faq.items.slice(0, 3).map((it, i) => (i === 0 ? { ...it, text: 'Yes, usually.' } : it));
    delete faq.cta;
    return s;
  });
  const p = CHECKS.copy(dir).join('\n');
  assert.match(p, /decide: a deep decision FAQ answers at least five real buyer questions; it has 3/);
  assert.match(p, /decide: answer each question in full \(25 words or more\); too short: "Will the quote change once the walls are/);
  assert.match(p, /decide: the deep FAQ leads straight into the call to action/);
});

test('the contracts tell each stage about the identity, the six steps, the buckets, the media and the deep FAQ', () => {
  const lines = (stage) => specTask('demo', stage, BRIEF).acceptance.join('\n');
  assert.match(lines('direction'), /Lock the identity now, before B2[\s\S]*"logo"[\s\S]*"navigation"[\s\S]*"buttons"[\s\S]*"signature"/);
  assert.match(lines('direction'), /purple-violet gradients/);
  assert.match(lines('design-system'), /"components": "navigation"[\s\S]*"buttons"[\s\S]*hover, active, focus/);
  assert.match(lines('section-plan'), /"flow"[\s\S]*"audienceView"/);
  assert.match(lines('section-plan'), /1 what the product is and is not[\s\S]*6 deep decision FAQs/);
  assert.match(lines('section-plan'), /"x-factor-tool"[\s\S]*No floating orbs/);
  assert.match(lines('asset-plan'), /"custom-authored" an svg/);
  assert.match(lines('copy'), /Step 6 sections are deep decision FAQs: at least five real buyer questions/);
});

// Workflow 2, Stage 2 tracks 4A and 4B, and the anti-slop gate before development.
const PHOTO = { id: 'workshop', kind: 'photo', treatment: 'Warm duotone, cropped tight on the hands', description: 'The site lead measuring a crooked doorframe in an old Portland kitchen', source: 'licensed', file: 'photos/workshop.jpg', licence: 'Unsplash', alt: 'A carpenter measuring an old doorframe' };
const PROMPT = { section: 'quote-rule', asset: 'workshop', format: 'photo', aspect: '3:2',
  prompt: 'A carpenter in a worn canvas apron measures a crooked painted doorframe in an old Portland kitchen, morning light from a sash window, warm paper tones, shot at eye level on a 35mm lens, shallow depth of field',
  negative: 'AI artefacts, warped hands or text, plastic skin, purple light, stock-photo smiles' };
const STYLE_LOCK = 'Warm paper and forest green, soft morning window light, 35mm documentary framing, fine film grain, calm and exact';
function mediaProject(change = (x) => x) {
  return v2Project((s) => {
    s['design/asset-plan.json'].assets.push(structuredClone(PHOTO));
    Object.assign(s['design/section-plan.json'].pages[0].sections.find((x) => x.id === 'quote-rule'), { media: 'photo', assets: ['kitchen', 'workshop'] });
    s['design/media-prompts.json'] = { styleLock: STYLE_LOCK, prompts: [PROMPT] };
    s['assets/public/photos/workshop.jpg'] = 'jpeg bytes';
    s['design/media-review.json'] = { items: [{ asset: 'workshop', inspected: 'assets/public/photos/workshop.jpg', verdict: 'pass', issues: [] }] };
    return change(s);
  });
}
const LITMUS = {
  couldBeAnyCompany: { answer: 'no', note: 'The ruled margin and the fixed-quote voice belong to this firm' },
  worksWithoutDecoration: { answer: 'yes', note: 'The layout carries the story without the motion' },
  everySectionHasAReason: { answer: 'yes', note: 'Each section is one of the six steps' },
  claimsRealAndSourced: { answer: 'yes', note: 'Every claim is in content/claims.json' },
  rhythmAndPointOfView: { answer: 'yes', note: 'Tight and generous sections alternate around one idea' },
  artDirected: { answer: 'yes', note: 'The window light, the duotone and the measured rule come from one idea' },
};

test('the media tracks are workflow 2 only: an older project is never asked for prompts or a media check', () => {
  const { dir } = fullProject();
  assert.deepEqual(CHECKS['media-prompts'](dir), []);
  assert.deepEqual(CHECKS['media-review'](dir), []);
  assert.deepEqual(CHECKS.review(dir), [], 'and its review needs no litmus');
});

test('Track 4B prompts: one per photo or video, locked to the B2 look, detailed, with a negative prompt', () => {
  assert.deepEqual(CHECKS['media-prompts'](mediaProject().dir), []);
  assert.match(CHECKS['media-prompts'](mediaProject((s) => { delete s['design/media-prompts.json']; return s; }).dir).join('\n'), /design\/media-prompts.json is missing/);
  assert.match(CHECKS['media-prompts'](mediaProject((s) => { s['design/media-prompts.json'].prompts = []; return s; }).dir).join('\n'), /quote-rule needs a prompt for workshop/);
  const bad = mediaProject((s) => {
    s['design/media-prompts.json'] = { styleLock: 'Warm', prompts: [{ ...PROMPT, format: 'video', prompt: 'A kitchen with floating orbs of purple light', negative: 'none' }] };
    return s;
  });
  const p = CHECKS['media-prompts'](bad.dir).join('\n');
  assert.match(p, /the styleLock must state the B2 look/);
  assert.match(p, /the prompt for workshop is a video, but the asset is a photo/);
  assert.match(p, /the prompt for workshop is too thin/);
  assert.match(p, /needs a negative prompt/);
  assert.match(p, /asks for decoration or a stock look/);
});

test('Track 4B check: every file is looked at, a video only through an image, and a rejection needs its reasons', () => {
  assert.deepEqual(CHECKS['media-review'](mediaProject().dir), []);
  assert.match(CHECKS['media-review'](mediaProject((s) => { s['design/media-review.json'].items = []; return s; }).dir).join('\n'), /workshop was not looked at/);
  const video = mediaProject((s) => {
    s['design/asset-plan.json'].assets.push({ id: 'site-walk', kind: 'video', description: 'A slow walk through a finished kitchen at dusk', source: 'client', file: 'video/site-walk.mp4', licence: 'Supplied by the client', alt: 'A walk through a kitchen' });
    s['design/section-plan.json'].pages[0].sections[2].assets.push('site-walk');
    s['design/media-review.json'].items.push({ asset: 'site-walk', inspected: 'assets/public/video/site-walk.mp4', verdict: 'pass', issues: [] });
    return s;
  });
  assert.match(CHECKS['media-review'](video.dir).join('\n'), /site-walk was judged from assets\/public\/video\/site-walk.mp4; open an image \(for a video, its poster or an extracted frame\), never the video file/);
  const poster = mediaProject((s) => { s['design/media-review.json'].items[0].inspected = 'assets/public/photos/missing.jpg'; return s; });
  assert.match(CHECKS['media-review'](poster.dir).join('\n'), /assets\/public\/photos\/missing.jpg, inspected for workshop, does not exist/);
  const silent = mediaProject((s) => { s['design/media-review.json'].items[0].verdict = 'reject'; return s; });
  assert.match(CHECKS['media-review'](silent.dir).join('\n'), /say why workshop was rejected/);
});

test('a rejected photo stops the assets phase and sends the asset plan back, then the check runs again', async () => {
  const { project, opts, dir } = mediaProject((s) => { delete s['design/media-review.json']; return s; });
  setPhase(dir, 'ASSETS_LICENSING');
  const worker = async ({ task, projectDir }) => {
    if (task.id === 'media-review') write(projectDir, 'design/media-review.json', { items: [{ asset: 'workshop', inspected: 'assets/public/photos/workshop.jpg', verdict: 'reject', issues: ['The hands are warped and the text on the tape measure is melted'] }] });
    return { evidence: ['x'] };
  };
  const planned = planPhase(project, opts).map((t) => t.id);
  assert.ok(planned.includes('media-review'), 'workflow 2 plans the media check in the assets phase');
  assert.match(exitBlockers(project, opts).join('\n'), /task media-review is pending/);
  const r = await runDesignWorkflow(project, { ...opts, worker, verifier: async () => ({ ok: true, code: 0, output: 'ok' }), stopBefore: 'UX_DESIGN_SYSTEM' });
  assert.equal(r.reason, 'reached');
  const fix = listTasks(project, opts).find((t) => t.id.startsWith('asset-plan-fix'));
  assert.ok(fix, 'the asset plan was sent back');
  assert.match(fix.acceptance.join('\n'), /media rejected: workshop \(assets\/public\/photos\/workshop.jpg\): The hands are warped/);
  assert.ok(!existsSync(join(dir, 'design/media-review.json')), 'the old verdict is gone, so the new files are looked at');
  assert.ok(ledger.read(project, opts).some((e) => e.data?.event === 'design_returned' && e.data.stage === 'asset-plan'));
});

test('copy and the media prompts start together after the plans, and the review reads them both', () => {
  const v2 = mediaProject();
  setPhase(v2.dir, 'CONTENT');
  const content = planPhase(v2.project, v2.opts);
  assert.deepEqual(content.map((t) => t.id), ['copy', 'media-prompts', 'asset-register']);
  for (const t of content.slice(0, 2)) assert.deepEqual(t.depends_on, ['section-plan', 'asset-plan'], t.id);
  assert.equal(content[1].agent, 'asset-rights');
  assert.match(content[1].acceptance.join('\n'), /Creative Director's eye[\s\S]*"styleLock"[\s\S]*"negative"/);
  rmSync(join(v2.dir, 'design/review.json'));
  setPhase(v2.dir, 'TECHNICAL_PLAN');
  const [review] = planPhase(v2.project, v2.opts).filter((t) => t.id.startsWith('design-review'));
  assert.ok(review.inputs.includes('design/media-prompts.json') && review.inputs.includes('design/media-review.json') && review.inputs.includes('content/copy.json'), 'the review sees layout, copy and media together');
  assert.match(review.acceptance.join('\n'), /everything is a card;[\s\S]*purple gradients; random floating orbs[\s\S]*harsh brutalist boxes[\s\S]*couldBeAnyCompany[\s\S]*artDirected/);
  // The phases run copy and media before the review: CONTENT and ASSETS_LICENSING come before TECHNICAL_PLAN.
  const order = PHASES.map((p) => p.name);
  assert.ok(order.indexOf('CONTENT') < order.indexOf('TECHNICAL_PLAN') && order.indexOf('ASSETS_LICENSING') < order.indexOf('TECHNICAL_PLAN'));

  const v1 = fullProject();
  setPhase(v1.dir, 'CONTENT');
  assert.deepEqual(planPhase(v1.project, v1.opts).map((t) => t.id), ['copy', 'asset-register'], 'an older project plans what it always did');
});

test('the anti-slop gate: the review answers the five litmus questions, and a failing answer cannot be ready', () => {
  const review = (r) => mediaProject((s) => ({ ...s, 'design/review.json': r })).dir;
  const base = { verdict: 'ready', summary: 'The site holds together', findings: [] };
  assert.match(CHECKS.review(review(base)).join('\n'), /answer the six litmus questions/);
  assert.deepEqual(CHECKS.review(review({ ...base, litmus: LITMUS })), []);
  const generic = { ...base, litmus: { ...LITMUS, couldBeAnyCompany: { answer: 'yes', note: 'Swap the name and it is any builder' }, worksWithoutDecoration: { answer: 'no', note: 'Without the gradients it is empty' } } };
  assert.match(CHECKS.review(review(generic)).join('\n'), /the litmus fails \(couldBeAnyCompany, worksWithoutDecoration\), so the verdict must be "changes"/);
  assert.deepEqual(CHECKS.review(review({ ...generic, verdict: 'changes', findings: [{ stage: 'design-system', severity: 'blocking', message: 'Give the surfaces a point of view' }] })), []);
});

test('copy with no voice is refused: stock headlines and the same three-layer stack everywhere', () => {
  const { dir } = mediaProject((s) => {
    const sections = s['content/copy.json'].pages[0].sections;
    sections[0].headline = 'Elevate your home with seamless renovations';
    for (const x of sections) Object.assign(x, { eyebrow: 'Harbor Home', subheadline: 'A plain promise about the work' });
    return s;
  });
  const p = CHECKS.copy(dir).join('\n');
  assert.match(p, /promise: "Elevate your home with seamless renovations" has no marketing voice/);
  assert.match(p, /5 of 6 sections repeat the same eyebrow, headline, subheadline and body stack/);
});

// The approach pause (workflow 2): the operator chooses the approach after a plain explanation.
async function approachProject({ v2 = true } = {}) {
  const { loadRegistry } = await import('../../src/registry/load.mjs');
  const { selectApproaches } = await import('../../src/registry/select.mjs');
  const r = loadRegistry();
  const p = fullProject({ 'design/approach-decision.json': selectApproaches(BRIEF, r.approaches, r.matrix), ...(v2 ? { 'design/reference/workflow.json': { version: 2 } } : {}) });
  rmSync(join(p.dir, 'design/direction.json'));
  setPhase(p.dir, 'APPROACH_SELECTION');
  return p;
}

test('the approach options explain every approach in plain words, with what this brief qualifies for', async () => {
  const { approachOptions, describeOptions } = await import('../../src/design/approach-guide.mjs');
  const { dir } = await approachProject();
  const options = approachOptions(dir);
  assert.equal(options.length, 8);
  const byId = Object.fromEntries(options.map((o) => [o.id, o]));
  assert.equal(byId['APP-01'].status, 'selected');
  assert.equal(byId['APP-01'].recommended, true, 'a plain business brief qualifies only for APP-01, so it is the recommendation');
  assert.equal(byId['APP-02'].status, 'possible');
  assert.equal(byId['APP-06'].status, 'excluded');
  for (const o of options) assert.ok(o.looks.length > 40 && o.fits.length > 20, `${o.id} is explained`);
  const lines = describeOptions(options).join('\n');
  assert.match(lines, /APP-01 AI to Full Website \(recommended\): A clean, fast multi-page site[\s\S]*\[fits this brief\]/);
  assert.match(lines, /APP-02 Cinematic Scroll Website: The page tells a story as you scroll[\s\S]*\[possible if you want it\]/);
  assert.match(lines, /APP-06 Game-Like Website[^\n]*\[not for this kind of project\]/);
});

test('the approach pause stops a workflow 2 project until the operator chooses, and holds the direction to the choice', async () => {
  const { approachBlockers, chooseApproach } = await import('../../src/design/approach-guide.mjs');
  const { project, opts, dir } = await approachProject();
  assert.deepEqual(planPhase(project, opts), [], 'no direction is planned before the choice');
  assert.match(exitBlockers(project, opts).join('\n'), /approach choice: see the options with forge design approach demo/);
  assert.throws(() => chooseApproach(project, 'APP-06', { note: 'fun', ...opts }), /excluded for this kind of project/);
  assert.throws(() => chooseApproach(project, 'APP-02', opts), /needs your note/);
  const choice = chooseApproach(project, 'app-02', { note: 'The client has strong photos and wants a story', ...opts });
  assert.equal(choice.approach, 'APP-02');
  assert.deepEqual(approachBlockers(project, dir), []);
  const decision = JSON.parse(readFileSync(join(dir, 'design/approach-decision.json'), 'utf8'));
  assert.deepEqual(check('approachDecision', decision).errors, [], 'the record stays valid');
  const app02 = decision.decisions.find((d) => d.approach === 'APP-02');
  assert.equal(app02.selected, true);
  assert.match(app02.reason, /Chosen by the operator at the approach pause: The client has strong photos/);
  assert.ok(app02.fallback.description);
  assert.ok(ledger.read(project, opts).some((e) => e.actor === 'operator' && e.data?.event === 'approach_chosen' && e.data.approach === 'APP-02'));
  const [direction] = planPhase(project, opts);
  assert.equal(direction.id, 'direction');
  assert.ok(direction.inputs.includes('design/approach-choice.json'));
  assert.match(direction.acceptance[0], /The operator chose APP-02 \(Cinematic Scroll Website\) at the approach pause/);
  write(dir, 'design/direction.json', spec()['design/direction.json']);
  assert.match(CHECKS.direction(dir).join('\n'), /the operator chose APP-02 at the approach pause; the primary approach must be APP-02, not APP-01/);
});

test('an older project is not stopped for an approach choice', async () => {
  const { project, opts } = await approachProject({ v2: false });
  assert.deepEqual(planPhase(project, opts).map((t) => t.id), ['direction']);
  assert.ok(!exitBlockers(project, opts).some((b) => b.startsWith('approach choice')));
});

test('the workflow can stop after every phase, with what moved', async () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'ASSETS_LICENSING');
  const r = await runDesignWorkflow(project, { ...opts, worker: async () => ({ evidence: ['x'] }), verifier: async () => ({ ok: true, code: 0, output: 'ok' }), pauseEachPhase: true });
  assert.equal(r.reason, 'step', JSON.stringify(r.blockers ?? r));
  assert.deepEqual(r.moved, { from: 'ASSETS_LICENSING', to: 'TECHNICAL_PLAN' });
  assert.equal(loadProject(project, opts).phase, 'TECHNICAL_PLAN', 'it stopped right after the move');
  const on = await runDesignWorkflow(project, { ...opts, worker: async () => ({ evidence: ['x'] }), verifier: async () => ({ ok: true, code: 0, output: 'ok' }), stopBefore: 'BUILD' });
  assert.notEqual(on.reason, 'step', 'without the option it runs on as before');
});

test('each phase has a plain summary of what happened and which files hold it', async () => {
  const { phaseSummary, summaryLines } = await import('../../src/design/summary.mjs');
  const { dir } = fullProject();
  const plan = phaseSummary(dir, 'UX_DESIGN_SYSTEM');
  assert.equal(plan.title, 'Page plans: every section, laid out');
  assert.match(plan.lines[0], /^1 page planned, with 5 sections in 5 different layouts\.$/);
  assert.ok(plan.files.includes('design/section-plan.json'));
  const content = summaryLines(phaseSummary(dir, 'CONTENT')).join('\n');
  assert.match(content, /== Words: the copy for every section\n {3}About \d+ words across 1 page, in the voice: Plain and exact\./);
  assert.match(summaryLines(phaseSummary(dir, 'TECHNICAL_PLAN')).join('\n'), /ready to build/);
  assert.match(phaseSummary(dir, 'PREVIEW_REPORT').lines[0], /The preview report step is done/);
  for (const line of Object.keys(PHASES).length ? summaryLines(phaseSummary(dir, 'RESEARCH')) : []) assert.ok(line.length < 260, 'lines stay short');
});

// Workflow 2, art direction: the craft library, the art direction at B2, the atmosphere, how each section
// looks, and the review's sixth litmus answer.
test('the craft library validates: archetypes for every place, the two template heroes marked, React techniques kept out', async () => {
  const lib = (f) => JSON.parse(readFileSync(new URL(`../../registry/craft/${f}.json`, import.meta.url), 'utf8'));
  const patterns = lib('patterns');
  const techniques = lib('techniques');
  assert.deepEqual(check('patternLibrary', patterns).errors, []);
  assert.deepEqual(check('patternLibrary', techniques).errors, []);
  const usable = (cat) => patterns.patterns.filter((p) => p.category === cat && !p.banned);
  assert.ok(usable('hero').length >= 8, 'at least 8 heroes');
  assert.ok(usable('navigation').length >= 6, 'at least 6 navigation bars');
  assert.ok(usable('footer').length >= 6, 'at least 6 footers');
  assert.deepEqual(patterns.patterns.filter((p) => p.banned).map((p) => p.id).sort(), ['centred-over-photo', 'split-headline-photo']);
  const ids = new Set(techniques.techniques.map((t) => t.id));
  for (const p of patterns.patterns) for (const t of p.techniques ?? []) assert.ok(ids.has(t), `${p.id} names a known technique: ${t}`);
  assert.deepEqual(techniques.techniques.filter((t) => t.inStarter === false).map((t) => t.id).sort(), ['framer-motion', 'react-three-fiber']);
  assert.equal(new Set(patterns.patterns.map((p) => p.id)).size, patterns.patterns.length, 'ids are unique');
});

test('the art direction is decided before B2, from the library, with shader and 3D decided explicitly', () => {
  const art = (change) => v2Project((s) => ({ ...s, 'design/direction.json': { ...s['design/direction.json'], artDirection: change(structuredClone(ART)) } })).dir;
  assert.match(CHECKS.direction(v2Project((s) => ({ ...s, 'design/direction.json': { ...s['design/direction.json'], artDirection: undefined } })).dir).join('\n'), /artDirection is missing/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, hero: { ...a.hero, archetype: 'giant-hero' } }))).join('\n'), /artDirection.hero: "giant-hero" is not a hero archetype/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, hero: { ...a.hero, archetype: 'split-headline-photo' } }))).join('\n'), /is the hero every generated site already has/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, footer: { ...a.footer, archetype: 'floating-glass-pill' } }))).join('\n'), /footer: "floating-glass-pill" is not a footer archetype/, 'an archetype from the wrong category');
  assert.deepEqual(CHECKS.direction(art((a) => ({ ...a, hero: { archetype: 'custom', description: a.hero.description, reason: 'The client\'s founder insists on his hand-drawn plan' } }))), [], 'custom with a reason');
  assert.match(CHECKS.direction(art((a) => ({ ...a, shader: { use: true, why: 'A moving light would suit the window idea' } }))).join('\n'), /shader: when it is used, name a technique/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, shader: { use: true, why: 'A moving light would suit the window idea', technique: 'glsl-shader', where: 'Behind the hero only', fallback: 'The same radial light in CSS' } }))).join('\n'), /Own GLSL shader belongs to APP-05 or APP-07, not APP-01/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, threeD: { use: true, why: 'Turning the kitchen would help', technique: 'react-three-fiber', where: 'The kitchen section', fallback: 'A photo of the kitchen' } }))).join('\n'), /needs a React integration this starter does not have/);
  assert.match(CHECKS.direction(art((a) => ({ ...a, typography: 'Serif' }))).join('\n'), /artDirection.typography must be decided in a full sentence/);
});

test('the same hero as a recent project in the workspace needs a reason', () => {
  const { dir } = v2Project();
  write(dirname(dir), 'earlier/design/direction.json', { artDirection: { hero: { archetype: 'type-behind-subject' } } });
  assert.match(CHECKS.direction(dir).join('\n'), /"type-behind-subject" was the hero of a recent project in this workspace/);
  const d = JSON.parse(readFileSync(join(dir, 'design/direction.json'), 'utf8'));
  d.artDirection.hero.reason = 'The cut-out of the site lead is the strongest image the client has';
  write(dir, 'design/direction.json', d);
  assert.doesNotMatch(CHECKS.direction(dir).join('\n'), /recent project/);
});

test('the atmosphere refuses both extremes: crude brutalism and decoration everywhere, and off-brand gradients', async () => {
  const { atmosphereProblems, onBrand } = await import('../../src/site/atmosphere.mjs');
  const palette = Object.values(COLOURS);
  assert.deepEqual(atmosphereProblems(ATMOSPHERE, palette), [], 'a balanced atmosphere passes');
  const brutal = { ...ATMOSPHERE, radius: { sm: '0', md: '0px', lg: '0' }, elevation: { low: 'none', mid: 'none', high: 'none' }, gradients: [], texture: { kind: 'none', opacity: 0 } };
  const b = atmosphereProblems(brutal, palette).join('\n');
  assert.match(b, /is crude brutalism: square corners, no depth, no light and no texture/);
  assert.match(b, /has depth from only 1 source/);
  const busy = { ...ATMOSPHERE, gradients: [1, 2, 3, 4].map((i) => ({ name: `g${i}`, kind: 'mesh', stops: ['#2f6b5a', '#fbf8f3'], use: 'A wash' })), surfaces: { ...ATMOSPHERE.surfaces, glass: { ...ATMOSPHERE.surfaces.glass, blur: '40px', use: 'Every card and panel' } } };
  const d = atmosphereProblems(busy, palette).join('\n');
  assert.match(d, /has 4 gradients; more than three is decoration/);
  assert.match(d, /glass on every surface is decoration/);
  assert.match(d, /a 40px glass blur is heavy for phones/);
  assert.match(atmosphereProblems({ ...ATMOSPHERE, gradients: [{ name: 'neon', kind: 'linear', stops: ['#7c3aed', '#fbf8f3'], use: 'Hero' }] }, palette).join('\n'), /gradient "neon" uses #7c3aed, which is not one of the B2 colours/);
  assert.equal(onBrand(mix('#2f6b5a', '#fbf8f3', 0.5), palette), true, 'a tint of a B2 colour is on brand');
  assert.match(atmosphereProblems(undefined, palette)[0], /atmosphere is missing/);
  assert.match(CHECKS['design-system'](v2Project((s) => ({ ...s, 'design/design-system.json': { ...s['design/design-system.json'], atmosphere: brutal } })).dir).join('\n'), /crude brutalism/, 'the design-system check applies it');
});

test('the atmosphere becomes CSS variables, written for the build where the builder cannot drop them', async () => {
  const { atmosphereCss, ATMOSPHERE_VARS } = await import('../../src/site/atmosphere.mjs');
  const css = atmosphereCss(ATMOSPHERE);
  for (const v of ATMOSPHERE_VARS) assert.match(css, new RegExp(`${v}: `), v);
  assert.match(css, /--radius-md: 14px;/);
  assert.match(css, /--surface-glass: rgba\(251, 248, 243, 0.72\);/);
  assert.match(css, /--gradient-window-light: radial-gradient\(circle at 30% 20%, #f2ede5, #fbf8f3\);/);
  assert.match(css, /--grain-opacity: 0.05;/);
  const starter = readFileSync(new URL('../../starters/astro-base/src/styles/atmosphere.css', import.meta.url), 'utf8');
  for (const v of ATMOSPHERE_VARS) assert.match(starter, new RegExp(`${v}: `), `the starter's neutral default has ${v}`);
  // Planning the build of a workflow 2 project writes the file over the starter's defaults.
  // A complete workflow 2 project: research with the Truth Doc, both media tracks and a reviewed plan.
  const { project, opts, dir } = mediaProject((s) => {
    const p = s['research/positioning.json'];
    s['research/positioning.json'] = { ...p, ...TRUTH, competitors: p.competitors.map((c) => ({ ...c, learn: 'How it shows prices', avoid: 'Stock dream-home photos' })) };
    s['research/crux.json'] = { ...s['research/crux.json'], buyerQuestions: BUYER_QUESTIONS };
    s['design/review.json'] = { ...s['design/review.json'], litmus: { ...LITMUS } };
    return s;
  });
  assert.deepEqual(readiness(dir).stages.filter((x) => !x.ok).map((x) => x.problems).flat(), [], 'the fixture is ready to build');
  write(dir, 'site/package.json', { name: 'site' });
  setPhase(dir, 'BUILD');
  planPhase(project, opts);
  assert.equal(readFileSync(join(dir, 'site/src/styles/atmosphere.css'), 'utf8'), css);
  assert.match(readFileSync(new URL('../../starters/astro-base/src/layouts/Base.astro', import.meta.url), 'utf8'), /import '..\/styles\/atmosphere.css';/);
  const foundation = listTasks(project, opts).find((t) => t.id === 'build-foundation');
  assert.match(foundation.acceptance.join('\n'), /data-archetype="<its archetype>"[\s\S]*Keep site\/src\/styles\/atmosphere.css as the harness wrote it/);
});

test('every section is planned for how it looks: a visual, different neighbours, few card grids, the chosen hero and chrome', () => {
  const plan = (change) => v2Project((s) => { change(s['design/section-plan.json']); return s; }).dir;
  assert.deepEqual(CHECKS['section-plan'](plan(() => {})), []);
  assert.match(CHECKS['section-plan'](plan((x) => { delete x.pages[0].sections[2].visual; })).join('\n'), /old-houses: describe how it looks in "visual"/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[2].visual.archetype = 'editorial-split-overlap'; })).join('\n'), /old-houses: the same archetype \("editorial-split-overlap"\) as the section before it/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[2].visual.archetype = 'bento-features'; x.pages[0].sections[4].visual.archetype = 'cards-footer'; })).join('\n'), /\/: 2 sections use a card or grid archetype; at most one per page/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[0].visual.archetype = 'composer-hero'; })).join('\n'), /promise: the hero's archetype is "composer-hero", but the art direction chose "type-behind-subject"/);
  assert.match(CHECKS['section-plan'](plan((x) => { delete x.chrome; })).join('\n'), /plan the navigation and footer in "chrome"/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.chrome.footer.archetype = 'cards-footer'; })).join('\n'), /chrome.footer is "cards-footer", but the art direction chose "cropped-wordmark-footer"/);
  assert.match(CHECKS['section-plan'](plan((x) => { x.pages[0].sections[1].visual.interaction = 'Hover'; })).join('\n'), /quote-rule: visual.interaction must say what the visitor sees/);
});

test('a photo needs a treatment, and the motion techniques stay known and within the script budget', () => {
  const { dir } = mediaProject((s) => { delete s['design/asset-plan.json'].assets.find((a) => a.id === 'workshop').treatment; return s; });
  assert.match(CHECKS['asset-plan'](dir).join('\n'), /photo workshop needs a "treatment"/);
  const motion = (techniques) => v2Project((s) => { s['design/motion-plan.json'].motions.forEach((m, i) => { if (techniques[i]) m.technique = techniques[i]; }); return s; }).dir;
  assert.deepEqual(CHECKS['motion-plan'](motion(['motion-dev', 'css-scroll-timeline'])), []);
  assert.match(CHECKS['motion-plan'](motion(['tween-max'])).join('\n'), /technique "tween-max" is not in design\/reference\/craft\/techniques.json/);
  assert.match(CHECKS['motion-plan'](motion(['three-scene', 'gsap-scrolltrigger', 'motion-dev'])).join('\n'), /the techniques cost about 208 KB of script \(three-scene, gsap-scrolltrigger, motion-dev\), over the 150 KB this approach allows/);
});

test('the review answers a sixth litmus question: is the site art-directed from one concept', () => {
  const review = (r) => mediaProject((s) => ({ ...s, 'design/review.json': r })).dir;
  const base = { verdict: 'ready', summary: 'The site holds together', findings: [] };
  const { artDirected: _a, ...five } = LITMUS;
  assert.match(CHECKS.review(review({ ...base, litmus: five })).join('\n'), /answer the sixth litmus question, "artDirected"/);
  assert.match(CHECKS.review(review({ ...base, litmus: { ...LITMUS, artDirected: { answer: 'no', note: 'Flat boxes, nothing from the window idea' } } })).join('\n'), /the litmus fails \(artDirected\)/);
});

test('the contracts carry the art direction to every stage and to the builder', () => {
  const lines = (stage) => specTask('demo', stage, BRIEF).acceptance.join('\n');
  assert.match(lines('direction'), /"artDirection"[\s\S]*"visualConcept"[\s\S]*"shader" and "threeD"[\s\S]*"microInteractions"/);
  assert.match(lines('direction'), /crude brutalism: square flat boxes, three flat colours/);
  assert.match(lines('direction'), /split-headline-photo and centred-over-photo/);
  assert.match(lines('design-system'), /"atmosphere"[\s\S]*"radius" \(sm, md, lg: a scale, not one value\)[\s\S]*--surface-glass/);
  assert.match(lines('section-plan'), /Describe how every section LOOKS in "visual"[\s\S]*an asymmetric gallery, one large featured product[\s\S]*"chrome"/);
  assert.match(lines('asset-plan'), /Every photo has a "treatment"/);
  assert.match(lines('motion-plan'), /"technique": a technique id from design\/reference\/craft\/techniques.json/);
});

test('when the approach changes, the plans written for the old one are rewritten, not patched', async () => {
  const { chooseApproach } = await import('../../src/design/approach-guide.mjs');
  const { project, opts, dir } = await approachProject();
  write(dir, 'design/direction.json', spec()['design/direction.json']);
  chooseApproach(project, 'APP-02', { note: 'A cinematic story suits the launch', ...opts });
  const stale = JSON.parse(readFileSync(join(dir, 'design/reference/stale.json'), 'utf8'));
  assert.deepEqual([stale.from, stale.to], ['APP-01', 'APP-02']);
  assert.deepEqual(stale.stages, ['design-system', 'section-plan', 'motion-plan', 'asset-plan'], 'only the plans that exist');
  setPhase(dir, 'TECHNICAL_PLAN');
  sendBack(project, 'motion-plan', ['motion-plan.json still describes the old approach'], opts);
  const fix = listTasks(project, opts).find((t) => t.id === 'motion-plan-fix-1');
  assert.match(fix.acceptance.join('\n'), /Rewrite this file from scratch for the current design\/direction.json/);
  assert.doesNotMatch(fix.acceptance.join('\n'), /Keep what is already right/);
  assert.ok(ledger.read(project, opts).some((e) => e.data?.event === 'design_rewrite' && e.data.stage === 'motion-plan'));
  // Taken once: the next return of the same stage patches again.
  setPhase(dir, 'TECHNICAL_PLAN');
  sendBack(project, 'motion-plan', ['one small thing'], opts);
  assert.match(listTasks(project, opts).find((t) => t.id === 'motion-plan-fix-2').acceptance.join('\n'), /Keep what is already right/);
  // Choosing the same approach again marks nothing.
  const again = await approachProject();
  write(again.dir, 'design/direction.json', spec()['design/direction.json']);
  chooseApproach(again.project, 'APP-01', { note: 'Same as before', ...again.opts });
  assert.ok(!existsSync(join(again.dir, 'design/reference/stale.json')));
});

test('the operator can ask for a fresh rewrite on a retry', () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'TECHNICAL_PLAN');
  retryStage(project, 'section-plan', { note: 'The plan still uses the railway vocabulary; rewrite it as the film reel', fresh: true, ...opts });
  const fix = listTasks(project, opts).find((t) => t.id.startsWith('section-plan-fix'));
  assert.match(fix.acceptance[0], /^Fix: The plan still uses the railway vocabulary/);
  assert.match(fix.acceptance.join('\n'), /Rewrite this file from scratch/);
  retryStage(project, 'section-plan', { note: 'A small wording fix', ...opts });
  const fixes = listTasks(project, opts).filter((t) => t.id.startsWith('section-plan-fix'));
  assert.match(fixes.at(-1).acceptance.join('\n'), /Keep what is already right/, 'without --fresh a retry patches');
});

test('build tasks finished before the specification changed are planned again as rebuilds, pages after the foundation', () => {
  const { project, opts, dir } = mediaProject((s) => {
    const p = s['research/positioning.json'];
    s['research/positioning.json'] = { ...p, ...TRUTH, competitors: p.competitors.map((c) => ({ ...c, learn: 'How it shows prices', avoid: 'Stock dream-home photos' })) };
    s['research/crux.json'] = { ...s['research/crux.json'], buyerQuestions: BUYER_QUESTIONS };
    s['design/review.json'] = { ...s['design/review.json'], litmus: { ...LITMUS } };
    return s;
  });
  write(dir, 'site/package.json', { name: 'site' });
  setPhase(dir, 'BUILD');
  const first = planPhase(project, opts).map((t) => t.id);
  assert.deepEqual(first, ['build-foundation', 'build-page-home']);
  // Nothing changed since they finished: nothing to rebuild.
  for (const id of first) ledger.append(project, { actor: 'builder', type: 'task_status', data: { task: id, from: 'verifying', to: 'done' } }, opts);
  for (const id of first) saveTask(project, { ...listTasks(project, opts).find((t) => t.id === id), status: 'done', evidence: ['x'] }, opts);
  assert.deepEqual(planPhase(project, opts), []);
  // The section plan is sent back and fixed: the finished build is of an older design.
  ledger.append(project, { actor: 'design-manager', type: 'note', data: { event: 'design_returned', stage: 'section-plan', attempt: 1, problems: ['x'] } }, opts);
  const again = planPhase(project, opts);
  assert.deepEqual(again.map((t) => t.id), ['build-foundation-fix-1', 'build-page-home-fix-1']);
  assert.match(again[0].acceptance[0], /^Rebuild: the specification changed after this was built/);
  assert.deepEqual(again[1].depends_on, ['build-foundation-fix-1'], 'the page waits for the rebuilt foundation');
  // Once the rebuilds finish, the plan is settled.
  for (const t of again) ledger.append(project, { actor: 'builder', type: 'task_status', data: { task: t.id, from: 'verifying', to: 'done' } }, opts);
  for (const t of again) saveTask(project, { ...listTasks(project, opts).find((x) => x.id === t.id), status: 'done', evidence: ['x'] }, opts);
  assert.deepEqual(planPhase(project, opts), []);
});

test('the design system names the B2 faces first: a text that only mentions them is a swap', () => {
  const ds = (typography) => fullProject({ 'design/design-system.json': { ...spec()['design/design-system.json'], typography: { ...spec()['design/design-system.json'].typography, ...typography } } }).dir;
  assert.deepEqual(CHECKS['design-system'](ds({ display: 'Fraunces (OFL-1.1, via Fontsource) set at 700 with tight tracking' })).filter((p) => /face/.test(p)), []);
  const swapped = CHECKS['design-system'](ds({ display: 'Barlow Condensed (OFL-1.1) set heavy and condensed, replacing Fraunces for the signage look', body: 'Source Sans 3, a calm sans; Lora is kept for nothing' })).join('\n');
  assert.match(swapped, /the display face must be the B2 choice, Fraunces, named first \(it names "barlow condensed"\)/);
  assert.match(swapped, /the body face must be the B2 choice, Lora, named first \(it names "source sans 3"\)/);
});

test('a workflow that cannot take the run lock plans nothing', async () => {
  const { project, opts, dir } = fullProject();
  setPhase(dir, 'UX_DESIGN_SYSTEM');
  // Another live process holds the lock: this test process's parent, which is alive while the test runs.
  write(dir, 'locks/run.lock', { pid: process.ppid, host: (await import('node:os')).hostname(), startedAt: new Date().toISOString() });
  const before = listTasks(project, opts).length;
  await assert.rejects(runDesignWorkflow(project, { ...opts, worker: async () => ({ evidence: ['x'] }) }), /already being run by process/);
  assert.equal(listTasks(project, opts).length, before, 'no task was planned');
});

test('a rebuild takes the next free fix id and supersedes the blocked attempts it replaces; build tasks wait for the build phase', () => {
  const { project, opts, dir } = mediaProject((s) => {
    const p = s['research/positioning.json'];
    s['research/positioning.json'] = { ...p, ...TRUTH, competitors: p.competitors.map((c) => ({ ...c, learn: 'How it shows prices', avoid: 'Stock dream-home photos' })) };
    s['research/crux.json'] = { ...s['research/crux.json'], buyerQuestions: BUYER_QUESTIONS };
    s['design/review.json'] = { ...s['design/review.json'], litmus: { ...LITMUS } };
    return s;
  });
  write(dir, 'site/package.json', { name: 'site' });
  setPhase(dir, 'BUILD');
  planPhase(project, opts);
  for (const id of ['build-foundation', 'build-page-home']) {
    ledger.append(project, { actor: 'builder', type: 'task_status', data: { task: id, from: 'verifying', to: 'done' } }, opts);
    saveTask(project, { ...listTasks(project, opts).find((t) => t.id === id), status: 'done', evidence: ['x'] }, opts);
  }
  ledger.append(project, { actor: 'design-manager', type: 'note', data: { event: 'design_returned', stage: 'section-plan', attempt: 1, problems: ['x'] } }, opts);
  planPhase(project, opts);
  // The first rebuild of the page fails, and a duplicate already holds fix-2.
  saveTask(project, { ...listTasks(project, opts).find((t) => t.id === 'build-page-home-fix-1'), status: 'blocked', blocked_reason: 'Verify command failed on attempt 3' }, opts);
  addTasks(project, opts, task('build-page-home-fix-2', { agent: 'builder', status: 'blocked', blocked_reason: 'Superseded: duplicate' }));
  ledger.append(project, { actor: 'design-manager', type: 'note', data: { event: 'design_returned', stage: 'design-system', attempt: 3, problems: ['fonts'] } }, opts);
  const again = planPhase(project, opts).map((t) => t.id);
  assert.ok(again.includes('build-page-home-fix-3'), JSON.stringify(again));
  assert.match(listTasks(project, opts).find((t) => t.id === 'build-page-home-fix-1').blocked_reason, /^Superseded: rebuilt as build-page-home-fix-3/);
});

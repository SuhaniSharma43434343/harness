import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { advanceProject, exitBlockers } from '../../src/core/advance.mjs';
import { listTasks, transitionTask } from '../../src/core/board.mjs';
import { PermissionDenied } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { businessAcceptance, planPhase, specTask } from '../../src/core/planner.mjs';
import { approve, hasApproval, loadProject, PHASES, returnToPhase } from '../../src/core/project.mjs';
import { check } from '../../src/core/schemas.mjs';
import { writeJsonAtomic } from '../../src/core/workspace.mjs';
import { MAX_STAGE_RETURNS, retryStage, runDesignWorkflow, sendBack } from '../../src/design/manager.mjs';
import { CHECKS, isSuperseded, loadMethodologies, readiness, sectionUse, writeLockedPages } from '../../src/design/spec.mjs';
import { createBudget, limitedWorker } from '../../src/core/spend.mjs';
import { classifyGate } from '../../src/design/release.mjs';
import { tokensFromDirection } from '../../src/site/tokens.mjs';
import { newProject } from './helpers.mjs';

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
    'design/section-plan.json': { pages: [{ slug: '/', sections: [section('promise', 'statement', { motion: ['rise', 'cta-rule', 'count', 'settle', 'drift'] }), section('quote-rule', 'editorial-split'), section('old-houses', 'asymmetric', { assets: [] }), section('process', 'list-editorial', { assets: [] }), section('proof', 'quote-feature', { assets: [] })] }] },
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

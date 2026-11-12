import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advanceProject, exitBlockers, nextPhase } from '../../src/core/advance.mjs';
import { addTask } from '../../src/core/board.mjs';
import { deploy, smokeTest, startPreview, writeReport } from '../../src/core/deliver.mjs';
import { PermissionDenied } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { advancePhase, approve, loadProject, PHASES } from '../../src/core/project.mjs';
import { writeJsonAtomic } from '../../src/core/workspace.mjs';
import { newProject, task } from './helpers.mjs';

const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const HARNESS = join(process.cwd());

// Puts a project in `phase` directly, as if its earlier phases were done.
function inPhase(phase) {
  const p = newProject();
  const file = join(p.opts.workspace, p.project, 'project.json');
  writeJsonAtomic(file, { ...JSON.parse(readFileSync(file, 'utf8')), phase });
  ledger.append(p.project, { actor: 'cli', type: 'phase_transition', data: { from: 'CREATED', to: phase } }, p.opts);
  p.dir = join(p.opts.workspace, p.project);
  return p;
}

const gateResult = (gate, status) => ({ gate, gateVersion: '1.0.0', status, startedAt: '2026-10-29T00:00:00Z', finishedAt: '2026-10-29T00:00:01Z', findings: status === 'pass' ? [] : [{ id: 'x', severity: 'serious', message: 'x' }], evidence: [] });
function writeGates(dir, statuses) {
  mkdirSync(join(dir, 'evidence', 'gates'), { recursive: true });
  for (const [gate, status] of Object.entries(statuses)) writeFileSync(join(dir, 'evidence', 'gates', `${gate}.json`), JSON.stringify(gateResult(gate, status)));
}
const ALL_GATES = ['content-parity', 'claims', 'licences', 'secrets', 'seo', 'dependencies', 'routes', 'accessibility', 'forms', 'interactions', 'responsive', 'design-fidelity', 'visual-review', 'performance'];

test('a phase with no exit gate moves on; intake needs its brief and B1', () => {
  const { project, opts } = newProject();
  assert.deepEqual(advanceProject(project, opts), { from: 'CREATED', to: 'INTAKE' });
  const blockers = exitBlockers(project, opts);
  assert.ok(blockers.some((b) => /intake\/brief.json/.test(b)), blockers.join('; '));
  assert.ok(blockers.some((b) => /approval B1/.test(b)));
  assert.throws(() => advanceProject(project, opts), (e) => e instanceof PermissionDenied && /cannot leave INTAKE/.test(e.message));
  assert.equal(loadProject(project, opts).phase, 'INTAKE');
  assert.equal(ledger.read(project, opts).at(-1).type, 'refusal');
});

test('unfinished or blocked tasks for the phase’s agents hold the phase', () => {
  const p = inPhase('BUILD');
  addTask(p.project, task('hero'), p.opts);
  mkdirSync(join(p.dir, 'site', 'dist'), { recursive: true });
  writeFileSync(join(p.dir, 'site', 'dist', 'index.html'), '<html></html>');
  assert.deepEqual(exitBlockers(p.project, p.opts), ['task hero is pending']);
});

test('the technical plan refuses two tasks that own the same file', () => {
  const p = inPhase('TECHNICAL_PLAN');
  addTask(p.project, task('a', { agent: 'lead-developer', owns_files: ['site/src/**'] }), p.opts);
  addTask(p.project, task('b', { agent: 'lead-developer', owns_files: ['site/src/Hero.astro'] }), p.opts);
  assert.ok(exitBlockers(p.project, p.opts).some((b) => /a and b both own/.test(b)));
});

test('quality review goes to repair below the floor and to preview once every gate passes', () => {
  const p = inPhase('QUALITY_REVIEW');
  writeGates(p.dir, Object.fromEntries(ALL_GATES.map((g) => [g, g === 'seo' ? 'fail' : 'pass'])));
  assert.equal(nextPhase(p.project, p.opts), 'REPAIR');
  assert.deepEqual(advanceProject(p.project, p.opts), { from: 'QUALITY_REVIEW', to: 'REPAIR' });
  advancePhase(p.project, 'QUALITY_REVIEW', p.opts);
  writeGates(p.dir, { seo: 'pass' });
  assert.equal(nextPhase(p.project, p.opts), 'PREVIEW_REPORT');
  assert.deepEqual(advanceProject(p.project, p.opts), { from: 'QUALITY_REVIEW', to: 'PREVIEW_REPORT' });
});

test('preview needs a deploy that passed its smoke test, and B6', () => {
  const p = inPhase('PREVIEW_REPORT');
  assert.deepEqual(exitBlockers(p.project, p.opts).length, 2);
  ledger.append(p.project, { actor: 'cli', type: 'note', data: { event: 'deployment', target: 'preview', url: 'https://x.vercel.app', smoke: 'pass', mock: false } }, p.opts);
  approve(p.project, 'B6', p.opts);
  assert.deepEqual(exitBlockers(p.project, p.opts), []);
});

test('a mock deploy counts only in mock mode', () => {
  const p = inPhase('PREVIEW_REPORT');
  approve(p.project, 'B6', p.opts);
  ledger.append(p.project, { actor: 'cli', type: 'note', data: { event: 'deployment', target: 'preview', url: 'https://m.vercel.app', smoke: 'pass', mock: true } }, p.opts);
  assert.equal(exitBlockers(p.project, p.opts).length, 1);
  process.env.FORGE_MOCK = '1';
  try {
    assert.deepEqual(exitBlockers(p.project, p.opts), []);
  } finally {
    delete process.env.FORGE_MOCK;
  }
});

// ---- deploy, preview, report ----

function harnessRoot(plugins) {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins }));
  writeFileSync(join(root, '.env'), '');
  return { root, dirs: [join(HARNESS, 'plugins')] };
}
function builtSite(dir, html = '<!doctype html><html><body><h1>Home</h1></body></html>') {
  mkdirSync(join(dir, 'site', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'site', 'dist', 'index.html'), html);
  mkdirSync(join(dir, 'site', 'src'), { recursive: true });
  writeFileSync(join(dir, 'site', 'src', 'site.json'), JSON.stringify({ forms: { contact: { fields: [{ name: 'email', type: 'email', required: true }] } } }));
}

after(() => delete process.env.FORGE_MOCK);

test('deploy (mock): a preview needs B5, installs the form function, and is recorded', async () => {
  process.env.FORGE_MOCK = '1';
  const p = inPhase('PREVIEW_REPORT');
  builtSite(p.dir);
  const h = harnessRoot({ vercel: true, 'form-function': true });
  await assert.rejects(deploy(p.project, { target: 'preview', ...p.opts, ...h }), /B5 not recorded/);
  approve(p.project, 'B5', p.opts);
  const r = await deploy(p.project, { target: 'preview', ...p.opts, ...h, env: {} });
  assert.match(r.url, /vercel\.app$/);
  assert.equal(r.forms, 'installed');
  const note = ledger.read(p.project, p.opts).findLast((e) => e.data?.event === 'deployment');
  assert.deepEqual([note.data.target, note.data.smoke, note.data.mock], ['preview', 'pass', true]);
  delete process.env.FORGE_MOCK;
});

test('deploy refuses production outside the production phase, and a site holding a secret', async () => {
  process.env.FORGE_MOCK = '1';
  const p = inPhase('PREVIEW_REPORT');
  builtSite(p.dir, `<!doctype html><html><script>const k="${GITHUB}"</script></html>`);
  const h = harnessRoot({ vercel: true });
  approve(p.project, 'B5', p.opts);
  await assert.rejects(deploy(p.project, { target: 'production', ...p.opts, ...h }), /production deploy happens in PRODUCTION_DEPLOY/);
  await assert.rejects(deploy(p.project, { target: 'preview', ...p.opts, ...h, secrets: [] }), (e) => e instanceof PermissionDenied && /secret/.test(e.message) && !e.hint.includes(GITHUB));
  delete process.env.FORGE_MOCK;
});

test('preview serves the built site through the local-preview plugin and smoke-tests it', async () => {
  const p = inPhase('PREVIEW_REPORT');
  builtSite(p.dir);
  const h = harnessRoot({ 'local-preview': true });
  const server = await startPreview(p.project, { ...p.opts, ...h, env: {} });
  try {
    assert.equal(server.smoke.ok, true);
    assert.equal(server.smoke.robots, 'noindex');
  } finally {
    await server.close();
  }
  const disabled = harnessRoot({});
  await assert.rejects(startPreview(p.project, { ...p.opts, ...disabled, env: {} }), /not enabled/);
});

test('the smoke test does not count a sign-in redirect or another page as the site', async () => {
  const redirect = async () => ({ status: 302, headers: new Headers({ location: 'https://vercel.com/sso-api?url=x' }), text: async () => '' });
  const r = await smokeTest('https://site.vercel.app/', { fetchFn: redirect });
  assert.deepEqual([r.ok, r.protected, r.redirect], [false, true, 'https://vercel.com/sso-api']);
  const other = async () => ({ status: 200, headers: new Headers(), text: async () => '<html><title>Log in to Vercel</title></html>' });
  assert.equal((await smokeTest('https://site.vercel.app/', { fetchFn: other, expectTitle: 'Harbor Home' })).ok, false);
  const ours = async () => ({ status: 200, headers: new Headers(), text: async () => '<html><title>Harbor Home</title></html>' });
  assert.equal((await smokeTest('https://site.vercel.app/', { fetchFn: ours, expectTitle: 'Harbor Home' })).ok, true);
});

test('the smoke test fails a site that does not answer with HTML', async () => {
  assert.equal((await smokeTest('http://x', { fetchFn: async () => ({ status: 500, text: async () => 'oops', headers: new Headers() }) })).ok, false);
  assert.equal((await smokeTest('http://x', { fetchFn: async () => ({ status: 200, text: async () => '{}', headers: new Headers() }) })).ok, false);
  assert.equal((await smokeTest('http://x', { fetchFn: async () => { throw new Error('refused'); } })).ok, false);
});

test('the final report is built from the ledger and never repeats a secret', () => {
  const p = inPhase('HANDOFF');
  approve(p.project, 'B1', { ...p.opts, note: 'brief looks right' });
  addTask(p.project, task('hero'), p.opts);
  writeGates(p.dir, { seo: 'pass', routes: 'pass' });
  ledger.append(p.project, { actor: 'cli', type: 'note', data: { event: 'deployment', target: 'production', url: 'https://harbor.example', smoke: 'pass' } }, p.opts);
  ledger.append(p.project, { actor: 'cli', type: 'refusal', data: { action: 'deploy --production', reason: 'B7 not recorded' } }, p.opts);
  const { text } = writeReport(p.project, p.opts);
  for (const s of ['## Approvals', '| B1 |', 'brief looks right', '| hero | builder | pending', '| seo | pass |', 'production: https://harbor.example (smoke test pass', 'deploy --production: B7 not recorded']) {
    assert.ok(text.includes(s), `report is missing: ${s}`);
  }
  assert.ok(PHASES.some((ph) => text.includes(ph.name)));
});

test('handoff writes a growth roadmap from the project records, and claims no measurement', () => {
  const p = inPhase('HANDOFF');
  writeJsonAtomic(join(p.dir, 'design', 'section-plan.json'), { pages: [{ slug: '/', sections: [{ id: 'home-finder', pattern: 'interactive-finder' }, { id: 'home-story', pattern: 'editorial' }] }] });
  writeJsonAtomic(join(p.dir, 'research', 'crux.json'), { buckets: { about: { items: [], gaps: [] }, whatWeDo: { items: [], gaps: [] }, ourWork: { items: [], gaps: ['Which finished jobs can we show?'] }, resourceHub: { items: [], gaps: [] }, reachUs: { items: [], gaps: [] } } });
  writeJsonAtomic(join(p.dir, 'reports', 'defects.json'), { defects: [{ id: 'D-004', status: 'escalated', gate: 'performance', message: '/ Largest Contentful Paint is 3002 ms' }, { id: 'D-001', status: 'verified', gate: 'seo', message: 'fixed' }] });
  writeJsonAtomic(join(p.dir, 'reports', 'release-checks.json'), { rows: [{ gate: 'seo', outcome: 'blocked', reason: 'no site URL' }, { gate: 'routes', outcome: 'passed' }] });
  const { roadmap } = writeReport(p.project, p.opts);
  const text = readFileSync(roadmap, 'utf8');
  for (const s of ['# Growth roadmap', 'nothing in it has been measured yet', '`home-finder` on / (interactive-finder)', 'No analytics is installed', 'D-004 (escalated, performance)', 'Release check seo blocked: no site URL', 'Content gap (ourWork): Which finished jobs can we show?']) {
    assert.ok(text.includes(s), `roadmap is missing: ${s}`);
  }
  assert.ok(!text.includes('home-story'), 'only interactive sections are listed to measure');
  assert.ok(!text.includes('D-001'), 'verified defects are not backlog');
  assert.ok(ledger.read(p.project, p.opts).some((e) => e.data?.event === 'report' && e.data.roadmap === 'reports/gdd-roadmap.md'));
});

// Workflow 2, Stage 3 and 4: the team's walkthrough before B6, and the They Ask, You Answer growth loop.
test('a preview that passes writes the team review page: the link, every page, the five parameters, open defects, B6', async () => {
  process.env.FORGE_MOCK = '1';
  const p = inPhase('PREVIEW_REPORT');
  builtSite(p.dir);
  writeJsonAtomic(join(p.dir, 'intake', 'brief.json'), { client: { name: 'Harbor Home' }, pages: [{ slug: '/', title: 'Home', purpose: 'Start an enquiry', cta: 'Book a visit' }, { slug: '/contact', title: 'Contact', purpose: 'Book the visit', cta: 'Send' }] });
  writeJsonAtomic(join(p.dir, 'reports', 'defects.json'), { defects: [{ id: 'D-002', status: 'escalated', gate: 'performance', message: '/ Largest Contentful Paint is 3002 ms' }, { id: 'D-001', status: 'verified', gate: 'seo', message: 'fixed' }] });
  writeGates(p.dir, { routes: 'pass', forms: 'pass', performance: 'fail', responsive: 'pass' });
  approve(p.project, 'B5', p.opts);
  const h = harnessRoot({ vercel: true, 'form-function': true });
  const r = await deploy(p.project, { target: 'preview', ...p.opts, ...h, env: {} });
  delete process.env.FORGE_MOCK;
  assert.equal(r.demo.replace(/\\/g, '/').endsWith('reports/preview-demo.md'), true);
  const text = readFileSync(join(p.dir, 'reports', 'preview-demo.md'), 'utf8');
  const url = r.url.replace(/\/$/, '');
  for (const s of [
    '# Team review: Harbor Home', `Preview: ${url}`,
    `| Home | ${url}/ | Start an enquiry | Book a visit |`, `| Contact | ${url}/contact | Book the visit | Send |`,
    '### Usability', 'Automated: routes pass, forms pass, interactions not run, performance fail.', '- [ ] Each form sends',
    '### Design', '### Creativity', '### Content', '### Responsiveness', 'Automated: responsive pass.',
    '- D-002 (escalated, performance): / Largest Contentful Paint is 3002 ms',
    `\`forge approve ${p.project} B6 --note`, `\`forge reject ${p.project} B6 --note`,
  ]) assert.ok(text.includes(s), `the review page is missing: ${s}`);
  assert.ok(!text.includes('D-001'), 'a verified defect is not open');
  assert.ok(ledger.read(p.project, p.opts).some((e) => e.data?.event === 'preview_demo' && e.data.url === url));
});

test('the growth roadmap runs the They Ask, You Answer loop and sends unanswered buyer questions back to Step 1', () => {
  const p = inPhase('HANDOFF');
  writeJsonAtomic(join(p.dir, 'intake', 'brief.json'), { client: { name: 'Harbor Home' }, audience: [{ segment: 'Homeowners', need: 'A fair price', arrivesFrom: ['Instagram', 'search'] }], features: { forms: [{ id: 'visit', purpose: 'Book a home visit' }] } });
  writeJsonAtomic(join(p.dir, 'design', 'section-plan.json'), { pages: [
    { slug: '/', flow: 'primary', sections: [{ id: 'home-hero', pattern: 'statement', hierarchyStep: 1 }, { id: 'home-calculator', pattern: 'overlap', hierarchyStep: 4, media: 'x-factor-tool' }, { id: 'home-faq', pattern: 'list-editorial', hierarchyStep: 6 }] },
    { slug: '/landlords', flow: 'primary', audienceView: 'Landlords', sections: [{ id: 'landlord-hero', pattern: 'statement', hierarchyStep: 1 }] },
  ] });
  writeJsonAtomic(join(p.dir, 'research', 'crux.json'), { buckets: { about: { items: [], gaps: [] }, whatWeDo: { items: [], gaps: [] }, ourWork: { items: [], gaps: [] }, resourceHub: { items: [], gaps: [] }, reachUs: { items: [], gaps: [] } }, buyerQuestions: [
    { question: 'What does a kitchen cost?', category: 'pricing', gap: 'What is the usual price range?' },
    { question: 'Is a fixed quote better?', category: 'comparisons', source: 'brief' },
  ] });
  const text = readFileSync(writeReport(p.project, p.opts).roadmap, 'utf8');
  for (const s of [
    '## The growth loop (They Ask, You Answer)',
    'Traffic -> audience views -> Big 5 answers and tools -> qualified leads -> measurement -> new buyer questions back into the Truth Doc.',
    '1. **Traffic.** Visitors arrive from: Instagram, search.',
    '2. **Audience views.** Paths per visitor: Landlords (/landlords).',
    '3. **Big 5 answers and tools.** Where the site answers buyers: `home-calculator` on /, `home-faq` on /. 1 of 2 buyer question(s) are answered from a source.',
    '4. **Qualified leads.** Forms: Book a home visit.',
    '5. **Measurement feeds Step 1.**', 'research/crux.json buyerQuestions', '`forge facts <project> confirm`',
    '- (pricing) What does a kitchen cost? Ask the client: What is the usual price range?',
  ]) assert.ok(text.includes(s), `the roadmap is missing: ${s}`);
});

test('the QA report lists the screenshots it judged, by page and viewport', async () => {
  const { writeQaReport } = await import('../../src/qa/report.mjs');
  const p = inPhase('QUALITY_REVIEW');
  mkdirSync(join(p.dir, 'evidence', 'visual'), { recursive: true });
  for (const f of ['home-desktop-hero.jpg', 'home-desktop-faq.jpg', 'home-mobile-hero.jpg', 'contact-mobile-form.jpg']) writeFileSync(join(p.dir, 'evidence', 'visual', f), 'x');
  writeQaReport(p.dir, p.project, { review: 1, qualityFloor: { met: true, failing: [] }, defects: [] }, [gateResult('responsive', 'pass')], new Date('2026-11-12T00:00:00Z'));
  const text = readFileSync(join(p.dir, 'reports', 'qa-report.md'), 'utf8');
  assert.match(text, /## By parameter[\s\S]*\| Responsiveness \|/);
  assert.match(text, /## Screenshots by page\n\n\| Page \| Viewport \| Screenshots \|/);
  assert.ok(text.includes('| home | desktop | 2: evidence/visual/home-desktop-faq.jpg, evidence/visual/home-desktop-hero.jpg |'));
  assert.ok(text.includes('| contact | mobile | 1: evidence/visual/contact-mobile-form.jpg |'));
});

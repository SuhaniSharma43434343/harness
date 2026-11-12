import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestGateResults } from './advance.mjs';
import { listTasks } from './board.mjs';
import { ConfigMissing, PermissionDenied, Unavailable } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { getPlugin } from './plugins.mjs';
import { PHASES, approvals, loadProject } from './project.mjs';
import { redactText, scanPaths } from './redact.mjs';
import { assertProjectExists } from './workspace.mjs';
import { PARAMETERS } from '../qa/report.mjs';

// Preview, deploy and report (P13 to P15). A built site is scanned for secrets before it is
// served or deployed, every deploy is smoke-tested at its URL, and the result goes in the
// ledger, which is what the phase exits and the final report read.

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

function builtSite(project, opts) {
  const { dir } = assertProjectExists(project, opts);
  const dist = join(dir, 'site', 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new ConfigMissing(`${project} has no built site`, { hint: `Run forge site ${project} --build first.` });
  return { dir, dist };
}

// Refuses a site that would publish a credential or an .env file.
export function assertNoSecrets(project, dist, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  const rel = dist.slice(dir.length + 1);
  const findings = scanPaths([rel], { root: dir, secrets: opts.secrets });
  if (findings.length) {
    ledger.append(project, { actor: 'cli', type: 'refusal', data: { action: 'publish site', reason: `${findings.length} possible secret(s) in the built site`, files: findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ''} ${f.id}`) } }, opts);
    throw new PermissionDenied(`The built site holds ${findings.length} possible secret(s)`, { hint: findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ''} ${f.id}`).join('\n'), details: findings });
  }
}

// A deployed or served site answers 200 at its root, from its own host, with the page we built.
// A redirect to another host (for example Vercel's sign-in page in front of a protected
// preview) is not the site, so it fails with `protected: true`. `expectTitle` is the <title>
// of the built index.html.
export async function smokeTest(url, { fetchFn = fetch, timeoutMs = 20_000, expectTitle } = {}) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    const robots = res.headers?.get?.('x-robots-tag') ?? null;
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers?.get?.('location') ?? '';
      const other = to && new URL(to, url).host !== new URL(url).host;
      return { ok: false, status: res.status, robots, protected: Boolean(other), redirect: to.split('?')[0] };
    }
    const text = await res.text();
    const title = text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    const ok = res.status === 200 && /<html[\s>]/i.test(text) && (!expectTitle || title === expectTitle);
    return { ok, status: res.status, robots, title };
  } catch (err) {
    return { ok: false, status: null, error: err.message };
  }
}

// The <title> of a built site's home page, for the smoke test.
export function builtTitle(dist) {
  const file = join(dist, 'index.html');
  return existsSync(file) ? readFileSync(file, 'utf8').match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() : undefined;
}

// forge preview: serves the built site locally through the local-preview plugin.
export async function startPreview(project, opts = {}) {
  const { dist } = builtSite(project, opts);
  assertNoSecrets(project, dist, opts);
  const plugin = await getPlugin('local-preview', { ...opts, project });
  const server = await plugin.actions.start({ dir: dist, port: opts.port ?? 0 });
  const smoke = await smokeTest(server.url, { ...opts, expectTitle: builtTitle(dist) });
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'local_preview', url: server.url, smoke: smoke.ok ? 'pass' : 'fail' } }, opts);
  return { ...server, smoke };
}

// forge deploy: a Vercel preview (needs B5) or production deploy (needs B5 and B7), with the
// form function installed when the site has forms, and a smoke test at the deployed URL.
export async function deploy(project, { target = 'preview', ...opts } = {}) {
  const { dir, dist } = builtSite(project, opts);
  const { phase } = loadProject(project, opts);
  if (target === 'production' && phase !== 'PRODUCTION_DEPLOY') {
    ledger.append(project, { actor: 'cli', type: 'refusal', data: { action: 'deploy --production', reason: `the project is in ${phase}, not PRODUCTION_DEPLOY` } }, opts);
    throw new PermissionDenied(`A production deploy happens in PRODUCTION_DEPLOY; ${project} is in ${phase}`, { hint: 'Accept the preview (B6) and advance first.' });
  }
  assertNoSecrets(project, dist, opts);

  const site = readJson(join(dir, 'site', 'src', 'site.json'));
  const forms = site?.forms ?? {};
  let formsNote = null;
  if (Object.keys(forms).length) {
    try {
      const formPlugin = await getPlugin('form-function', { ...opts, project });
      await formPlugin.actions.install(dist, { forms });
      formsNote = 'installed';
    } catch (err) {
      formsNote = `not connected: ${err.message}`;
    }
  }

  const vercel = await getPlugin('vercel', { ...opts, project });
  const action = target === 'production' ? vercel.actions.deployProduction : vercel.actions.deployPreview;
  const out = await action({ dir: dist, name: project });
  // A mock deploy has no real URL to fetch.
  const smoke = vercel.mock ? { ok: true, status: 200, mock: true } : await smokeTest(out.url, { ...opts, expectTitle: builtTitle(dist) });
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'deployment', target, url: out.url, id: out.id, smoke: smoke.ok ? 'pass' : smoke.protected ? 'protected' : 'fail', status: smoke.status, forms: formsNote, mock: vercel.mock } }, opts);
  if (smoke.protected) {
    throw new PermissionDenied(`The ${target} deploy at ${out.url} is behind Vercel's sign-in, so it could not be checked`, {
      hint: 'It opens for people signed in to the Vercel team. To check it here, turn off Vercel Authentication for previews (Project Settings > Deployment Protection), then deploy again.',
    });
  }
  if (!smoke.ok) throw new Unavailable(`The ${target} deploy at ${out.url} failed its smoke test (status ${smoke.status ?? smoke.error})`);
  // A preview that passed is what the team walks through before B6.
  const demo = target === 'preview' ? writePreviewDemo(project, { url: out.url, ...opts }).file : undefined;
  return { ...out, target, smoke, forms: formsNote, ...(demo ? { demo } : {}) };
}

// reports/preview-demo.md: the team's walkthrough of the preview before B6. Built from the brief, the
// section plan, the open defects and the latest gate results, so it says no more than they do.
const DEMO_CHECKS = {
  Usability: ['Every link, button and menu works, on a phone too', 'Each form sends, and shows its error state when something is missing', 'The pages open quickly on a phone connection'],
  Design: ['It looks like the direction chosen at B2: colours, type, the navigation bar and the buttons', 'Text is easy to read, and keyboard focus is visible'],
  Creativity: ['The first screen has a hook you would remember, not a template', 'The signature move is there and nothing is decoration for its own sake'],
  Content: ['Every word matches the copy approved at B3, with no placeholder text', 'Every fact is true; anything unknown is left out, not guessed'],
  Responsiveness: ['On a phone, a tablet and a laptop nothing is cut off or overlapping', 'Buttons and links are easy to tap'],
};
export function writePreviewDemo(project, { url, ...opts } = {}) {
  const { dir } = assertProjectExists(project, opts);
  const brief = readJson(join(dir, 'intake', 'brief.json')) ?? {};
  const plan = readJson(join(dir, 'design', 'section-plan.json'));
  const defects = (readJson(join(dir, 'reports', 'defects.json'))?.defects ?? []).filter((d) => d.status !== 'verified');
  const results = new Map(latestGateResults(dir).map((r) => [r.gate, r.status]));
  const pages = brief.pages ?? (plan?.pages ?? []).map((p) => ({ slug: p.slug }));
  const base = String(url ?? '').replace(/\/$/, '');
  const L = [`# Team review: ${brief.client?.name ?? project}`, ''];
  L.push(`Preview: ${base || '(not deployed yet)'}`, '', 'Share this page and the link with the team. Walk through every page on a phone and on a laptop, then record the decision:', '');
  L.push(`- Accept the preview: \`forge approve ${project} B6 --note "<who reviewed it>"\``, `- Turn it down: \`forge reject ${project} B6 --note "<what must change>"\` (the reason becomes a rule for the agent whose work it was)`, '');
  L.push('## Pages to walk through', '', '| Page | Link | What it is for | Its call to action |', '| --- | --- | --- | --- |');
  for (const p of pages) L.push(`| ${p.title ?? p.slug} | ${base}${p.slug} | ${p.purpose ?? ''} | ${p.cta ?? ''} |`);
  L.push('');
  L.push('## Check under the five parameters', '');
  for (const param of PARAMETERS) {
    const auto = param.gates.map((g) => `${g} ${results.get(g) ?? 'not run'}`).join(', ');
    L.push(`### ${param.name}`, '', `Automated: ${auto}.`, '', ...DEMO_CHECKS[param.name].map((c) => `- [ ] ${c}`), '');
  }
  L.push('## Open defects', '');
  L.push(...(defects.length ? defects.map((d) => `- ${d.id} (${d.status}, ${d.gate}): ${String(d.message).replace(/\s+/g, ' ').slice(0, 160)}`) : ['- None open.']), '');
  const file = join(dir, 'reports', 'preview-demo.md');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(file, redactText(L.join('\n'), opts.secrets ? { secrets: opts.secrets } : undefined));
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'preview_demo', file: 'reports/preview-demo.md', url: base || null } }, opts);
  return { file };
}

// forge report: reports/final-report.md, built from the ledger, the board and the evidence.
// The They Ask, You Answer growth loop: traffic reaches the audience views, the Big 5 answers and the
// tools turn visitors into qualified leads, and what is measured brings new buyer questions back to
// the Truth Doc (Step 1). Each step lists what this site has for it, from the project records.
function growthLoop(dir, brief, plan, crux) {
  const positioning = readJson(join(dir, 'research', 'positioning.json'));
  const sections = (plan?.pages ?? []).flatMap((p) => p.sections.map((s) => ({ ...s, slug: p.slug })));
  const from = [...new Set((brief?.audience ?? []).flatMap((a) => a.arrivesFrom ?? []))];
  const views = (plan?.pages ?? []).filter((p) => p.audienceView).map((p) => `${p.audienceView} (${p.slug})`);
  const personas = (positioning?.personas ?? []).map((x) => `${x.segment}: ${x.desiredAction}`);
  const answers = sections.filter((s) => s.hierarchyStep === 6 || s.media === 'x-factor-tool').map((s) => `\`${s.id}\` on ${s.slug}`);
  const questions = crux?.buyerQuestions ?? [];
  const answered = questions.filter((q) => q.source && !q.gap);
  const open = questions.filter((q) => q.gap);
  const L = ['## The growth loop (They Ask, You Answer)', ''];
  L.push('Traffic -> audience views -> Big 5 answers and tools -> qualified leads -> measurement -> new buyer questions back into the Truth Doc.', '');
  L.push(`1. **Traffic.** Visitors arrive from: ${from.length ? from.join(', ') : 'not recorded in the brief; find out from the analytics once it is installed'}.`);
  L.push(`2. **Audience views.** ${views.length ? `Paths per visitor: ${views.join(', ')}.` : personas.length ? `One path per persona: ${personas.join('; ')}.` : 'No separate paths were planned.'}`);
  L.push(`3. **Big 5 answers and tools.** ${answers.length ? `Where the site answers buyers: ${answers.join(', ')}.` : 'No deep-FAQ or tool sections were planned.'} ${answered.length} of ${questions.length} buyer question(s) are answered from a source.`);
  L.push(`4. **Qualified leads.** ${(brief?.features?.forms ?? []).length ? `Forms: ${brief.features.forms.map((f) => f.purpose).join('; ')}.` : 'No form; leads come through the calls to action.'}`);
  L.push('5. **Measurement feeds Step 1.** The questions people search for, type into forms or ask on calls are added to research/crux.json buyerQuestions; the Truth Doc is confirmed again (`forge facts <project> confirm`), and the next pages answer them.', '');
  if (open.length) L.push('Write these first after launch: buyer questions the client has not answered yet.', '', ...open.map((q) => `- (${q.category}) ${q.question} Ask the client: ${q.gap}`), '');
  return L;
}

// reports/gdd-roadmap.md: the site as the baseline for growth-driven design. Everything in it is
// derived from the project's own records: what to measure comes from the interactive parts the plan
// built, and the backlog from what is unfinished. Nothing is measured yet, and it says so.
const INTERACTIVE = /finder|filter|accordion|faq|carousel|stories|tabs|toggle|calculator|estimator|quiz|switcher|form|game|scene|3d|map/i;
export function writeGrowthRoadmap(project, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  const brief = readJson(join(dir, 'intake', 'brief.json'));
  const plan = readJson(join(dir, 'design', 'section-plan.json'));
  const crux = readJson(join(dir, 'research', 'crux.json'));
  const defects = readJson(join(dir, 'reports', 'defects.json'));
  const release = readJson(join(dir, 'reports', 'release-checks.json'));
  const facts = readJson(join(dir, 'intake', 'facts.json'));
  const lines = [`# Growth roadmap: ${brief?.client?.name ?? project}`, '', 'Growth-driven design treats the launched site as a baseline. This roadmap is generated at handoff from the project records; nothing in it has been measured yet.', ''];

  lines.push('## What to measure', '');
  const parts = [];
  for (const page of plan?.pages ?? []) for (const s of page.sections) if (INTERACTIVE.test(`${s.id} ${s.pattern}`)) parts.push(`- \`${s.id}\` on ${page.slug} (${s.pattern})`);
  for (const f of brief?.features?.forms ?? []) parts.push(`- Form \`${f.id}\`: ${f.purpose} (destination: ${f.destination})`);
  lines.push(...(parts.length ? parts : ['- No interactive section was planned.']), '');
  lines.push('No analytics is installed. Counting these needs an analytics plugin, a consent decision for visitors, and the operator\'s B5.', '');

  lines.push('## Backlog from this build', '');
  const backlog = [];
  for (const d of (defects?.defects ?? []).filter((x) => x.status !== 'verified')) backlog.push(`- ${d.id} (${d.status}, ${d.gate}): ${String(d.message).replace(/\s+/g, ' ').slice(0, 160)}`);
  for (const r of (release?.rows ?? []).filter((x) => x.outcome === 'blocked' || x.outcome === 'failed')) backlog.push(`- Release check ${r.gate} ${r.outcome}${r.reason ? `: ${r.reason}` : ''}`);
  for (const [key, b] of Object.entries(crux?.buckets ?? {})) for (const g of b.gaps) backlog.push(`- Content gap (${key}): ${g}`);
  for (const f of (facts?.facts ?? []).filter((x) => x.assumption)) backlog.push(`- Confirm with the client: \`${f.field}\` was assumed (${f.reason})`);
  lines.push(...(backlog.length ? backlog : ['- Nothing open in the project records.']), '');

  lines.push(...growthLoop(dir, brief, plan, crux));
  lines.push('## Month 2 and after', '');
  lines.push('Once there are a few weeks of visits: test the home headline against one alternative, move proof closer to the first call to action where visitors drop off, and add real case studies and testimonials as they arrive. Each change is decided by the numbers above, not by taste.', '');
  const file = join(dir, 'reports', 'gdd-roadmap.md');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(file, redactText(lines.join('\n'), opts.secrets ? { secrets: opts.secrets } : undefined));
  return { file };
}

export function writeReport(project, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  const state = loadProject(project, opts);
  const entries = ledger.read(project, opts);
  const tasks = listTasks(project, opts);
  const gates = latestGateResults(dir);
  const facts = readJson(join(dir, 'intake', 'facts.json'));
  const brief = readJson(join(dir, 'intake', 'brief.json'));
  const decision = readJson(join(dir, 'design', 'approach-decision.json'));
  const deploys = entries.filter((e) => e.type === 'note' && e.data?.event === 'deployment');
  const refusals = entries.filter((e) => e.type === 'refusal');
  const phaseId = PHASES.find((p) => p.name === state.phase).id;

  const lines = [`# Final report: ${brief?.client?.name ?? project}`, '', `Project \`${project}\`, phase ${phaseId} ${state.phase}, harness ${state.harnessVersion}. Built from the ledger (${entries.length} entries) on ${new Date().toISOString().slice(0, 10)}.`, ''];

  lines.push('## Approvals', '', '| Code | Recorded | Phase | Note |', '| --- | --- | --- | --- |');
  for (const a of approvals(project, opts)) {
    const e = entries.find((x) => x.seq === a.seq);
    lines.push(`| ${a.approval} | ${a.ts.slice(0, 16).replace('T', ' ')} | ${e?.data?.phase ?? ''} | ${a.note ?? ''} |`);
  }
  if (!approvals(project, opts).length) lines.push('| none | | | |');

  if (decision) {
    lines.push('', '## Approaches', '');
    for (const d of decision.decisions.filter((x) => x.selected)) lines.push(`- **${d.approach}**: ${d.reason}${d.fallback ? ` Fallback: ${d.fallback.description}.` : ''}`);
  }

  const assumed = (facts?.facts ?? []).filter((f) => f.assumption);
  lines.push('', '## Assumptions', '', assumed.length ? `${assumed.length} brief field(s) rest on a recommendation, not a client answer:` : 'None: every brief field came from the client.');
  for (const f of assumed) lines.push(`- \`${f.field}\`: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)} (${f.reason})`);

  lines.push('', '## Tasks', '', '| Task | Agent | Status | Attempts | Evidence |', '| --- | --- | --- | --- | --- |');
  for (const t of tasks) lines.push(`| ${t.id} | ${t.agent} | ${t.status}${t.blocked_reason ? `: ${t.blocked_reason}` : ''} | ${t.attempts ?? 0} | ${t.evidence.map((e) => `\`${e}\``).join(', ')} |`);
  if (!tasks.length) lines.push('| none | | | | |');

  lines.push('', '## Quality gates', '', '| Gate | Status | Findings |', '| --- | --- | --- |');
  for (const g of gates.sort((a, b) => a.gate.localeCompare(b.gate))) lines.push(`| ${g.gate} | ${g.status} | ${g.findings.length} |`);
  if (!gates.length) lines.push('| not run | | |');

  lines.push('', '## Deployments', '');
  if (!deploys.length) lines.push('None yet.');
  for (const d of deploys) lines.push(`- ${d.data.target}: ${d.data.url} (smoke test ${d.data.smoke}${d.data.mock ? ', mock' : ''}), ${d.ts.slice(0, 16).replace('T', ' ')}`);

  lines.push('', '## Refusals', '', refusals.length ? `${refusals.length} action(s) were refused:` : 'None.');
  for (const r of refusals) lines.push(`- ${r.data.action}: ${r.data.reason}`);
  lines.push('');

  const file = join(dir, 'reports', 'final-report.md');
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const text = redactText(lines.join('\n'), opts.secrets ? { secrets: opts.secrets } : undefined);
  writeFileSync(file, text);
  const roadmap = writeGrowthRoadmap(project, opts).file;
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'report', file: 'reports/final-report.md', roadmap: 'reports/gdd-roadmap.md' } }, opts);
  return { file, text, roadmap };
}

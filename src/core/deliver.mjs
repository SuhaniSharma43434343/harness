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
  return { ...out, target, smoke, forms: formsNote };
}

// forge report: reports/final-report.md, built from the ledger, the board and the evidence.
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
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'report', file: 'reports/final-report.md' } }, opts);
  return { file, text };
}

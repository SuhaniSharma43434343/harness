#!/usr/bin/env node
// A real, model-driven test of the design workflow on one sample brief: intake, the full
// specification, the build and visual QA. It spends model usage, so it needs --max-usd.
// Approvals are recorded with a note saying a test run gave them; never use this for a client.
//
//   node scripts/design-e2e.mjs samples/design-tests/<name> --model <model> --max-usd <n>
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designStatus, runDesignWorkflow } from '../src/design/manager.mjs';
import { DESIGN_QA_GATES } from '../src/cli/design.mjs';
import { approve, hasApproval, loadProject } from '../src/core/project.mjs';
import { openDefects } from '../src/qa/defects.mjs';
import { runRepairLoop } from '../src/qa/repair.mjs';
import { createClaudeCodeWorker } from '../src/workers/claude-code.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const sample = resolve(args[0]);
const model = flag('--model');
const maxUsd = Number(flag('--max-usd', 0));
if (!existsSync(sample) || !maxUsd) {
  console.error('Usage: node scripts/design-e2e.mjs samples/design-tests/<name> --model <model> --max-usd <n>');
  process.exit(2);
}
const workspace = join(root, 'workspace');
const brief = JSON.parse(readFileSync(join(sample, 'brief.json'), 'utf8'));
const project = brief.project;
const dir = join(workspace, project);
const opts = { workspace };
const note = 'given by scripts/design-e2e.mjs, a test run';
const forge = (...a) => {
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli', 'index.mjs'), ...a], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`forge ${a.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!existsSync(dir)) {
  forge('new', project, '--brief', join(sample, 'brief.json'));
  forge('intake', project, '--use-recommendations');
  for (const extra of ['material', 'public']) {
    const from = join(sample, extra);
    const to = extra === 'material' ? join(dir, 'intake', 'material') : join(dir, 'assets', 'public');
    if (existsSync(from)) {
      mkdirSync(to, { recursive: true });
      cpSync(from, to, { recursive: true });
    }
  }
  const photos = join(sample, 'unsplash-photos.json');
  if (existsSync(photos)) cpSync(photos, join(dir, 'assets', 'unsplash-photos.json'));
}

// What only an operator gives: the test records it, and names the direction it picks.
function giveApprovals() {
  const { phase } = loadProject(project, opts);
  if (phase === 'INTAKE' && !hasApproval(project, 'B1', opts)) approve(project, 'B1', { ...opts, note });
  if (phase === 'CREATIVE_DIRECTIONS' && !hasApproval(project, 'B2', opts)) {
    const file = join(dir, 'design', 'directions.json');
    if (existsSync(file)) {
      const d = JSON.parse(readFileSync(file, 'utf8'));
      const b2 = approve(project, 'B2', { ...opts, note });
      Object.assign(d, { status: 'chosen', chosen: d.chosen ?? d.directions[0].id, approval: { code: 'B2', ledgerSeq: b2.seq } });
      writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
      log('B2: chose', d.chosen);
    }
  }
  if (phase === 'CONTENT' && !hasApproval(project, 'B3', opts) && existsSync(join(dir, 'content', 'copy.json'))) approve(project, 'B3', { ...opts, note });
}

const worker = createClaudeCodeWorker({ model });
let result;
for (let i = 0; i < 30; i++) {
  giveApprovals();
  result = await runDesignWorkflow(project, { workspace, worker, maxUsd, onStep: (s) => log(s.phase, 'done:', s.done.join(', ') || '-', s.blocked.length ? `blocked: ${s.blocked}` : '', s.errors.length ? `errors: ${s.errors}` : '') });
  log('stopped in', result.stoppedAt, result.reason, ...(result.blockers ?? []).slice(0, 8), ...(result.problems ?? []).slice(0, 8));
  if (result.reason !== 'needs') break;
  const stillNeeds = (result.blockers ?? []).filter((b) => !/^approval /.test(b));
  giveApprovals();
  if (stillNeeds.length && !(result.blockers ?? []).some((b) => /^approval /.test(b))) break;
}

let qa = null;
if (result.reason === 'reached') {
  qa = await runRepairLoop(project, { workspace, worker, gates: DESIGN_QA_GATES });
  log('visual QA', qa.outcome, 'after', qa.loops, 'loops; open defects', openDefects(qa.report).length);
  for (const d of openDefects(qa.report)) log(' open', d.gate, d.finding, d.message.slice(0, 160));
}

// Cost comes from the recordings, so it covers every attempt in every session of this project.
let cost = 0;
const costs = {};
const rec = join(dir, 'evidence', 'recordings');
if (existsSync(rec)) {
  for (const t of readdirSync(rec)) {
    for (const f of readdirSync(join(rec, t))) {
      const c = JSON.parse(readFileSync(join(rec, t, f), 'utf8')).costUsd ?? 0;
      cost += c;
      costs[t] = (costs[t] ?? 0) + c;
    }
  }
}
const summary = {
  project,
  model,
  workflow: { stoppedAt: result.stoppedAt, reason: result.reason, blockers: result.blockers ?? [] },
  qa: qa && { outcome: qa.outcome, loops: qa.loops, open: openDefects(qa.report).map((d) => ({ gate: d.gate, finding: d.finding, message: d.message })) },
  spec: designStatus(project, opts).stages.map((s) => ({ stage: s.id, ok: s.ok })),
  costUsd: Math.round(cost * 100) / 100,
  costByTask: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, Math.round(v * 100) / 100])),
};
mkdirSync(join(dir, 'reports'), { recursive: true });
writeFileSync(join(dir, 'reports', 'design-e2e.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

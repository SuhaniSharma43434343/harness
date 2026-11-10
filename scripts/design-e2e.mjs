#!/usr/bin/env node
// A real, model-driven test of the design workflow on one sample brief. It gives no approval and
// edits nothing: at each approval it stops and says what it needs, and you run it again once the
// operator has answered with forge approve or forge design choose. Every run ends with all the
// release checks. Run it from a clean checkout, because it never removes an earlier run.
//
//   node scripts/design-e2e.mjs samples/design-tests/<name> --model <m> --site-usd <n> --total-usd <n> --spend-file <file>
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESIGN_QA_GATES } from '../src/cli/design.mjs';
import * as ledger from '../src/core/ledger.mjs';
import { loadProject } from '../src/core/project.mjs';
import { loadConfig } from '../src/core/config.mjs';
import { budgetsExhausted, createBudget, limitedWorker } from '../src/core/spend.mjs';
import { designStatus, runDesignWorkflow } from '../src/design/manager.mjs';
import { releaseChecks } from '../src/design/release.mjs';
import { openDefects } from '../src/qa/defects.mjs';
import { runRepairLoop } from '../src/qa/repair.mjs';
import { createClaudeCodeWorker } from '../src/workers/claude-code.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const sample = resolve(args[0] ?? '');
const model = flag('--model');
const siteUsd = Number(flag('--site-usd'));
const totalUsd = Number(flag('--total-usd'));
const spendFile = flag('--spend-file');
if (!existsSync(join(sample, 'brief.json')) || !siteUsd || !totalUsd || !spendFile) {
  console.error('Usage: node scripts/design-e2e.mjs samples/design-tests/<name> --model <m> --site-usd <n> --total-usd <n> --spend-file <file>');
  process.exit(2);
}
const workspace = join(root, 'workspace');
const project = JSON.parse(readFileSync(join(sample, 'brief.json'), 'utf8')).project;
const dir = join(workspace, project);
const opts = { workspace };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const forge = (...a) => {
  const r = spawnSync(process.execPath, [join(root, 'src', 'cli', 'index.mjs'), ...a], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`forge ${a.join(' ')} failed:\n${r.stdout}\n${r.stderr}`);
};

if (!existsSync(dir)) {
  forge('new', project, '--brief', join(sample, 'brief.json'));
  forge('intake', project, '--use-recommendations');
  for (const [from, to] of [['material', join(dir, 'intake', 'material')], ['public', join(dir, 'assets', 'public')]]) {
    if (!existsSync(join(sample, from))) continue;
    mkdirSync(to, { recursive: true });
    cpSync(join(sample, from), to, { recursive: true });
  }
  if (existsSync(join(sample, 'unsplash-photos.json'))) cpSync(join(sample, 'unsplash-photos.json'), join(dir, 'assets', 'unsplash-photos.json'));
}

const budgets = [createBudget({ file: join(dir, 'reports', 'spend.json'), limitUsd: siteUsd }), createBudget({ file: resolve(spendFile), limitUsd: totalUsd })];
const exhausted = () => budgetsExhausted(budgets);
const worker = limitedWorker(createClaudeCodeWorker({ model }), budgets, { parallel: loadConfig(root).config.concurrency });

const result = await runDesignWorkflow(project, { workspace, worker, budgetExhausted: exhausted, onStep: (s) => log(s.phase, 'tasks done:', s.done.length, s.blocked.length ? `blocked: ${s.blocked}` : '', s.errors.length ? `errors: ${s.errors}` : '') });
log('workflow stopped in', result.stoppedAt, '-', result.reason, ...(result.blockers ?? []), ...(result.problems ?? []).slice(0, 5));

let qa = null;
if (result.reason === 'reached') {
  qa = await runRepairLoop(project, { workspace, worker, gates: DESIGN_QA_GATES, budgetExhausted: exhausted, budgetRemaining: () => Math.min(...budgets.map((b) => b.remaining())) });
  log('visual QA:', qa.outcome, 'after', qa.loops, 'repair loops; open defects', openDefects(qa.report).length);
}

// Release checks only make sense on a build, and cost no model usage.
const release = existsSync(join(dir, 'site', 'dist', 'index.html')) && (qa || result.stoppedAt === 'QUALITY_REVIEW') ? await releaseChecks(project, opts) : null;
if (release) log('release checks:', JSON.stringify(release.summary));

// What a person did, from the ledger, so nothing is left out of the record.
const entries = ledger.read(project, opts);
const interventions = entries.filter((e) => e.actor === 'operator').map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, ...e.data }));
const recorded = {};
const rec = join(dir, 'evidence', 'recordings');
if (existsSync(rec)) {
  for (const t of readdirSync(rec)) {
    for (const f of readdirSync(join(rec, t))) recorded[t] = Math.round(((recorded[t] ?? 0) + (JSON.parse(readFileSync(join(rec, t, f), 'utf8')).costUsd ?? 0)) * 100) / 100;
  }
}
const summary = {
  project,
  model,
  commit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  phase: loadProject(project, opts).phase,
  workflow: { reason: result.reason, blockers: result.blockers ?? [], problems: result.problems ?? [] },
  qa: qa && { outcome: qa.outcome, loops: qa.loops, open: openDefects(qa.report).map((d) => ({ gate: d.gate, finding: d.finding, message: d.message })) },
  spec: designStatus(project, opts).stages.map((s) => ({ stage: s.id, ok: s.ok })),
  release: release?.summary ?? null,
  humanInterventions: interventions,
  returnsToEarlierStages: entries.filter((e) => e.data?.event === 'design_returned').map((e) => ({ stage: e.data.stage, problems: e.data.problems })),
  spentThisSiteUsd: budgets[0].spent(),
  spentTotalUsd: budgets[1].spent(),
  costByTask: recorded,
};
mkdirSync(join(dir, 'reports'), { recursive: true });
writeFileSync(join(dir, 'reports', 'design-e2e.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

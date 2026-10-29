#!/usr/bin/env node
// Release run (T28, acceptance A8): drives the three release websites through every built
// forge command, in phase order, and writes a report with the evidence each step left.
//
//   node scripts/release-run.mjs [business|showroom|story|all] [--fresh] [--repair | --model] [--out <dir>]
//
// The briefs are in samples/release/. Each run is the operator's own test, so the approvals
// the steps need (B1, B2, and an experimental approach's approval) are recorded with a note
// that says so. --repair also moves the project to QUALITY_REVIEW and runs the repair loop
// with the Claude Code builder (forge qa --repair), which needs Claude Code signed in. Every
// run tries forge advance after the QA review and reports where its exit gates stop; with
// --repair it records B3 and skips the exit gates that do not hold yet (advancePhase), so the
// repair loop can run, and the report names the phases it skipped. --model runs the whole
// workflow with Claude Code instead: the planner's tasks through forge run --advance, the
// operator's commands and approvals at each phase, up to a local preview (see modelPath).
//
// It never edits site code: anything a model would write is left to the repair loop, so a
// run without --repair shows what the deterministic pipeline gives and which gates still fail.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
export const SITES = {
  business: { brief: 'samples/release/business.json', approaches: ['APP-01', 'APP-02'] },
  showroom: { brief: 'samples/release/showroom.json', approaches: ['APP-03', 'APP-04', 'APP-07'] },
  story: { brief: 'samples/release/story.json', approaches: ['APP-05', 'APP-06', 'APP-08'] },
};
const PHASE_COUNT = 16;
const NOTE = 'release run (T28): recorded by the operator running scripts/release-run.mjs';

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function forge(args, { timeout = 900_000 } = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { args, code: r.status ?? (r.error ? -1 : 0), ms: Date.now() - started, stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? r.error.message : '') };
}

async function workspaceDir() {
  const { loadConfig } = await import('../src/core/config.mjs');
  const dir = loadConfig(ROOT).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(ROOT, dir);
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const lastSeq = (stdout) => Number(/ledger #(\d+)/.exec(stdout)?.[1]);
const tail = (text, n = 6) => text.trim().split('\n').slice(-n).join('\n');

export async function runSite(name, { fresh = false, repair = false, model = false } = {}) {
  const site = SITES[name];
  const brief = readJson(join(ROOT, site.brief));
  const project = brief.project;
  const workspace = await workspaceDir();
  const dir = join(workspace, project);
  const steps = [];
  const step = (label, args, opts) => {
    const r = forge(args, opts);
    steps.push({ label, ...r });
    return r;
  };
  const approve = (code, why) => step(`approve ${code}`, ['approve', project, code, '--note', `${NOTE}; ${why}`]);

  if (fresh) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(join(dir, 'project.json'))) step('new (P0)', ['new', project, '--brief', site.brief]);
  step('intake (P1)', ['intake', project, '--use-recommendations']);
  approve('B1', 'brief and estimate reviewed');
  const ctx = { site, project, workspace, dir, steps, step, approve };
  const out = model ? await modelPath(ctx) : await commandPath(ctx, { repair });
  const defectsFile = join(dir, 'reports', 'defects.json');
  const defects = existsSync(defectsFile) ? readJson(defectsFile) : null;
  return {
    site: name,
    project,
    brief: site.brief,
    planned: site.approaches,
    selected: out.selected,
    repair: repair || model,
    model,
    steps: steps.map(({ label, args, code, ms, stdout, stderr }) => ({ label, command: args.length ? `forge ${args.join(' ')}` : '(script)', code, ms, output: code === 0 ? tail(stdout) : tail(`${stdout}\n${stderr}`, 20) })),
    gates: out.results.map((r) => ({ gate: r.gate, status: r.status, findings: r.findings.length, ids: [...new Set(r.findings.map((f) => f.id))], error: r.error?.message })),
    qualityFloor: out.floor,
    phase: (await import('../src/core/project.mjs')).loadProject(project, { workspace }).phase,
    defects: defects ? { review: defects.review, open: defects.defects.filter((d) => d.status === 'open').length, total: defects.defects.length } : null,
    evidence: relative(ROOT, join(dir, 'evidence')).split('\\').join('/'),
  };
}

// B2: the operator picks the top-ranked direction, and marks it chosen as QUICKSTART step 4 says.
function chooseDirection({ dir, approve }) {
  const b2 = approve('B2', 'top-ranked direction chosen');
  const directionsFile = join(dir, 'design', 'directions.json');
  if (existsSync(directionsFile) && lastSeq(b2.stdout)) {
    const d = readJson(directionsFile);
    if (d.status !== 'chosen') {
      Object.assign(d, { status: 'chosen', chosen: d.directions[0].id, approval: { code: 'B2', ledgerSeq: lastSeq(b2.stdout) } });
      writeFileSync(directionsFile, JSON.stringify(d, null, 2) + '\n');
    }
  }
}

// Applies every selected approach, then builds again so dist/ has their sections and packages.
function applyApproaches({ project, dir, step, approve }) {
  const decisionFile = join(dir, 'design', 'approach-decision.json');
  const decisions = existsSync(decisionFile) ? readJson(decisionFile).decisions : [];
  const selected = decisions.filter((d) => d.selected).map((d) => d.approach);
  for (const d of decisions.filter((x) => x.selected && x.approach !== 'APP-01')) {
    if (d.needsApproval) approve(d.needsApproval, `experimental ${d.approach} accepted`);
    step(`approach ${d.approach}`, ['approach', project, d.approach]);
  }
  if (selected.length > 1) step('site --build-only (after approaches)', ['site', project, '--build-only']);
  return selected;
}

function gateResults(r) {
  try {
    const { qualityFloor, results } = JSON.parse(r.stdout);
    return { floor: qualityFloor, results };
  } catch {
    return { floor: null, results: [] };
  }
}

// Without a model: every forge command in phase order on the scaffold, then forge advance as
// far as the exit gates allow. --repair adds the repair loop with Claude Code.
async function commandPath({ project, workspace, dir, step, approve, steps }, { repair }) {
  step('directions (P3, P4)', ['directions', project]);
  chooseDirection({ dir, approve });
  step('site --build (P9)', ['site', project, '--build', '--force']);
  const selected = applyApproaches({ project, dir, step, approve });
  let { floor, results } = gateResults(step('gates (P11)', ['gates', project, '--json']));
  step('qa (P11)', ['qa', project]);
  const advance = (why) => {
    for (let i = 0; i < PHASE_COUNT; i++) {
      const r = step(`advance (${why})`, ['advance', project]);
      if (r.code !== 0) return r;
    }
    return null;
  };
  advance('exit gates');
  if (repair) {
    approve('B3', 'content handed to the repair loop');
    advance('after B3');
    await skipTo(project, 'QUALITY_REVIEW', { workspace, steps });
    step('qa --repair (P11, P12)', ['qa', project, '--repair'], { timeout: 3_600_000 });
    ({ floor, results } = gateResults(step('gates after repair', ['gates', project, '--json'])));
  }
  return { selected, floor, results };
}

// Moves the project to `target` with advancePhase, past exit gates that do not hold, and records
// which phases were skipped and what their gates still wanted. Used only where the release run
// cannot go on otherwise; the report lists every skip.
async function skipTo(project, target, { workspace, steps }) {
  const { advancePhase, loadProject, nextPhases } = await import('../src/core/project.mjs');
  const { exitBlockers } = await import('../src/core/advance.mjs');
  const opts = { workspace, actor: 'operator' };
  const skipped = [];
  try {
    while (loadProject(project, opts).phase !== target) {
      const from = loadProject(project, opts).phase;
      const blockers = exitBlockers(project, opts);
      advancePhase(project, nextPhases(from).includes(target) ? target : nextPhases(from).at(-1), opts);
      skipped.push(blockers.length ? `${from} (${blockers.join('; ')})` : from);
    }
    steps.push({ label: `skip to ${target}`, args: [], code: skipped.length ? 2 : 0, ms: 0, stdout: skipped.length ? `Exit gates skipped: ${skipped.join(' | ')}` : 'Already there', stderr: '' });
  } catch (err) {
    steps.push({ label: `skip to ${target}`, args: [], code: 1, ms: 0, stdout: skipped.join(' | '), stderr: err.message });
  }
}

// With a model: the full workflow. At each phase the script does the operator's part (approvals,
// the forge commands whose output the phase needs) and forge run --advance does the agents' part
// (the planner's research, content and asset tasks) and moves on. It stops at PREVIEW_REPORT, with
// a local preview and the report: accepting the preview (B6) is the operator's decision.
async function modelPath(ctx) {
  const { project, workspace, dir, step, approve, steps } = ctx;
  const { loadProject } = await import('../src/core/project.mjs');
  const phase = () => loadProject(project, { workspace }).phase;
  const run = (label) => step(`run --advance (${label})`, ['run', project, '--advance'], { timeout: 3_600_000 });
  const advance = (label) => step(`advance (${label})`, ['advance', project]);
  let selected = [];
  let floor = null;
  let results = [];
  const seen = new Map();
  for (let i = 0; i < 4 * PHASE_COUNT; i++) {
    const p = phase();
    seen.set(p, (seen.get(p) ?? 0) + 1);
    // A phase the script has already worked twice is stuck: skip its gate, and say so.
    if (seen.get(p) > 2 && p !== 'QUALITY_REVIEW' && p !== 'REPAIR') {
      const next = { INTEGRATION_TESTS: 'QUALITY_REVIEW' }[p];
      const { nextPhases } = await import('../src/core/project.mjs');
      await skipTo(project, next ?? nextPhases(p)[0], { workspace, steps });
      continue;
    }
    if (p === 'CREATED' || p === 'INTAKE') advance('P1');
    else if (p === 'APPROACH_SELECTION') {
      if (!existsSync(join(dir, 'design', 'approach-decision.json'))) step('directions (P3, P4)', ['directions', project]);
      advance('P3');
    } else if (p === 'CREATIVE_DIRECTIONS') {
      if (!existsSync(join(dir, 'design', 'directions.json'))) step('directions (P3, P4)', ['directions', project]);
      chooseDirection(ctx);
      advance('P4');
    } else if (p === 'CONTENT') {
      // Content & UX starts from the site's draft pages, so the site is scaffolded first.
      if (!existsSync(join(dir, 'site'))) step('site (draft pages)', ['site', project]);
      const r = run('P6 content');
      if (/B3/.test(r.stdout + r.stderr) || phase() === 'CONTENT') {
        approve('B3', 'locked content reviewed');
        advance('P6');
      }
    } else if (p === 'BUILD') {
      // Rebuild from the locked content, then add the approaches.
      step('site --build (P9, locked content)', ['site', project, '--build', '--force']);
      selected = applyApproaches(ctx);
      advance('P9');
    } else if (p === 'INTEGRATION_TESTS') {
      ({ floor, results } = gateResults(step('gates (P10)', ['gates', project, '--json'])));
      advance('P10');
    } else if (p === 'QUALITY_REVIEW') {
      ({ floor, results } = gateResults(step('gates (P11)', ['gates', project, '--json'])));
      if (!floor?.met && seen.get(p) === 1) step('qa --repair (P11, P12)', ['qa', project, '--repair'], { timeout: 3_600_000 });
      ({ floor, results } = gateResults(step('gates after repair', ['gates', project, '--json'])));
      const r = advance('P11');
      if (r.code !== 0 && seen.get(p) > 1) break;
    } else if (p === 'PREVIEW_REPORT') {
      step('enable local-preview', ['plugins', 'enable', 'local-preview', '--project', project]);
      step('preview --once (P13)', ['preview', project, '--once']);
      step('report (P13)', ['report', project]);
      break;
    } else run(p);
  }
  return { selected, floor, results };
}

export function toMarkdown(run, { date, machine }) {
  const lines = [`# Release run: ${run.site} (${run.project}), ${date}`, ''];
  lines.push(`Brief: \`${run.brief}\`. Planned approaches: ${run.planned.join(', ')}. Selected: ${run.selected.join(', ') || 'none'}.`);
  const missing = run.planned.filter((a) => !run.selected.includes(a));
  if (missing.length) lines.push('', `**Not selected but planned:** ${missing.join(', ')}.`);
  lines.push('', `Result: **${run.qualityFloor?.met ? 'quality floor met' : `quality floor not met${run.qualityFloor ? ` (${run.qualityFloor.failing.join(', ')})` : ''}`}**. Mode: ${run.model ? 'full workflow with Claude Code (--model)' : run.repair ? 'commands, then the Claude Code repair loop (--repair)' : 'commands only, no model'}. Phase reached: ${run.phase}.`);
  lines.push('', `Machine: ${machine}.`, '', '## Steps', '', '| Step | Command | Exit | Time |', '| --- | --- | --- | --- |');
  for (const s of run.steps) lines.push(`| ${s.label} | \`${s.command}\` | ${s.code} | ${(s.ms / 1000).toFixed(1)} s |`);
  lines.push('', '## Gates', '', '| Gate | Status | Findings | Finding ids |', '| --- | --- | --- | --- |');
  for (const g of run.gates) lines.push(`| ${g.gate} | ${g.status} | ${g.findings} | ${g.error ? `error: ${g.error}` : g.ids.join(', ')} |`);
  if (run.defects) lines.push('', `QA Verifier: review ${run.defects.review}, ${run.defects.open} open defect(s) of ${run.defects.total}. See \`reports/defects.json\` and \`reports/qa-log.md\` in the project.`);
  const failed = run.steps.filter((s) => s.code !== 0 && !/^gates|^qa \(|^advance/.test(s.label));
  const stops = run.steps.filter((s) => s.code !== 0 && /^advance/.test(s.label));
  if (stops.length) {
    lines.push('', '## Where forge advance stops', '');
    for (const s of stops) lines.push(`### ${s.label}`, '', '```', s.output, '```', '');
  }
  if (failed.length) {
    lines.push('', '## Failed steps', '');
    for (const s of failed) lines.push(`### ${s.label}`, '', '```', s.output, '```', '');
  }
  lines.push('', `Evidence: \`${run.evidence}/\` (gates and QA reviews) in the project folder.`, '');
  return lines.join('\n');
}

async function main(args) {
  const which = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out') ?? 'all';
  const names = which === 'all' ? Object.keys(SITES) : [which];
  if (!names.every((n) => SITES[n])) {
    console.error(`Usage: node scripts/release-run.mjs [${Object.keys(SITES).join('|')}|all] [--fresh] [--repair | --model] [--out <dir>]`);
    return 2;
  }
  const out = flag(args, '--out') ?? join(ROOT, 'dist', 'release');
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const { platform, arch, version } = process;
  const machine = `${platform} ${arch}, Node ${version}`;
  mkdirSync(out, { recursive: true });
  let ok = true;
  for (const name of names) {
    console.log(`Release run: ${name}`);
    const run = await runSite(name, { fresh: args.includes('--fresh'), repair: args.includes('--repair'), model: args.includes('--model') });
    run.date = now.toISOString();
    run.machine = machine;
    const base = join(out, `${date}-${name}`);
    writeFileSync(`${base}.json`, JSON.stringify(run, null, 2) + '\n');
    writeFileSync(`${base}.md`, toMarkdown(run, { date, machine }));
    for (const s of run.steps) console.log(`  ${s.code === 0 ? 'ok  ' : 'FAIL'} ${s.label} (${(s.ms / 1000).toFixed(1)} s)`);
    console.log(`  ${run.qualityFloor?.met ? 'Quality floor met.' : `Quality floor not met: ${run.qualityFloor?.failing.join(', ') ?? 'no gate result'}.`} Report: ${base}.md`);
    ok &&= Boolean(run.qualityFloor?.met);
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}

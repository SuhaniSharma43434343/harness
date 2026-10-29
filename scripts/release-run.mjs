#!/usr/bin/env node
// Release run (T28, acceptance A8): drives the three release websites through every built
// forge command, in phase order, and writes a report with the evidence each step left.
//
//   node scripts/release-run.mjs [business|showroom|story|all] [--fresh] [--repair] [--out <dir>]
//
// The briefs are in samples/release/. Each run is the operator's own test, so the approvals
// the steps need (B1, B2, and an experimental approach's approval) are recorded with a note
// that says so. --repair also moves the project to QUALITY_REVIEW and runs the repair loop
// with the Claude Code builder (forge qa --repair), which needs Claude Code signed in. Every
// run tries forge advance after the QA review and reports where its exit gates stop; with
// --repair it records B3 and skips the exit gates that do not hold yet (advancePhase), so the
// repair loop can run, and the report names the phases it skipped.
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

export async function runSite(name, { fresh = false, repair = false } = {}) {
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
  step('directions (P3, P4)', ['directions', project]);

  // B2: the operator picks the top-ranked direction, and marks it chosen as QUICKSTART step 4 says.
  const b2 = approve('B2', 'top-ranked direction chosen');
  const directionsFile = join(dir, 'design', 'directions.json');
  if (existsSync(directionsFile) && lastSeq(b2.stdout)) {
    const d = readJson(directionsFile);
    if (d.status !== 'chosen') {
      Object.assign(d, { status: 'chosen', chosen: d.directions[0].id, approval: { code: 'B2', ledgerSeq: lastSeq(b2.stdout) } });
      writeFileSync(directionsFile, JSON.stringify(d, null, 2) + '\n');
    }
  }
  step('site --build (P9)', ['site', project, '--build', '--force']);

  const decisionFile = join(dir, 'design', 'approach-decision.json');
  const decisions = existsSync(decisionFile) ? readJson(decisionFile).decisions : [];
  const selected = decisions.filter((d) => d.selected).map((d) => d.approach);
  for (const d of decisions.filter((x) => x.selected && x.approach !== 'APP-01')) {
    if (d.needsApproval) approve(d.needsApproval, `experimental ${d.approach} accepted`);
    step(`approach ${d.approach}`, ['approach', project, d.approach]);
  }
  // Approaches add packages and sections, so build again before the gates look at dist/.
  if (selected.length > 1) step('site --build-only (after approaches)', ['site', project, '--build-only']);

  const gates = step('gates (P11)', ['gates', project, '--json']);
  let floor = null;
  let results = [];
  try {
    ({ qualityFloor: floor, results } = JSON.parse(gates.stdout));
  } catch {
    // The step's stderr says why; the report shows it.
  }
  step('qa (P11)', ['qa', project]);
  // forge advance moves the project on while each phase's exit gate holds; the step that
  // refuses names what is still missing, which is where the release run stops today.
  const advance = (why) => {
    for (let i = 0; i < PHASE_COUNT; i++) {
      const r = step(`advance (${why})`, ['advance', project]);
      if (r.code !== 0) return r;
    }
    return null;
  };
  advance('exit gates');

  if (repair) {
    const { advancePhase, loadProject, nextPhases } = await import('../src/core/project.mjs');
    approve('B3', 'content handed to the repair loop');
    advance('after B3');
    // The repair loop runs in QUALITY_REVIEW. Phases whose exit gates do not hold yet (no task
    // contracts, uncleared licences) are skipped here with advancePhase, and listed in the report.
    const opts = { workspace, actor: 'operator' };
    const skipped = [];
    try {
      while (loadProject(project, opts).phase !== 'QUALITY_REVIEW') {
        const from = loadProject(project, opts).phase;
        advancePhase(project, nextPhases(from)[0], opts);
        skipped.push(from);
      }
      steps.push({ label: 'phase -> QUALITY_REVIEW', args: [], code: 0, ms: 0, stdout: skipped.length ? `Exit gates skipped for the release run: ${skipped.join(', ')}` : 'Already there', stderr: '' });
    } catch (err) {
      steps.push({ label: 'phase -> QUALITY_REVIEW', args: [], code: 1, ms: 0, stdout: '', stderr: err.message });
    }
    step('qa --repair (P11, P12)', ['qa', project, '--repair'], { timeout: 3_600_000 });
    const after = step('gates after repair', ['gates', project, '--json']);
    try {
      ({ qualityFloor: floor, results } = JSON.parse(after.stdout));
    } catch {
      // As above.
    }
  }

  const defectsFile = join(dir, 'reports', 'defects.json');
  const defects = existsSync(defectsFile) ? readJson(defectsFile) : null;
  return {
    site: name,
    project,
    brief: site.brief,
    planned: site.approaches,
    selected,
    repair,
    steps: steps.map(({ label, args, code, ms, stdout, stderr }) => ({ label, command: args.length ? `forge ${args.join(' ')}` : '(script)', code, ms, output: code === 0 ? tail(stdout) : tail(`${stdout}\n${stderr}`, 20) })),
    gates: results.map((r) => ({ gate: r.gate, status: r.status, findings: r.findings.length, ids: [...new Set(r.findings.map((f) => f.id))], error: r.error?.message })),
    qualityFloor: floor,
    defects: defects ? { review: defects.review, open: defects.defects.filter((d) => d.status === 'open').length, total: defects.defects.length } : null,
    evidence: relative(ROOT, join(dir, 'evidence')).split('\\').join('/'),
  };
}

export function toMarkdown(run, { date, machine }) {
  const lines = [`# Release run: ${run.site} (${run.project}), ${date}`, ''];
  lines.push(`Brief: \`${run.brief}\`. Planned approaches: ${run.planned.join(', ')}. Selected: ${run.selected.join(', ') || 'none'}.`);
  const missing = run.planned.filter((a) => !run.selected.includes(a));
  if (missing.length) lines.push('', `**Not selected but planned:** ${missing.join(', ')}.`);
  lines.push('', `Result: **${run.qualityFloor?.met ? 'quality floor met' : `quality floor not met${run.qualityFloor ? ` (${run.qualityFloor.failing.join(', ')})` : ''}`}**. Model repair loop: ${run.repair ? 'ran' : 'not run (no --repair)'}.`);
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
    console.error(`Usage: node scripts/release-run.mjs [${Object.keys(SITES).join('|')}|all] [--fresh] [--repair] [--out <dir>]`);
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
    const run = await runSite(name, { fresh: args.includes('--fresh'), repair: args.includes('--repair') });
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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { advanceProject, exitBlockers, nextPhase } from '../core/advance.mjs';
import { loadConfig } from '../core/config.mjs';
import { deploy, smokeTest, startPreview, writeReport } from '../core/deliver.mjs';
import * as ledger from '../core/ledger.mjs';
import { approve, loadProject } from '../core/project.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const usage = (text) => {
  console.error(`Usage: ${text}`);
  return 2;
};

// forge advance <project> [--check]: moves to the next phase when its exit gate holds.
export function cmdAdvance(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) return usage('forge advance <project> [--check]');
  const workspace = workspaceFor(root);
  const { phase } = loadProject(project, { workspace });
  if (args.includes('--check')) {
    const blockers = exitBlockers(project, { workspace });
    console.log(blockers.length ? `${project} cannot leave ${phase} yet:\n${blockers.map((b) => `  - ${b}`).join('\n')}` : `${project} can move from ${phase} to ${nextPhase(project, { workspace })}.`);
    return blockers.length ? 1 : 0;
  }
  const { from, to } = advanceProject(project, { workspace });
  console.log(`${project}: ${from} -> ${to}`);
  return 0;
}

// forge preview <project> [--port n] [--once]: serves the built site on 127.0.0.1 until Ctrl+C.
// --once checks that it serves, then stops (for scripts and tests).
export async function cmdPreview(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) return usage('forge preview <project> [--port <n>] [--once]');
  const server = await startPreview(project, { workspace: workspaceFor(root), port: Number(flag(args, '--port') ?? 0) });
  console.log(`Previewing ${project} at ${server.url} (smoke test ${server.smoke.ok ? 'passed' : `failed: ${server.smoke.status ?? server.smoke.error}`}).`);
  if (args.includes('--once')) {
    await server.close();
    return server.smoke.ok ? 0 : 1;
  }
  console.log('Press Ctrl+C to stop.');
  await new Promise((resolve) => process.once('SIGINT', resolve));
  await server.close();
  return 0;
}

// forge deploy <project> --preview | --production
export async function cmdDeploy(root, args) {
  const [project] = args;
  const target = args.includes('--production') ? 'production' : args.includes('--preview') ? 'preview' : null;
  if (!project || project.startsWith('-') || !target) return usage('forge deploy <project> --preview | --production');
  const r = await deploy(project, { target, workspace: workspaceFor(root) });
  console.log(`Deployed ${project} (${target}${r.smoke.mock ? ', mock' : ''}): ${r.url}`);
  console.log(`  smoke test: ${r.smoke.ok ? 'passed' : 'failed'}${r.forms ? `; forms: ${r.forms}` : ''}`);
  return 0;
}

// forge report <project>: writes reports/final-report.md from the ledger.
export function cmdReport(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) return usage('forge report <project>');
  const { file } = writeReport(project, { workspace: workspaceFor(root) });
  console.log(`Wrote ${file}`);
  return 0;
}

// forge test [--mock]: the whole test suite. --mock puts every plugin in mock mode, so nothing
// calls a paid API; the tests themselves never call a model (workers are replayed or faked).
export function cmdTest(root, args) {
  const env = { ...process.env, ...(args.includes('--mock') ? { FORGE_MOCK: '1' } : {}) };
  const r = spawnSync(process.execPath, ['--test', 'tests/**/*.test.mjs'], { cwd: root, env, stdio: 'inherit' });
  return r.status ?? 1;
}

// forge demo [--no-serve]: replays the sample business project to a local preview, with no
// model and no paid API: intake from the sample brief's recommendations, approach selection,
// three design directions (the first one chosen), the starter site, then a local preview.
// Approvals are recorded as the operator's, with a note that the demo gave them.
export async function cmdDemo(root, args) {
  const workspace = workspaceFor(root);
  const project = flag(args, '--project') ?? `demo-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  const cli = join(root, 'src', 'cli', 'index.mjs');
  const env = { ...process.env, FORGE_MOCK: '1' };
  const step = (label, cmdArgs) => {
    console.log(`\n> forge ${cmdArgs.join(' ')}`);
    const r = spawnSync(process.execPath, [cli, ...cmdArgs], { cwd: root, env, encoding: 'utf8' });
    process.stdout.write(r.stdout.split('\n').slice(0, 12).join('\n'));
    if (r.status !== 0) throw new Error(`${label} failed:\n${(r.stderr || r.stdout).trim().split('\n').slice(-8).join('\n')}`);
  };
  const opts = { workspace };
  const note = 'given by forge demo';

  step('Creating the project', ['new', project, '--brief', 'samples/briefs/business.json']);
  step('Intake', ['intake', project, '--use-recommendations']);
  approve(project, 'B1', { ...opts, note });
  step('Moving to research', ['advance', project]);
  step('Moving to approach selection', ['advance', project]);
  step('Design directions', ['directions', project, '--no-render']);
  step('Moving to creative directions', ['advance', project]);

  // Choose the first direction, as the operator would after reviewing them.
  const file = join(workspace, project, 'design', 'directions.json');
  const directions = JSON.parse(readFileSync(file, 'utf8'));
  const b2 = approve(project, 'B2', { ...opts, note });
  Object.assign(directions, { status: 'chosen', chosen: directions.directions[0].id, approval: { code: 'B2', ledgerSeq: b2.seq } });
  writeFileSync(file, JSON.stringify(directions, null, 2) + '\n');
  console.log(`\nChose direction ${directions.chosen} (B2, ledger #${b2.seq}).`);

  step('The starter site', ['site', project, '--build']); // uses the chosen direction's tokens
  if (!existsSync(join(workspace, project, 'site', 'dist', 'index.html'))) throw new Error('The site did not build. Run scripts/setup.sh first, so the starter has its dependencies.');
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'demo', message: 'Replayed the sample business project to a local preview' } }, opts);

  // The demo serves the site with the local-preview plugin's server directly: it is local and
  // read-only, so it needs no enabling for a demo.
  const { start } = await import('../../plugins/local-preview/index.mjs');
  const server = await start({ dir: join(workspace, project, 'site', 'dist'), port: Number(flag(args, '--port') ?? 0) });
  const smoke = await smokeTest(server.url);
  console.log(`\nThe demo site for ${project} is at ${server.url} (smoke test ${smoke.ok ? 'passed' : 'failed'}).`);
  if (args.includes('--no-serve')) {
    await server.close();
    return smoke.ok ? 0 : 1;
  }
  console.log('Press Ctrl+C to stop.');
  await new Promise((resolve) => process.once('SIGINT', resolve));
  await server.close();
  return 0;
}

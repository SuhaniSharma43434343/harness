import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listTasks } from './board.mjs';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { check } from './schemas.mjs';
import { ROOT } from './workspace.mjs';

// forge upgrade --from <old folder> (T11): copies the operator's .env, forge.config.json and
// workspace/ from an older extraction into this one, then checks every project against this
// version's schemas. A dry run reports the plan and changes nothing.

// Migrations by the version they upgrade from. Each one receives a project folder and returns
// a list of what it changed. There are none yet: 0.1.0 is the first release line.
export const MIGRATIONS = {};

const version = (dir) => (existsSync(join(dir, 'VERSION')) ? readFileSync(join(dir, 'VERSION'), 'utf8').trim() : null);
const projectsIn = (ws) => (existsSync(ws) ? readdirSync(ws, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);

function checkProject(workspace, project) {
  const problems = [];
  const opts = { workspace };
  try {
    const state = loadProject(project, opts);
    if (!check('projectState', state).valid) problems.push('project.json does not match this version');
  } catch (err) {
    problems.push(err.message);
  }
  try {
    const entries = ledger.read(project, opts);
    const bad = entries.filter((e) => !check('ledgerEntry', e).valid).length;
    if (bad) problems.push(`${bad} ledger entr${bad === 1 ? 'y does' : 'ies do'} not match this version`);
  } catch (err) {
    problems.push(err.message);
  }
  try {
    listTasks(project, opts);
  } catch (err) {
    problems.push(err.message);
  }
  return problems;
}

export function upgrade({ from, root = ROOT, dryRun = false, force = false }) {
  if (!from || !existsSync(join(from, 'VERSION')) || !existsSync(join(from, 'src', 'cli', 'index.mjs'))) {
    throw new ConfigMissing(`${from} is not a Forge folder`, { hint: 'Point --from at the folder of the older Forge extraction.' });
  }
  const oldVersion = version(from);
  const newVersion = version(root);
  const oldWorkspace = join(from, 'workspace');
  const newWorkspace = join(root, 'workspace');
  const projects = projectsIn(oldWorkspace);
  const clash = projects.filter((p) => existsSync(join(newWorkspace, p)));
  if (clash.length && !force) {
    throw new PermissionDenied(`These projects already exist here: ${clash.join(', ')}`, { hint: 'Move them away first, or pass --force to overwrite them.' });
  }

  const plan = {
    from: oldVersion,
    to: newVersion,
    copy: [
      ...['.env', 'forge.config.json'].filter((f) => existsSync(join(from, f))),
      ...projects.map((p) => `workspace/${p}`),
    ],
    migrations: Object.keys(MIGRATIONS).filter((v) => v === oldVersion),
    projects: {},
  };
  if (dryRun) {
    // Check the old projects in place against this version's schemas.
    for (const p of projects) plan.projects[p] = checkProject(oldWorkspace, p);
    return { dryRun: true, ...plan };
  }

  for (const f of ['.env', 'forge.config.json']) if (existsSync(join(from, f))) cpSync(join(from, f), join(root, f));
  for (const p of projects) cpSync(join(oldWorkspace, p), join(newWorkspace, p), { recursive: true, force: true });
  for (const v of plan.migrations) for (const p of projects) MIGRATIONS[v](join(newWorkspace, p));
  for (const p of projects) {
    plan.projects[p] = checkProject(newWorkspace, p);
    ledger.append(p, { actor: 'cli', type: 'note', data: { message: `Upgraded from Forge ${oldVersion} to ${newVersion}` } }, { workspace: newWorkspace });
  }
  return { dryRun: false, ...plan };
}

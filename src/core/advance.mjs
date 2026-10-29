import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { qualityFloor } from '../gates/index.mjs';
import { validateBrief } from '../intake/brief.mjs';
import { agentsForPhase } from './agents.mjs';
import { listTasks } from './board.mjs';
import { PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { patternsOverlap } from './locks.mjs';
import { PHASES, advancePhase, hasApproval, loadProject, nextPhases } from './project.mjs';
import { check } from './schemas.mjs';
import { assertProjectExists } from './workspace.mjs';

// Phase exits (the plan's workflow table). advanceProject moves a project to its next phase
// only when the phase's exit gate holds: its evidence (below), its tasks finished, and its exit
// approval recorded (checked by advancePhase). Anything missing is a blocker, recorded as a
// refusal in the ledger, and the project stays where it is.

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

// The latest result of each gate, from evidence/gates/<gate>.json.
export function latestGateResults(dir) {
  const gates = join(dir, 'evidence', 'gates');
  if (!existsSync(gates)) return [];
  return readdirSync(gates)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(gates, f)))
    .filter((r) => r && check('gateResult', r).valid);
}

// Deploys recorded in the ledger. A mock deploy counts only in mock mode (forge demo, tests).
function deployments(project, opts) {
  const mock = process.env.FORGE_MOCK === '1';
  return ledger.read(project, opts).filter((e) => e.type === 'note' && e.data?.event === 'deployment' && (mock || !e.data.mock));
}

// Evidence each phase needs before it can end. Each check returns a list of what is missing.
const EVIDENCE = {
  INTAKE: (dir) => {
    const brief = readJson(join(dir, 'intake', 'brief.json'));
    const facts = readJson(join(dir, 'intake', 'facts.json'));
    if (!brief || !facts) return ['intake/brief.json and intake/facts.json (run forge intake)'];
    const v = validateBrief(brief, facts);
    return [...v.errors.map((e) => `brief: ${e}`), ...v.missing.map((m) => `brief field still unknown: ${m}`)];
  },
  APPROACH_SELECTION: (dir) => {
    const d = readJson(join(dir, 'design', 'approach-decision.json'));
    if (!d) return ['design/approach-decision.json (run forge directions or forge select)'];
    return check('approachDecision', d).errors.map((e) => `approach decision: ${e}`);
  },
  CREATIVE_DIRECTIONS: (dir) => {
    const d = readJson(join(dir, 'design', 'directions.json'));
    if (!d) return ['design/directions.json (run forge directions)'];
    const errors = check('designDecision', d).errors.map((e) => `directions: ${e}`);
    if (d.status !== 'chosen') errors.push('a chosen direction in design/directions.json');
    return errors;
  },
  ASSETS_LICENSING: (dir) => {
    const r = readJson(join(dir, 'assets', 'register.json'));
    if (!r) return ['assets/register.json (the licence register)'];
    return (r.assets ?? []).filter((a) => a.status !== 'cleared').map((a) => `licence not cleared: ${a.path ?? a.package} (${a.status})`);
  },
  TECHNICAL_PLAN: (dir, project, opts) => {
    const tasks = listTasks(project, opts);
    if (!tasks.length) return ['task contracts on the board'];
    const problems = [];
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const clash = tasks[i].owns_files.find((a) => tasks[j].owns_files.some((b) => patternsOverlap(a, b)));
        if (clash) problems.push(`${tasks[i].id} and ${tasks[j].id} both own ${clash}`);
      }
    }
    return problems;
  },
  BUILD: (dir) => (existsSync(join(dir, 'site', 'dist', 'index.html')) ? [] : ['a built site in site/dist (forge site --build)']),
  INTEGRATION_TESTS: (dir) => {
    const results = latestGateResults(dir);
    const { failing } = qualityFloor(results, ['routes', 'forms', 'content-parity']);
    return failing.map((g) => `gate ${g} passing (forge gates)`);
  },
  QUALITY_REVIEW: (dir) => {
    const { failing } = qualityFloor(latestGateResults(dir));
    return failing.map((g) => `gate ${g} passing`);
  },
  PREVIEW_REPORT: (dir, project, opts) =>
    deployments(project, opts).some((e) => e.data.target === 'preview' && e.data.smoke === 'pass') ? [] : ['a preview deploy that passed its smoke test (forge deploy --preview)'],
  PRODUCTION_DEPLOY: (dir, project, opts) =>
    deployments(project, opts).some((e) => e.data.target === 'production' && e.data.smoke === 'pass') ? [] : ['a production deploy that passed its smoke test (forge deploy --production)'],
};

// What still stands between the project and its next phase: [] when it may move.
export function exitBlockers(project, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  const { phase } = loadProject(project, opts);
  const blockers = [];
  const agents = new Set(agentsForPhase(phase));
  for (const t of listTasks(project, opts)) {
    if (!agents.has(t.agent)) continue;
    if (t.status === 'blocked') blockers.push(`task ${t.id} is blocked: ${t.blocked_reason}`);
    else if (t.status !== 'done') blockers.push(`task ${t.id} is ${t.status}`);
  }
  blockers.push(...(EVIDENCE[phase]?.(dir, project, opts) ?? []));
  const approval = PHASES.find((p) => p.name === phase).exitApproval;
  if (approval && !hasApproval(project, approval, opts)) blockers.push(`approval ${approval} (forge approve ${project} ${approval})`);
  return blockers;
}

// Where the project goes next. Quality review goes to repair while the quality floor is not
// met (and the repair budget allows), otherwise to preview.
export function nextPhase(project, opts = {}) {
  const { phase } = loadProject(project, opts);
  const options = nextPhases(phase);
  if (phase === 'QUALITY_REVIEW') {
    const { dir } = assertProjectExists(project, opts);
    return qualityFloor(latestGateResults(dir)).met ? 'PREVIEW_REPORT' : 'REPAIR';
  }
  return options[0] ?? null;
}

// advanceProject(project) => { from, to } or throws PermissionDenied listing the blockers.
export function advanceProject(project, { actor = 'cli', ...opts } = {}) {
  const { phase } = loadProject(project, opts);
  const to = nextPhase(project, opts);
  if (!to) throw new PermissionDenied(`${project} is in ${phase}, the last phase`);
  let blockers = exitBlockers(project, opts);
  // Leaving quality review for repair is the point of a failing floor, not a blocker.
  if (phase === 'QUALITY_REVIEW' && to === 'REPAIR') blockers = blockers.filter((b) => !b.startsWith('gate '));
  if (blockers.length) {
    ledger.append(project, { actor, type: 'refusal', data: { action: `phase ${phase} -> ${to}`, reason: blockers.join('; ') } }, opts);
    throw new PermissionDenied(`${project} cannot leave ${phase} yet`, { hint: blockers.join('\n'), details: { phase, to, blockers } });
  }
  advancePhase(project, to, { actor, ...opts });
  return { from: phase, to };
}

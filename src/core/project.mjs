import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionDenied, SchemaInvalid } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { assertValid } from './schemas.mjs';
import { ROOT, assertProjectExists, projectPaths, readJson, writeJsonAtomic } from './workspace.mjs';

const HARNESS_VERSION = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();

// Project phases P0 to P15 from the plan. `exitApproval` must be recorded in the ledger
// before the project may leave that phase. B4 (paid assets, spend) and B5 (integrations,
// credentials) are action approvals instead: the plugin host checks them with
// requireApproval() at the moment of the call, because not every project needs them.
export const PHASES = [
  { id: 'P0', name: 'CREATED' },
  { id: 'P1', name: 'INTAKE', exitApproval: 'B1' },
  { id: 'P2', name: 'RESEARCH' },
  { id: 'P3', name: 'APPROACH_SELECTION' },
  { id: 'P4', name: 'CREATIVE_DIRECTIONS', exitApproval: 'B2' },
  { id: 'P5', name: 'UX_DESIGN_SYSTEM' },
  { id: 'P6', name: 'CONTENT', exitApproval: 'B3' },
  { id: 'P7', name: 'ASSETS_LICENSING' },
  { id: 'P8', name: 'TECHNICAL_PLAN' },
  { id: 'P9', name: 'BUILD' },
  { id: 'P10', name: 'INTEGRATION_TESTS' },
  { id: 'P11', name: 'QUALITY_REVIEW' },
  { id: 'P12', name: 'REPAIR' },
  { id: 'P13', name: 'PREVIEW_REPORT', exitApproval: 'B6' },
  { id: 'P14', name: 'PRODUCTION_DEPLOY', exitApproval: 'B7' },
  { id: 'P15', name: 'HANDOFF' },
];

export const MAX_REPAIR_LOOPS = 3;

const byName = new Map(PHASES.map((p, i) => [p.name, { ...p, index: i }]));

// Each phase moves to the next one. Quality review can go to repair, and repair goes back
// to quality review for re-verification, at most MAX_REPAIR_LOOPS times.
export function nextPhases(name) {
  const p = byName.get(name);
  if (!p) return [];
  if (name === 'QUALITY_REVIEW') return ['REPAIR', 'PREVIEW_REPORT'];
  if (name === 'REPAIR') return ['QUALITY_REVIEW'];
  const next = PHASES[p.index + 1];
  return next ? [next.name] : [];
}

export function createProject(project, { brief, ...opts } = {}) {
  const paths = projectPaths(project, opts);
  if (existsSync(paths.state)) {
    throw new PermissionDenied(`Project "${project}" already exists`, { hint: `Use forge status ${project}.` });
  }
  for (const dir of [paths.dir, paths.board, paths.locks]) mkdirSync(dir, { recursive: true });
  const ts = (opts.now?.() ?? new Date()).toISOString();
  const state = { id: project, phase: 'CREATED', repairLoops: 0, createdAt: ts, updatedAt: ts, harnessVersion: HARNESS_VERSION };
  if (brief) state.brief = brief;
  assertValid('projectState', state, 'project.json');
  writeJsonAtomic(paths.state, state);
  ledger.append(project, { actor: 'cli', type: 'project_created', data: brief ? { brief } : {} }, opts);
  return state;
}

export function loadProject(project, opts = {}) {
  const paths = assertProjectExists(project, opts);
  const state = readJson(paths.state);
  assertValid('projectState', state, 'project.json');
  return state;
}

function saveProject(state, opts) {
  state.updatedAt = (opts.now?.() ?? new Date()).toISOString();
  assertValid('projectState', state, 'project.json');
  writeJsonAtomic(projectPaths(state.id, opts).state, state);
  return state;
}

function refuse(project, actor, action, reason, opts, hint) {
  ledger.append(project, { actor, type: 'refusal', data: { action, reason } }, opts);
  return new PermissionDenied(`Refused: ${action}. ${reason}`, { hint, details: { action, reason } });
}

export function approvals(project, opts = {}) {
  return ledger
    .read(project, opts)
    .filter((e) => e.type === 'approval')
    .map((e) => ({ approval: e.data.approval, seq: e.seq, ts: e.ts, note: e.data.note }));
}

export function hasApproval(project, code, opts = {}) {
  return approvals(project, opts).some((a) => a.approval === code);
}

// Only the operator records approvals; the ledger schema rejects any other actor.
export function approve(project, code, { note, ...opts } = {}) {
  const state = loadProject(project, opts);
  if (!/^(A[0-3]|B[1-7])$/.test(code ?? '')) {
    throw new SchemaInvalid(`"${code}" is not an approval code`, { hint: 'Approval codes are A0 to A3 and B1 to B7.' });
  }
  const data = { approval: code, phase: state.phase };
  if (note) data.note = note;
  return ledger.append(project, { actor: 'operator', type: 'approval', data }, opts);
}

// Throws PermissionDenied, and records the refusal, unless `code` is in the ledger.
export function requireApproval(project, code, action, { actor = 'cli', ...opts } = {}) {
  loadProject(project, opts);
  if (hasApproval(project, code, opts)) return true;
  throw refuse(project, actor, action, `${code} not recorded`, opts, `The operator must run forge approve ${project} ${code} first.`);
}

export function advancePhase(project, to, { actor = 'cli', ...opts } = {}) {
  const state = loadProject(project, opts);
  const from = state.phase;
  const action = `phase ${from} -> ${to}`;

  if (!nextPhases(from).includes(to)) {
    const allowed = nextPhases(from).join(' or ') || 'nothing (final phase)';
    throw refuse(project, actor, action, `Illegal transition; ${from} can move to ${allowed}`, opts);
  }
  const gate = byName.get(from).exitApproval;
  if (gate && !hasApproval(project, gate, opts)) {
    throw refuse(project, actor, action, `${gate} not recorded`, opts, `The operator must run forge approve ${project} ${gate} first.`);
  }
  if (to === 'REPAIR' && state.repairLoops >= MAX_REPAIR_LOOPS) {
    throw refuse(project, actor, action, `Repair ran ${MAX_REPAIR_LOOPS} times; escalate to the operator`, opts);
  }

  if (to === 'REPAIR') state.repairLoops += 1;
  state.phase = to;
  ledger.append(project, { actor, type: 'phase_transition', data: { from, to } }, opts);
  return saveProject(state, opts);
}

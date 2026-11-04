import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addTask, listTasks, saveTask } from '../core/board.mjs';
import { agentsForPhase } from '../core/agents.mjs';
import { advanceProject, exitBlockers } from '../core/advance.mjs';
import { PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { planPhase, specTask } from '../core/planner.mjs';
import { loadProject, returnToPhase } from '../core/project.mjs';
import { runProject } from '../core/runner.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { selectApproaches } from '../registry/select.mjs';
import { loadApproaches } from '../registry/load.mjs';
import { proposeDirections } from './propose.mjs';
import { renderDirections } from './render.mjs';
import { runGates } from '../gates/index.mjs';
import { CHECKS, FILES, isSuperseded, readiness, stageById, STAGES } from './spec.mjs';

// The Design Manager's process: it runs the workflow phase by phase without being asked at each
// step, keeps the specification complete, and sends failed work back to the stage that owns it.
// It stops only for what it may not decide: an operator approval, or a stage that has failed
// its limit of returns.

export const MAX_STAGE_RETURNS = 2;
// What the operator approved that a stage's fix changes: B2 covers the direction, B3 the copy.
const VOIDS = { direction: ['B2'], copy: ['B3'] };

const returnsOf = (project, stage, opts) => ledger.read(project, opts).filter((e) => e.type === 'note' && e.data?.event === 'design_returned' && e.data.stage === stage).length;

// sendBack(project, stageId, problems) moves the project back to the stage's phase and adds a
// fix task carrying the findings. Returns { returned: true } or, over the limit, { escalated: true }.
export function sendBack(project, stageId, problems, { actor = 'design-manager', ...opts } = {}) {
  const stage = stageById(stageId);
  const n = returnsOf(project, stageId, opts) + 1;
  if (n > MAX_STAGE_RETURNS) {
    ledger.append(project, { actor, type: 'note', data: { event: 'design_escalated', stage: stageId, problems } }, opts);
    return { escalated: true, stage: stageId, problems };
  }
  // The review judged the old specification, so a fresh one is needed on the way back through.
  rmSync(join(assertProjectExists(project, opts).dir, FILES.review), { force: true });
  const { phase } = loadProject(project, opts);
  if (phase !== stage.phase) returnToPhase(project, stage.phase, { actor, reason: `${stage.label}: ${problems.length} problem(s)`, voids: VOIDS[stageId] ?? [], ...opts });
  ledger.append(project, { actor, type: 'note', data: { event: 'design_returned', stage: stageId, attempt: n, problems } }, opts);
  const brief = readJson(join(assertProjectExists(project, opts).dir, FILES.brief));
  const fix = addTask(project, specTask(project, stageId, brief, { fix: n, problems }), opts);
  // Work waiting on this stage now waits on its fix.
  for (const t of listTasks(project, opts)) {
    if (t.status === 'pending' && t.id !== fix.id && t.depends_on.some((d) => d === stage.task || d.startsWith(`${stage.task}-fix-`))) {
      saveTask(project, { ...t, depends_on: t.depends_on.map((d) => (d === stage.task || d.startsWith(`${stage.task}-fix-`) ? fix.id : d)) }, opts);
    }
  }
  // A copy rewrite makes the section plan's quoted beats stale, and a stale plan sets later
  // reviewers against earlier ones. The plan syncs in the same pass, after the copy fix.
  if (stageId === 'copy' && !listTasks(project, opts).some((t) => t.id === `section-plan-sync-${n}` )) {
    const sync = specTask(project, 'section-plan', brief, { fix: n, problems: ['Update the section plan to match the corrected copy: every beat, staged line or operational fact the plan quotes must exist in content/copy.json as it now stands. Change only what the copy correction touched.'] });
    addTask(project, { ...sync, id: `section-plan-sync-${n}`, idempotency_key: `${project}:section-plan-sync-${n}:v1`, depends_on: [fix.id] }, opts);
    ledger.append(project, { actor, type: 'note', data: { event: 'design_plan_synced', stage: 'section-plan', after: fix.id } }, opts);
  }
  return { returned: true, stage: stageId, attempt: n };
}

// A build task out of attempts gets one more task, starting from what is there, with the last
// verify output as its acceptance. Past that, the operator decides.
function retryBuild(project, task, opts, findings) {
  const m = task.id.match(/^(build-[a-z]+)(?:-fix-(\d+))?$/);
  if (!m || Number(m[2] ?? 0) >= MAX_STAGE_RETURNS) return false;
  const { dir } = assertProjectExists(project, opts);
  const logs = join(dir, 'evidence', 'tasks', task.id);
  const last = existsSync(logs) ? readdirSync(logs).sort().at(-1) : null;
  const output = findings ?? (last ? readFileSync(join(logs, last), 'utf8').split('\n').filter((l) => /^- /.test(l)).slice(0, 25) : []);
  const n = Number(m[2] ?? 0) + 1;
  const id = `${m[1]}-fix-${n}`;
  addTask(project, { ...task, id, status: 'pending', attempts: undefined, blocked_reason: undefined, heartbeat_at: undefined, evidence: [], depends_on: [], idempotency_key: `${project}:${id}:v1`, acceptance: [...output.map((o) => `Fix: ${o.slice(2)}`), ...task.acceptance.filter((a) => !a.startsWith('Fix: '))] }, opts);
  ledger.append(project, { actor: 'design-manager', type: 'note', data: { event: 'build_retried', task: id } }, opts);
  return true;
}

// An integration gate failed on a site that had passed its build: back to the builder with what failed.
function returnToBuild(project, opts) {
  const { dir } = assertProjectExists(project, opts);
  const findings = ['routes', 'forms', 'content-parity'].flatMap((g) => {
    const file = join(dir, 'evidence', 'gates', `${g}.json`);
    return existsSync(file) ? readJson(file).findings.map((f) => `- ${f.id}${f.location ? ` [${f.location}]` : ''}: ${f.message}`) : [];
  });
  const builds = listTasks(project, opts).filter((t) => t.id.startsWith('build-sections')).sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  if (!builds.length) return false;
  const retried = retryBuild(project, builds.at(-1), opts, findings);
  if (retried) returnToPhase(project, 'BUILD', { reason: 'Integration gates failed', ...opts });
  return retried;
}

// After the phase's tasks ran: are this phase's stages sound? The first failing stage is sent back.
function checkPhaseStages(project, phase, opts) {
  const { dir } = assertProjectExists(project, opts);
  const failing = STAGES.filter((s) => s.phase === phase && s.task)
    .map((s) => ({ stage: s, problems: CHECKS[s.id](dir) }))
    .find((x) => x.problems.length);
  return failing ?? null;
}

// The specification review at the end of planning: a deterministic completeness check, then the
// Design Manager's own judgement in design/review.json. Either can send a stage back.
function reviewOutcome(project, opts) {
  const { dir } = assertProjectExists(project, opts);
  const r = readiness(dir);
  const failing = r.stages.find((s) => !s.ok && stageById(s.id).task);
  if (failing) return { stage: failing.id, problems: failing.problems };
  const file = join(dir, FILES.review);
  if (!existsSync(file)) return null;
  const review = JSON.parse(readFileSync(file, 'utf8'));
  const blocking = (review.findings ?? []).filter((f) => f.severity === 'blocking');
  if (review.verdict === 'changes' || blocking.length) {
    const first = blocking[0]?.stage ?? 'section-plan';
    return { stage: first, problems: blocking.filter((f) => f.stage === first).map((f) => f.message), consumeReview: true };
  }
  return null;
}

// Steps a phase needs that are forge commands, not agent tasks.
async function commandStep(project, phase, opts) {
  const { dir } = assertProjectExists(project, opts);
  if (phase === 'APPROACH_SELECTION' && !existsSync(join(dir, FILES.decision))) {
    const brief = readJson(join(dir, FILES.brief));
    const { approaches, matrix } = loadApproaches();
    writeJsonAtomic(join(dir, FILES.decision), selectApproaches(brief, approaches, matrix));
  }
  if (phase === 'CREATIVE_DIRECTIONS' && !existsSync(join(dir, FILES.directions))) {
    const brief = readJson(join(dir, FILES.brief));
    const record = await proposeDirections(brief, readJson(join(dir, FILES.decision)), { count: 3 });
    writeJsonAtomic(join(dir, FILES.directions), record);
    await renderDirections(record, brief, dir, { screenshots: opts.renderDirections !== false });
  }
  if (phase === 'INTEGRATION_TESTS') await runGates(join(dir, 'site'), { project, projectDir: dir, gates: ['routes', 'forms', 'content-parity'], browser: opts.browser, adapters: opts.adapters });
}

// runDesignWorkflow(project, opts) => { stoppedAt, reason, spentUsd, log }
// opts: { worker, verifier?, workspace, stopBefore?, maxUsd?, onStep? (called after each phase) }
// Runs from the current phase until an approval is needed, a stage escalates, or the project
// reaches stopBefore (QUALITY_REVIEW by default: QA has its own loop).
export async function runDesignWorkflow(project, { worker, stopBefore = 'QUALITY_REVIEW', maxUsd = Infinity, budgetExhausted = () => false, onStep = () => {}, ...opts } = {}) {
  let spent = 0;
  const log = [];
  const counted = async (job) => {
    if (spent >= maxUsd) throw new PermissionDenied(`The spend limit of $${maxUsd} is reached ($${spent.toFixed(2)})`);
    const out = await worker(job);
    spent += out?.costUsd ?? 0;
    return out;
  };
  const stop = (reason, data = {}) => ({ stoppedAt: loadProject(project, opts).phase, reason, spentUsd: spent, log, ...data });

  for (let guard = 0; guard < 80; guard++) {
    const { phase } = loadProject(project, opts);
    if (phase === stopBefore) return stop('reached');
    if (budgetExhausted()) return stop('budget');
    await commandStep(project, phase, opts);
    planPhase(project, opts);
    const summary = await runProject(project, { ...opts, worker: counted, agents: agentsForPhase(phase), verifier: opts.verifier });
    log.push({ phase, done: summary.done, blocked: summary.blocked.map((b) => b.task), errors: summary.errors.map((e) => `${e.task}: ${e.message}`) });
    onStep(log.at(-1));

    // A task that ran out of attempts is a stage that failed: send it back once with its findings
    // rather than handing a half-made specification to the next agent.
    if (budgetExhausted()) return stop('budget');
    if (summary.errors.length) return stop('error', { errors: summary.errors });
    const tasks = listTasks(project, opts);
    const blocked = summary.blocked.filter((b) => !isSuperseded(tasks.find((t) => t.id === b.task), tasks));
    if (blocked.length) {
      const task = tasks.find((t) => t.id === blocked[0].task);
      const stage = STAGES.find((s) => task.id === s.task || task.id.startsWith(`${s.task}-fix-`));
      if (stage) {
        const problems = CHECKS[stage.id](assertProjectExists(project, opts).dir);
        const out = sendBack(project, stage.id, problems.length ? problems : [task.blocked_reason], opts);
        if (out.escalated) return stop('escalated', out);
        continue;
      }
      const retried = retryBuild(project, task, opts);
      if (retried) continue;
      return stop('blocked', { blocked });
    }

    const failed = checkPhaseStages(project, phase, opts);
    if (failed) {
      const out = sendBack(project, failed.stage.id, failed.problems, opts);
      if (out.escalated) return stop('escalated', out);
      continue;
    }
    if (phase === 'TECHNICAL_PLAN') {
      const issue = reviewOutcome(project, opts);
      if (issue) {
        const out = sendBack(project, issue.stage, issue.problems, opts);
        if (out.escalated) return stop('escalated', out);
        continue;
      }
    }

    const blockers = exitBlockers(project, opts);
    if (phase === 'INTEGRATION_TESTS' && blockers.some((b) => b.startsWith('gate ')) && returnToBuild(project, opts)) continue;
    if (blockers.length) return stop('needs', { blockers });
    const moved = advanceProject(project, opts);
    log.push({ moved });
  }
  return stop('too-many-steps');
}

export function designStatus(project, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  return { phase: loadProject(project, opts).phase, ...readiness(dir) };
}

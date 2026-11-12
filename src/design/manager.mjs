import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addTask, listTasks, saveTask, transitionTask } from '../core/board.mjs';
import { agentsForPhase } from '../core/agents.mjs';
import { advanceProject, exitBlockers } from '../core/advance.mjs';
import { PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { pageTaskId, planPhase, specTask } from '../core/planner.mjs';
import { loadProject, returnToPhase } from '../core/project.mjs';
import { runProject } from '../core/runner.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { selectApproaches } from '../registry/select.mjs';
import { loadApproaches } from '../registry/load.mjs';
import { proposeDirections } from './propose.mjs';
import { renderDirections } from './render.mjs';
import { runGates } from '../gates/index.mjs';
import { CHECKS, FILES, isSuperseded, mediaRejections, readiness, stageById, STAGES, workflowVersion } from './spec.mjs';
import { writeTruthDoc } from './truth.mjs';
import { recordError, withErrorRules } from '../core/error-memory.mjs';

// The Design Manager's process: it runs the workflow phase by phase without being asked at each
// step, keeps the specification complete, and sends failed work back to the stage that owns it.
// It stops only for what it may not decide: an operator approval, or a stage that has failed
// its limit of returns.

export const MAX_STAGE_RETURNS = 2;
// What the operator approved that a stage's fix changes: B2 covers the direction, B3 the copy.
const VOIDS = { direction: ['B2'], copy: ['B3'] };

// total numbers the fix tasks, so ids never repeat; sinceRetry counts against the limit, which an
// operator's retry starts afresh.
function returnsOf(project, stage, opts) {
  const notes = ledger.read(project, opts).filter((e) => e.type === 'note' && e.data?.stage === stage);
  const returned = (list) => list.filter((e) => e.data.event === 'design_returned').length;
  return { total: returned(notes), sinceRetry: returned(notes.slice(notes.findLastIndex((e) => e.data.event === 'design_retry_authorized') + 1)) };
}

// sendBack(project, stageId, problems) moves the project back to the stage's phase and adds a
// fix task carrying the findings. Returns { returned: true } or, over the limit, { escalated: true }.
export function sendBack(project, stageId, problems, { actor = 'design-manager', ...opts } = {}) {
  const stage = stageById(stageId);
  const { total, sinceRetry } = returnsOf(project, stageId, opts);
  const n = total + 1;
  if (sinceRetry >= MAX_STAGE_RETURNS) {
    ledger.append(project, { actor, type: 'note', data: { event: 'design_escalated', stage: stageId, problems } }, opts);
    return { escalated: true, stage: stageId, problems };
  }
  // The review judged the old specification, so a fresh one is needed on the way back through.
  rmSync(join(assertProjectExists(project, opts).dir, FILES.review), { force: true });
  const { phase } = loadProject(project, opts);
  if (phase !== stage.phase) returnToPhase(project, stage.phase, { actor, reason: `${stage.label}: ${problems.length} problem(s)`, voids: VOIDS[stageId] ?? [], ...opts });
  ledger.append(project, { actor, type: 'note', data: { event: 'design_returned', stage: stageId, attempt: n, problems } }, opts);
  for (const mistake of problems) recordError(project, { agent: stage.agent, stage: stageId, source: String(mistake).startsWith('media rejected') ? 'media-rejected' : 'design-returned', mistake }, opts);
  const brief = readJson(join(assertProjectExists(project, opts).dir, FILES.brief));
  const fix = addTask(project, withErrorRules(project, specTask(project, stageId, brief, { fix: n, problems }), opts), opts);
  // Work waiting on this stage now waits on its fix.
  for (const t of listTasks(project, opts)) {
    if (t.status === 'pending' && t.id !== fix.id && t.depends_on.some((d) => d === stage.task || d.startsWith(`${stage.task}-fix-`))) {
      saveTask(project, { ...t, depends_on: t.depends_on.map((d) => (d === stage.task || d.startsWith(`${stage.task}-fix-`) ? fix.id : d)) }, opts);
    }
  }
  // A copy rewrite makes the section plan's quoted beats stale, and a stale plan sets later
  // reviewers against earlier ones. The plan syncs in the same pass, after the copy fix. Copy
  // that never existed has made nothing stale.
  const hadCopy = existsSync(join(assertProjectExists(project, opts).dir, FILES.copy));
  if (stageId === 'copy' && hadCopy && !listTasks(project, opts).some((t) => t.id === `section-plan-sync-${n}` )) {
    const sync = specTask(project, 'section-plan', brief, { fix: n, problems: ['Update the section plan to match the corrected copy: every beat, staged line or operational fact the plan quotes must exist in content/copy.json as it now stands. Change only what the copy correction touched.'] });
    addTask(project, { ...sync, id: `section-plan-sync-${n}`, idempotency_key: `${project}:section-plan-sync-${n}:v1`, depends_on: [fix.id] }, opts);
    ledger.append(project, { actor, type: 'note', data: { event: 'design_plan_synced', stage: 'section-plan', after: fix.id } }, opts);
  }
  return { returned: true, stage: stageId, attempt: n };
}

// A build task out of attempts gets one more task, starting from what is there, with the last
// verify output as its acceptance. Past that, the operator decides (retryBuildTask, force).
const BUILD_TASK = /^(build-(?:foundation|sections|page-[a-z0-9-]+?))(?:-fix-(\d+))?$/;
function retryBuild(project, task, opts, findings, { force = false } = {}) {
  const m = task.id.match(BUILD_TASK);
  if (!m || (!force && Number(m[2] ?? 0) >= MAX_STAGE_RETURNS)) return false;
  const { dir } = assertProjectExists(project, opts);
  const logs = join(dir, 'evidence', 'tasks', task.id);
  const last = existsSync(logs) ? readdirSync(logs).sort().at(-1) : null;
  const output = findings ?? (last ? readFileSync(join(logs, last), 'utf8').split('\n').filter((l) => /^- /.test(l)).slice(0, 25) : []);
  const n = Number(m[2] ?? 0) + 1;
  const id = `${m[1]}-fix-${n}`;
  addTask(project, { ...task, id, status: 'pending', attempts: undefined, blocked_reason: undefined, heartbeat_at: undefined, evidence: [], depends_on: [], idempotency_key: `${project}:${id}:v1`, acceptance: [...output.map((o) => `Fix: ${o.slice(2)}`), ...task.acceptance.filter((a) => !a.startsWith('Fix: '))] }, opts);
  ledger.append(project, { actor: 'design-manager', type: 'note', data: { event: 'build_retried', task: id } }, opts);
  return id;
}

// buildTargets(taskIds, findings) => [{ id, findings }]: the latest build task to send back for
// each failure, with only the findings it can fix. A finding names its page in [route] and goes to
// that page's task. A finding that names no page is about what the pages share, so it goes to
// the foundation, never to every page. No findings (a gate that could not run) sends nothing back:
// a builder cannot fix that, so the workflow stops for the operator. A project planned before
// per-page builds sends everything to its single build-sections task.
export function buildTargets(taskIds, findings) {
  if (!findings.length) return [];
  const latest = (base) => taskIds.filter((id) => id === base || id.startsWith(`${base}-fix-`)).sort((a, b) => a.length - b.length || a.localeCompare(b)).at(-1);
  const pages = [...new Set(taskIds.map((id) => id.match(/^(build-page-[a-z0-9-]+?)(?:-fix-\d+)?$/)?.[1]).filter(Boolean))];
  if (!pages.length) return taskIds.some((id) => id.startsWith('build-sections')) ? [{ id: latest('build-sections'), findings }] : [];
  const routeOf = (line) => line.match(/\[([^\]]+)\]/)?.[1]?.split(' @ ')[0].split(' (')[0].trim();
  const owner = (line) => {
    const route = routeOf(line);
    const page = route?.startsWith('/') ? pageTaskId(route) : null;
    return page && pages.includes(page) ? page : 'build-foundation';
  };
  const groups = new Map();
  for (const f of findings) groups.set(owner(f), [...(groups.get(owner(f)) ?? []), f]);
  return [...groups].map(([base, own]) => ({ id: latest(base), findings: own })).filter((t) => t.id);
}

// The integration gates' latest findings, one line each, as the builder's fix tasks quote them.
function integrationFindings(dir) {
  return ['routes', 'forms', 'content-parity'].flatMap((g) => {
    const file = join(dir, 'evidence', 'gates', `${g}.json`);
    return existsSync(file) ? readJson(file).findings.map((f) => `- ${f.id}${f.location ? ` [${f.location}]` : ''}: ${f.message}`) : [];
  });
}

// An integration gate failed on a site that had passed its build: back to the builder with what failed.
function returnToBuild(project, opts) {
  const { dir } = assertProjectExists(project, opts);
  const findings = integrationFindings(dir);
  const tasks = listTasks(project, opts);
  let retried = false;
  for (const target of buildTargets(tasks.map((t) => t.id), findings)) {
    if (retryBuild(project, tasks.find((t) => t.id === target.id), opts, target.findings)) retried = true;
  }
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

// Rejected photos and videos (workflow 2), as findings for the asset plan. The review file is removed,
// so the media check is planned again and looks at the files the new plan names.
function mediaReviewOutcome(project, opts) {
  const { dir } = assertProjectExists(project, opts);
  const problems = mediaRejections(dir);
  if (!problems.length) return null;
  rmSync(join(dir, FILES.mediaReview), { force: true });
  return { problems };
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

// retryStage(project, stageId, { note }): the operator's answer to an escalation. Their decision
// goes in the ledger, the stage's blocked tasks stop counting, and the stage gets a fresh fix task
// with the note as its first finding and a fresh limit of returns.
// retryBuildTask(project, base, { note }) => { task }: the operator's answer to a build task that
// used up its retries. It gets one more fix task, past the limit, with the operator's note and the
// integration findings that are its to fix. Only the operator's decision does this, and the ledger
// records it. A blocked attempt is superseded, so it no longer holds up the phase.
export function retryBuildTask(project, base, { note, ...opts }) {
  if (!note) throw new PermissionDenied("A retry needs the operator's reason as its note");
  const tasks = listTasks(project, opts);
  const own = tasks.filter((t) => t.id.match(BUILD_TASK)?.[1] === base).sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
  if (!own.length) throw new PermissionDenied(`${project} has no build task ${base}`, { hint: `Build tasks: ${[...new Set(tasks.map((t) => t.id.match(BUILD_TASK)?.[1]).filter(Boolean))].join(', ')}` });
  const latest = own.at(-1);
  if (!['done', 'blocked'].includes(latest.status)) throw new PermissionDenied(`${latest.id} is ${latest.status}; retry it once it has finished`);
  const { dir } = assertProjectExists(project, opts);
  ledger.append(project, { actor: 'operator', type: 'note', data: { event: 'build_retry_authorized', task: base, message: note } }, opts);
  if (latest.status === 'blocked') saveTask(project, { ...latest, blocked_reason: `Superseded: the operator authorized a retry of ${base}` }, opts);
  const mine = buildTargets(tasks.map((t) => t.id), integrationFindings(dir)).find((t) => t.id === latest.id)?.findings ?? [];
  const id = retryBuild(project, latest, opts, [`- operator: ${note}`, ...mine], { force: true });
  if (loadProject(project, opts).phase === 'INTEGRATION_TESTS') returnToPhase(project, 'BUILD', { reason: `The operator authorized a retry of ${base}`, ...opts });
  return { task: id };
}

export function retryStage(project, stageId, { note, ...opts }) {
  const stage = stageById(stageId);
  if (!stage?.task) throw new PermissionDenied(`"${stageId}" is not a stage an agent works on`, { hint: `Stages: ${STAGES.filter((s) => s.task).map((s) => s.id).join(', ')}` });
  if (!note) throw new PermissionDenied('A retry needs the operator\'s reason as its note');
  ledger.append(project, { actor: 'operator', type: 'note', data: { event: 'design_retry_authorized', stage: stageId, message: note } }, opts);
  const reason = `Superseded: the operator authorized a retry of ${stageId}`;
  for (const t of listTasks(project, opts)) {
    if (t.status === 'blocked' && (t.id === stage.task || t.id.startsWith(`${stage.task}-fix-`))) saveTask(project, { ...t, blocked_reason: reason }, opts);
    if (stageId === 'copy' && t.status === 'pending' && t.id.startsWith('section-plan-sync-')) transitionTask(project, t.id, 'blocked', { actor: 'design-manager', reason, ...opts });
  }
  return sendBack(project, stageId, [note, ...CHECKS[stageId](assertProjectExists(project, opts).dir)], opts);
}

// runDesignWorkflow(project, opts) => { stoppedAt, reason, spentUsd, log }
// opts: { worker, verifier?, workspace, stopBefore?, maxUsd?, onStep? (called after each phase),
//   pauseEachPhase? (stop after every phase move, with reason "step" and { moved }) }
// Runs from the current phase until an approval is needed, a stage escalates, or the project
// reaches stopBefore (QUALITY_REVIEW by default: QA has its own loop).
export async function runDesignWorkflow(project, { worker, stopBefore = 'QUALITY_REVIEW', maxUsd = Infinity, budgetExhausted = () => false, onStep = () => {}, pauseEachPhase = false, ...opts } = {}) {
  let spent = 0;
  const log = [];
  const counted = async (job) => {
    if (spent >= maxUsd) throw new PermissionDenied(`The spend limit of $${maxUsd} is reached ($${spent.toFixed(2)})`);
    const out = await worker(job);
    spent += out?.costUsd ?? 0;
    return out;
  };
  const stop = (reason, data = {}) => ({ stoppedAt: loadProject(project, opts).phase, reason, spentUsd: spent, log, ...data });
  // A refused call says nothing about the work, so it must never use up a stage's returns.
  const outOfMoney = () => budgetExhausted() || spent >= maxUsd;

  for (let guard = 0; guard < 80; guard++) {
    const { phase } = loadProject(project, opts);
    if (phase === stopBefore) return stop('reached');
    if (outOfMoney()) return stop('budget');
    await commandStep(project, phase, opts);
    planPhase(project, opts);
    const summary = await runProject(project, { ...opts, worker: counted, agents: agentsForPhase(phase), verifier: opts.verifier });
    log.push({ phase, done: summary.done, blocked: summary.blocked.map((b) => b.task), errors: summary.errors.map((e) => `${e.task}: ${e.message}`) });
    onStep(log.at(-1));

    // A task that ran out of attempts is a stage that failed: send it back once with its findings
    // rather than handing a half-made specification to the next agent.
    if (outOfMoney()) return stop('budget');
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
    // Track 4B: a photo or video the media check rejected sends the asset plan back, and the check
    // runs again on the new files.
    if (phase === 'ASSETS_LICENSING') {
      const issue = mediaReviewOutcome(project, opts);
      if (issue) {
        const out = sendBack(project, 'asset-plan', issue.problems, opts);
        if (out.escalated) return stop('escalated', out);
        continue;
      }
    }
    if (phase === 'TECHNICAL_PLAN') {
      const issue = reviewOutcome(project, opts);
      if (issue) {
        const out = sendBack(project, issue.stage, issue.problems, opts);
        if (out.escalated) return stop('escalated', out);
        continue;
      }
    }

    // Research that passes its checks becomes the Truth Doc the operator confirms before visual work.
    if (phase === 'RESEARCH' && workflowVersion(assertProjectExists(project, opts).dir) >= 2) writeTruthDoc(assertProjectExists(project, opts).dir);
    const blockers = exitBlockers(project, opts);
    if (phase === 'INTEGRATION_TESTS' && blockers.some((b) => b.startsWith('gate ')) && returnToBuild(project, opts)) continue;
    if (blockers.length) return stop('needs', { blockers });
    const moved = advanceProject(project, opts);
    log.push({ moved });
    if (pauseEachPhase) return stop('step', { moved });
  }
  return stop('too-many-steps');
}

export function designStatus(project, opts = {}) {
  const { dir } = assertProjectExists(project, opts);
  return { phase: loadProject(project, opts).phase, ...readiness(dir) };
}

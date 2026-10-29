import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { addTask, getTask } from '../core/board.mjs';
import { SchemaInvalid } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { advancePhase, loadProject } from '../core/project.mjs';
import { runTask } from '../core/runner.mjs';
import { assertValid } from '../core/schemas.mjs';
import { ROOT, projectPaths, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { getField } from '../registry/condition.mjs';
import { loadRegistry } from '../registry/load.mjs';
import { selectApproaches } from '../registry/select.mjs';
import { draftBrief, validateBrief } from './brief.mjs';
import { estimateScope } from './estimate.mjs';
import { renderPlan } from './plan.mjs';
import { recordAnswer, selectQuestions } from './questions.mjs';

const SCHEMA_VERSION = '0.1.0';
const FACTS_TASK = 'intake-facts';

// Facts from a structured brief file (forge new --brief): every field a question fills that the
// file already gives becomes a known fact from the client material.
export function factsFromBrief(project, brief, bank, ref) {
  const fields = [...new Set(bank.questions.flatMap((q) => q.fills))];
  const facts = [];
  for (const field of fields) {
    const value = getField(brief, field);
    if (value === undefined || value === null) continue;
    facts.push({ field, status: 'known', value, source: { kind: 'material', ref }, assumption: false });
  }
  return assertValid('facts', { project, schemaVersion: SCHEMA_VERSION, facts });
}

// The task that asks the model to read intake/material/ and write intake/facts.json. It goes
// through the runner like any other task, so it gets the same retries, locks and evidence.
function factsTask(project) {
  const cli = join(ROOT, 'src', 'cli', 'index.mjs');
  return {
    id: FACTS_TASK,
    agent: 'project-manager',
    approach_modules: [],
    inputs: ['intake/material/', 'schemas/facts.schema.json'],
    owns_files: ['intake/facts.json'],
    must_not_touch: ['site/**'],
    depends_on: [],
    acceptance: [
      'intake/facts.json lists every brief field the client material states, as known facts with source kind material and a file reference',
      'Nothing is guessed: a field the material does not state is left out',
    ],
    verify: `node "${cli}" validate facts intake/facts.json`,
    budget: { minutes: 10, retries: 2 },
    idempotency_key: `${project}:${FACTS_TASK}:v1`,
    status: 'pending',
    evidence: [],
  };
}

async function startingFacts(project, bank, { worker, verifier, ...ctx }) {
  const paths = projectPaths(project, ctx);
  const file = join(paths.dir, 'intake', 'facts.json');
  if (existsSync(file)) return assertValid('facts', readJson(file), 'intake/facts.json');

  const material = join(paths.dir, 'intake', 'material');
  if (worker && existsSync(material) && readdirSync(material).length) {
    try {
      getTask(project, FACTS_TASK, ctx);
    } catch {
      addTask(project, factsTask(project), ctx);
    }
    const r = await runTask(project, FACTS_TASK, { worker, ...(verifier ? { verifier } : {}), ...ctx });
    if (r.status !== 'done') {
      throw new SchemaInvalid(`Reading the client material failed: ${r.reason ?? r.status}`, { hint: `See forge status ${project}.` });
    }
    return assertValid('facts', readJson(file), 'intake/facts.json');
  }

  const state = loadProject(project, ctx);
  if (state.brief) {
    const briefFile = resolve(state.brief);
    if (existsSync(briefFile)) return factsFromBrief(project, readJson(briefFile), bank, state.brief);
  }
  return { project, schemaVersion: SCHEMA_VERSION, facts: [] };
}

function briefFile(state) {
  const file = state.brief ? resolve(state.brief) : null;
  return file && existsSync(file) ? readJson(file) : {};
}

function writeText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// runIntake(project, { ask, worker?, maxRounds?, registry?, now? }) => Promise<IntakeResult>
// The Project Manager loop for P1. Each round it selects questions, hands them to ask (the CLI
// prompt, or a fixture in tests) and records the answers. ask returns one answer per question:
// a value, 'use-recommendation', or undefined to leave it unanswered for now. Then it writes
// intake/brief.json, facts.json, estimate.json and plan.md, and logs each step in the ledger.
// It stops before B1 and never records an approval.
export async function runIntake(project, opts = {}) {
  const { ask, worker, verifier, maxRounds = 3, registry = loadRegistry(), now, ...ctx } = opts;
  if (typeof ask !== 'function') throw new TypeError('runIntake needs an ask(questions) function');
  const state = loadProject(project, ctx);
  if (state.phase === 'CREATED') advancePhase(project, 'INTAKE', { actor: 'project-manager', ...ctx });
  else if (state.phase !== 'INTAKE') {
    throw new SchemaInvalid(`Intake runs in P1; ${project} is in ${state.phase}`);
  }

  const note = (data) => ledger.append(project, { actor: 'project-manager', type: 'note', data }, ctx);
  const paths = projectPaths(project, ctx);
  const stamp = now ? { now: now() } : {};
  let facts = await startingFacts(project, registry.questions, { worker, verifier, ...ctx });
  // A brief from an earlier run keeps what the operator edited by hand; facts decide the rest.
  // On the first run, a brief file from forge new --brief is the base, so the fields no question
  // fills (integrations, features.splineSceneUrl) are kept.
  const previous = existsSync(join(paths.dir, 'intake', 'brief.json')) ? readJson(join(paths.dir, 'intake', 'brief.json')) : briefFile(state);
  const { status: _s, approval: _a, assumptions: _x, ...base } = previous;

  for (let round = 1; round <= maxRounds; round++) {
    const questions = selectQuestions({ ...base, project }, facts, registry.questions, { round });
    if (!questions.length) continue;
    note({ event: 'intake_round', round, asked: questions.map((q) => q.id) });
    const answers = await ask(questions, { round });
    let recorded = 0;
    questions.forEach((q, i) => {
      const answer = answers?.[i];
      if (answer === undefined) return;
      facts = recordAnswer(facts, q, answer, stamp);
      recorded++;
      note({ event: 'answer', question: q.id, fields: q.fills, recommendation: answer === 'use-recommendation' });
    });
    // A round with no answers ends intake: asking the same questions again would not help.
    if (!recorded) break;
  }

  const brief = draftBrief(facts, { project, base: { ...base, schemaVersion: SCHEMA_VERSION } });
  const result = validateBrief(brief, facts);
  const ready = result.valid && result.missing.length === 0;
  if (ready) brief.status = 'ready';

  writeJsonAtomic(join(paths.dir, 'intake', 'facts.json'), facts);
  writeJsonAtomic(join(paths.dir, 'intake', 'brief.json'), brief);
  const out = { status: ready ? 'ready' : 'needs-answers', brief, facts, errors: result.errors, missing: result.missing };

  if (ready) {
    const decision = selectApproaches(brief, registry.approaches, registry.matrix, stamp);
    out.decision = decision;
    out.estimate = estimateScope(brief, decision);
    writeJsonAtomic(join(paths.dir, 'intake', 'estimate.json'), out.estimate);
    writeText(join(paths.dir, 'intake', 'plan.md'), renderPlan(brief, decision, out.estimate));
  }
  note({
    event: 'intake_finished',
    status: out.status,
    missing: result.missing,
    assumptions: brief.assumptions.length,
    ...(ready ? { files: ['intake/brief.json', 'intake/facts.json', 'intake/estimate.json', 'intake/plan.md'] } : {}),
  });
  return out;
}

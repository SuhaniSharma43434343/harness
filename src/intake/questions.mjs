import { SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';
import { evaluate, getField } from '../registry/condition.mjs';

// Brief fields every brief needs before B1. The rest of the required brief properties
// (project, schemaVersion, status, assumptions) are set by Forge, not asked.
export const REQUIRED_FIELDS = [
  'projectType',
  'tier',
  'client.name',
  'client.industry',
  'goals',
  'audience',
  'pages',
  'brand.tone',
  'brand.motionIntensity',
  'constraints.deviceFloor',
  'constraints.accessibility',
];

const REQUIRED_BOOST = 5;
const FOLLOW_UP_BOOST = 2;
const DEFAULT_MAX = 10;

const settled = (fact) => fact && (fact.status === 'known' || fact.status === 'inferred');

function factMap(facts) {
  return new Map((facts?.facts ?? []).map((f) => [f.field, f]));
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] === null || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  cur[keys.at(-1)] = value;
}

// The brief as intake knows it so far: the partial brief with every known or inferred fact on top.
// Question rules (appliesTo, askWhen, follow-ups) are evaluated against this view.
export function intakeView(brief, facts) {
  const view = structuredClone(brief ?? {});
  if (facts?.project && view.project === undefined) view.project = facts.project;
  for (const f of facts?.facts ?? []) if (settled(f)) setPath(view, f.field, f.value);
  return view;
}

function applies(q, view) {
  const types = q.appliesTo.projectTypes;
  // Until the project type is known, only questions for every type apply.
  if (types !== 'all' && !types.includes(view.projectType)) return false;
  // An unknown tier does not hold a question back; q-tier settles it.
  if (view.tier !== undefined && !q.appliesTo.tiers.includes(view.tier)) return false;
  return !q.askWhen || evaluate(q.askWhen, view).holds;
}

// Question ids that a settled question's follow-up rules ask for now.
function triggeredFollowUps(bank, known, view) {
  const ids = new Set();
  for (const q of bank.questions) {
    if (!q.fills.every((f) => settled(known.get(f)))) continue;
    for (const rule of q.followUps ?? []) {
      if (evaluate(rule.when, view).holds) for (const id of rule.ask) ids.add(id);
    }
  }
  return ids;
}

// selectQuestions(brief, facts, bank, opts?) => Question[]
// Pure. Drops every question whose fields are all known or inferred, or whose appliesTo or
// askWhen does not match, and returns the rest by score: the weight, plus a boost when it
// fills a required field that is still open, plus a boost when a follow-up rule asks for it.
// A question waits for its round unless a follow-up asks for it sooner. Two questions that
// fill the same field are never asked together. At most opts.max (10) are returned; the A5
// intake tests check that round 1 gives 5 to 10 for every sample brief.
export function selectQuestions(brief, facts, bank, opts = {}) {
  assertValid('questionBank', bank);
  const round = opts.round ?? 1;
  const max = opts.max ?? DEFAULT_MAX;
  const known = factMap(facts);
  const view = intakeView(brief, facts);
  const followUps = triggeredFollowUps(bank, known, view);

  const scored = [];
  bank.questions.forEach((q, order) => {
    if (q.fills.every((f) => settled(known.get(f)))) return;
    if (!applies(q, view)) return;
    const asked = followUps.has(q.id);
    if ((q.round ?? 1) > round && !asked) return;
    const required = q.fills.some((f) => REQUIRED_FIELDS.includes(f) && !settled(known.get(f)));
    const score = q.weight + (required ? REQUIRED_BOOST : 0) + (asked ? FOLLOW_UP_BOOST : 0);
    scored.push({ q, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const picked = [];
  const filling = new Set();
  for (const { q } of scored) {
    if (picked.length >= max) break;
    if (q.fills.some((f) => filling.has(f))) continue;
    picked.push(q);
    for (const f of q.fills) filling.add(f);
  }
  return picked;
}

// Throws SchemaInvalid unless value is a valid answer to q (the CLI also uses it to re-ask).
export function checkAnswer(q, value) {
  const fail = (why) => {
    throw new SchemaInvalid(`Answer to ${q.id} is not valid: ${why}`, { details: { question: q.id, value } });
  };
  const allowed = (q.options ?? []).map((o) => o.value);
  switch (q.kind) {
    case 'single':
      if (!allowed.includes(value)) fail(`expected one of ${JSON.stringify(allowed)}`);
      break;
    case 'multi':
      if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) fail(`expected a list from ${JSON.stringify(allowed)}`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('expected true or false');
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) fail('expected a number');
      break;
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('expected a date as YYYY-MM-DD');
      break;
    case 'url':
      if (typeof value !== 'string' || !URL.canParse(value)) fail('expected a URL');
      break;
    default:
      // text: the raw words, or the value already in its brief shape. The Project Manager
      // turns raw words into the brief shape when it drafts the brief.
      if (value === undefined || value === null || value === '') fail('expected an answer');
  }
}

// One value per filled field. A question that fills several fields takes an object keyed by field.
function valuesFor(q, value) {
  if (q.fills.length === 1) return [[q.fills[0], value]];
  if (value === null || typeof value !== 'object') {
    throw new SchemaInvalid(`Answer to ${q.id} must be an object with ${q.fills.join(', ')}`);
  }
  return q.fills.map((f) => [f, value[f]]);
}

// recordAnswer(facts, question, answer, opts?) => Facts
// Pure: returns new facts. A real answer becomes a known fact from the answer. 'use-recommendation'
// becomes an inferred fact from the recommendation, with assumption: true and the recommendation's
// reason, so every recommendation used is recorded as an assumption (A5). opts.now adds recordedAt.
export function recordAnswer(facts, question, answer, opts = {}) {
  const useRec = answer === 'use-recommendation';
  let value;
  if (useRec) {
    const rec = question.recommendation;
    if ('value' in rec) value = rec.value;
    else {
      value = getField(intakeView({}, facts), rec.fromField);
      if (value === undefined) {
        throw new SchemaInvalid(`${question.id} recommends the value of ${rec.fromField}, which is not known yet`, {
          hint: `Answer ${question.id} directly, or settle ${rec.fromField} first.`,
        });
      }
    }
  } else {
    value = answer;
  }

  const entries = valuesFor(question, value);
  if (!useRec) {
    if (question.fills.length === 1) checkAnswer(question, value);
    else for (const [, v] of entries) if (v === undefined) throw new SchemaInvalid(`Answer to ${question.id} is missing a field`);
  }

  const stamp = opts.now ? { recordedAt: opts.now.toISOString() } : {};
  const fresh = entries.map(([field, v]) =>
    useRec
      ? {
          field,
          status: 'inferred',
          value: v,
          source: { kind: 'recommendation', questionId: question.id },
          assumption: true,
          reason: question.recommendation.reason,
          ...stamp,
        }
      : { field, status: 'known', value: v, source: { kind: 'answer', questionId: question.id }, assumption: false, ...stamp },
  );
  const replaced = new Set(question.fills);
  const next = {
    ...facts,
    facts: [...(facts.facts ?? []).filter((f) => !replaced.has(f.field)), ...structuredClone(fresh)],
  };
  return assertValid('facts', next);
}

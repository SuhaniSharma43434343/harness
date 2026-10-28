import { check } from '../core/schemas.mjs';
import { intakeView, REQUIRED_FIELDS } from './questions.mjs';

const settled = (f) => f.status === 'known' || f.status === 'inferred';

// draftBrief(facts, { project, base? }) => Brief
// Pure. Copies every known or inferred fact into the brief, lists every inferred field in
// brief.assumptions and returns a draft. It never sets approved: only the operator does, at B1.
export function draftBrief(facts, { project, base = {} }) {
  const brief = intakeView({ ...base, project, schemaVersion: base.schemaVersion ?? facts.schemaVersion }, facts);
  const inferred = facts.facts.filter((f) => f.status === 'inferred').map((f) => f.field);
  brief.assumptions = [...new Set([...(base.assumptions ?? []), ...inferred])];
  brief.status = 'draft';
  delete brief.approval;
  return brief;
}

// validateBrief(brief, facts) => { valid, errors, missing }
// The brief schema first, then the checks a schema cannot make across the two files. missing
// lists the required fields that still need an answer. The P1 exit gate is
// valid && missing.length === 0.
export function validateBrief(brief, facts) {
  const errors = [...check('brief', brief).errors];
  const facts_ = facts?.facts ?? [];
  const byField = new Map(facts_.map((f) => [f.field, f]));

  const missing = REQUIRED_FIELDS.filter((field) => !(byField.has(field) && settled(byField.get(field))));
  const assumptions = new Set(brief?.assumptions ?? []);
  for (const f of facts_) {
    if (f.status === 'inferred' && !assumptions.has(f.field)) {
      errors.push(`${f.field} is inferred but not listed in brief.assumptions`);
    }
  }
  for (const field of assumptions) {
    if (byField.get(field)?.status !== 'inferred') {
      errors.push(`brief.assumptions lists ${field}, which has no inferred fact`);
    }
  }
  if (facts?.project && brief?.project && facts.project !== brief.project) {
    errors.push(`facts are for ${facts.project}, the brief is for ${brief.project}`);
  }
  return { valid: errors.length === 0, errors, missing };
}

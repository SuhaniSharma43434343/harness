import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SchemaInvalid } from './errors.mjs';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

// Short names used across the code base, mapped to schema files.
export const SCHEMAS = {
  task: 'task.schema.json',
  plugin: 'plugin-manifest.schema.json',
  gateResult: 'gate-result.schema.json',
  ledgerEntry: 'ledger-entry.schema.json',
  config: 'forge-config.schema.json',
  projectState: 'project-state.schema.json',
  // Project side (Nidhi, T13).
  brief: 'brief.schema.json',
  facts: 'facts.schema.json',
  questionBank: 'question-bank.schema.json',
  approach: 'approach-registry.schema.json',
  selectionMatrix: 'selection-matrix.schema.json',
  approachDecision: 'approach-decision.schema.json',
  designDecision: 'design-decision.schema.json',
  condition: 'condition.schema.json',
  estimate: 'estimate.schema.json',
  // Industry playbooks: what each kind of business needs from its site.
  industryPlaybook: 'industry-playbook.schema.json',
  // QA Verifier (Nidhi, T24).
  defectReport: 'defect-report.schema.json',
  // Starter template (Nidhi, T18).
  tokens: 'tokens.schema.json',
  siteConfig: 'site-config.schema.json',
  // Design workflow: one file holds the definitions of every specification.
  methodology: 'design-spec.schema.json#/definitions/methodology',
  positioning: 'design-spec.schema.json#/definitions/positioning',
  crux: 'crux.schema.json',
  designDirection: 'design-spec.schema.json#/definitions/direction',
  designSystem: 'design-spec.schema.json#/definitions/designSystem',
  sectionPlan: 'design-spec.schema.json#/definitions/sectionPlan',
  motionPlan: 'design-spec.schema.json#/definitions/motionPlan',
  assetPlan: 'design-spec.schema.json#/definitions/assetPlan',
  siteCopy: 'design-spec.schema.json#/definitions/siteCopy',
  designReview: 'design-spec.schema.json#/definitions/designReview',
  visualReview: 'design-spec.schema.json#/definitions/visualReview',
  mediaPrompts: 'design-spec.schema.json#/definitions/mediaPrompts',
  mediaReview: 'design-spec.schema.json#/definitions/mediaReview',
};

let ajv;

function getAjv() {
  if (ajv) return ajv;
  ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, useDefaults: false });
  addFormats(ajv);
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), 'utf8')));
  }
  return ajv;
}

function idFor(name) {
  const file = SCHEMAS[name];
  if (!file) throw new Error(`Unknown schema "${name}". Known: ${Object.keys(SCHEMAS).join(', ')}`);
  return `forge/${file}`;
}

function formatErrors(errors) {
  return errors.map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}

// Returns { valid, errors } without throwing.
export function check(name, data) {
  const validate = getAjv().getSchema(idFor(name));
  const valid = validate(data);
  return { valid, errors: valid ? [] : formatErrors(validate.errors) };
}

// Throws SchemaInvalid with every error listed.
export function assertValid(name, data, label = name) {
  const { valid, errors } = check(name, data);
  if (!valid) {
    throw new SchemaInvalid(`${label} does not match the ${name} schema`, {
      hint: errors.join('; '),
      details: errors,
    });
  }
  return data;
}

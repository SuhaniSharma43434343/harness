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
  // Project side (Nidhi, T13).
  brief: 'brief.schema.json',
  facts: 'facts.schema.json',
  questionBank: 'question-bank.schema.json',
  approach: 'approach-registry.schema.json',
  selectionMatrix: 'selection-matrix.schema.json',
  approachDecision: 'approach-decision.schema.json',
  designDecision: 'design-decision.schema.json',
  condition: 'condition.schema.json',
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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigInvalid, ConfigMissing, SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';

export const REGISTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'registry');
export const APPROACH_IDS = ['APP-01', 'APP-02', 'APP-03', 'APP-04', 'APP-05', 'APP-06', 'APP-07', 'APP-08'];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SchemaInvalid(`${file} is not valid JSON`, { hint: err.message });
  }
}

// Checks what the schemas cannot see across files: all eight approaches present once, one
// registry version, and every approach a rule points at exists.
export function checkApproaches(approaches, matrix) {
  const errors = [];
  const ids = approaches.map((a) => a.id);
  for (const id of APPROACH_IDS) {
    const n = ids.filter((x) => x === id).length;
    if (n !== 1) errors.push(`${id} appears ${n} times in the registry (expected once)`);
  }
  for (const a of approaches) {
    if (a.registryVersion !== matrix.registryVersion) {
      errors.push(`${a.id} has registryVersion ${a.registryVersion}, the matrix has ${matrix.registryVersion}`);
    }
    if (a.fallback?.approach === a.id) errors.push(`${a.id} falls back to itself`);
    for (const part of a.composedOf ?? []) {
      if (part === a.id) errors.push(`${a.id} lists itself in composedOf`);
    }
  }
  if (errors.length) {
    throw new ConfigInvalid('The approach registry is inconsistent', { hint: errors.join('; '), details: errors });
  }
}

// Reads registry/approaches/APP-0N.json and registry/selection-matrix.json, validates each
// file, and checks them against each other. The selector takes the result, so tests can pass
// fixtures in directly instead.
export function loadApproaches(root = REGISTRY_DIR) {
  const dir = join(root, 'approaches');
  const matrixFile = join(root, 'selection-matrix.json');
  if (!existsSync(dir)) throw new ConfigMissing(`No approach registry at ${dir}`);
  if (!existsSync(matrixFile)) throw new ConfigMissing(`No selection matrix at ${matrixFile}`);

  const approaches = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const entry = assertValid('approach', readJson(join(dir, f)), `registry/approaches/${f}`);
      if (f !== `${entry.id}.json`) {
        throw new ConfigInvalid(`registry/approaches/${f} holds ${entry.id}`, { hint: `Rename it to ${entry.id}.json` });
      }
      return entry;
    });
  const matrix = assertValid('selectionMatrix', readJson(matrixFile), 'registry/selection-matrix.json');
  checkApproaches(approaches, matrix);
  return { approaches, matrix };
}

// Reads every registry/questions/*.json file and merges them into one bank. Each file must be a
// valid question bank, they must share one bank version, and question ids must be unique.
export function loadQuestionBank(root = REGISTRY_DIR) {
  const dir = join(root, 'questions');
  if (!existsSync(dir)) throw new ConfigMissing(`No question bank at ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) throw new ConfigMissing(`No question files in ${dir}`);
  const banks = files.map((f) => assertValid('questionBank', readJson(join(dir, f)), `registry/questions/${f}`));

  const errors = [];
  const versions = new Set(banks.map((b) => b.bankVersion));
  if (versions.size > 1) errors.push(`question files disagree on bankVersion: ${[...versions].join(', ')}`);
  const questions = banks.flatMap((b) => b.questions);
  const ids = new Set();
  for (const q of questions) {
    if (ids.has(q.id)) errors.push(`${q.id} is defined twice`);
    ids.add(q.id);
  }
  for (const q of questions) {
    for (const rule of q.followUps ?? []) {
      for (const id of rule.ask) if (!ids.has(id)) errors.push(`${q.id} asks for ${id}, which does not exist`);
    }
  }
  if (errors.length) {
    throw new ConfigInvalid('The question bank is inconsistent', { hint: errors.join('; '), details: errors });
  }
  return assertValid('questionBank', { schemaVersion: banks[0].schemaVersion, bankVersion: banks[0].bankVersion, questions });
}

// loadRegistry(root?) => { questions, approaches, matrix }: the only function that reads the
// registry from disk. The selectors take its output, so tests can pass fixtures in directly.
export function loadRegistry(root = REGISTRY_DIR) {
  return { questions: loadQuestionBank(root), ...loadApproaches(root) };
}

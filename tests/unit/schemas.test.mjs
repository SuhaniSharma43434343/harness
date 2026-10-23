import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValid, check } from '../../src/core/schemas.mjs';
import { SchemaInvalid } from '../../src/core/errors.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'schemas');

// Fixture file name prefix -> schema short name.
const PREFIX = [
  ['gate-result', 'gateResult'],
  ['ledger', 'ledgerEntry'],
  ['plugin', 'plugin'],
  ['project-state', 'projectState'],
  ['config', 'config'],
  ['task', 'task'],
];

function schemaFor(file) {
  const hit = PREFIX.find(([p]) => file.startsWith(p));
  assert.ok(hit, `no schema mapping for fixture ${file}`);
  return hit[1];
}

function load(dir, file) {
  const text = readFileSync(join(FIX, dir, file), 'utf8');
  return file.endsWith('.jsonl')
    ? text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [JSON.parse(text)];
}

for (const file of readdirSync(join(FIX, 'valid'))) {
  test(`valid fixture passes: ${file}`, () => {
    for (const doc of load('valid', file)) {
      const { valid, errors } = check(schemaFor(file), doc);
      assert.equal(valid, true, errors.join('\n'));
    }
  });
}

for (const file of readdirSync(join(FIX, 'invalid'))) {
  test(`invalid fixture is rejected: ${file}`, () => {
    for (const doc of load('invalid', file)) {
      assert.equal(check(schemaFor(file), doc).valid, false);
    }
  });
}

test('assertValid throws SchemaInvalid listing every error', () => {
  const [bad] = load('invalid', 'task-too-many-retries.json');
  assert.throws(
    () => assertValid('task', bad),
    (err) => err instanceof SchemaInvalid && err.code === 'SCHEMA_INVALID' && err.details.length >= 1,
  );
});

test('unknown schema name is a programming error', () => {
  assert.throws(() => check('nope', {}), /Unknown schema/);
});

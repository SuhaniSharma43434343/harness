import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig, parseEnvFile } from '../../src/core/config.mjs';
import { ConfigInvalid, SchemaInvalid } from '../../src/core/errors.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'forge-config-'));

test('defaults are used when there is no forge.config.json', () => {
  const { config, source, envFileFound } = loadConfig(tmp(), { env: {} });
  assert.equal(source, 'defaults');
  assert.equal(envFileFound, false);
  assert.deepEqual(config, { ...DEFAULT_CONFIG, plugins: {} });
});

test('plugins are off unless listed as true', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: { vercel: false } }));
  const { config } = loadConfig(dir, { env: {} });
  assert.equal(config.plugins.vercel, false);
  assert.equal(config.concurrency, 1);
});

test('invalid JSON gives ConfigInvalid with a hint', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'forge.config.json'), '{ nope');
  assert.throws(() => loadConfig(dir, { env: {} }), (e) => e instanceof ConfigInvalid && /forge.config.json/.test(e.hint));
});

test('out-of-range values are rejected by the schema', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'forge.config.json'), JSON.stringify({ concurrency: 99, plugins: {} }));
  assert.throws(() => loadConfig(dir, { env: {} }), SchemaInvalid);
});

test('.env is read, and process env wins over the file', () => {
  const dir = tmp();
  writeFileSync(join(dir, '.env'), 'A=from-file\nB="quoted value"\n# C=comment\n');
  const { env, envFileFound } = loadConfig(dir, { env: { A: 'from-process' } });
  assert.equal(envFileFound, true);
  assert.equal(env.A, 'from-process');
  assert.equal(env.B, 'quoted value');
  assert.equal(env.C, undefined);
});

test('parseEnvFile handles export, CRLF and bad lines', () => {
  const parsed = parseEnvFile('export X=1\r\nnot a pair\r\n=nokey\r\nY=\'two\'\r\n');
  assert.deepEqual(parsed, { X: '1', Y: 'two' });
});

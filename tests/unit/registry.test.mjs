import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigInvalid, ConfigMissing, SchemaInvalid } from '../../src/core/errors.mjs';
import { describeCondition, evaluate, getField, holds } from '../../src/registry/condition.mjs';
import { APPROACH_IDS, REGISTRY_DIR, loadApproaches } from '../../src/registry/load.mjs';
import { selectApproaches } from '../../src/registry/select.mjs';

const brief = {
  projectType: 'launch',
  tier: 'M',
  brand: { motionIntensity: 2, tone: ['bold'] },
  features: { interactive: ['scroll-story'], playIsThePoint: false },
  integrations: [],
};

test('getField follows dot paths and gives undefined for missing steps', () => {
  assert.equal(getField(brief, 'brand.motionIntensity'), 2);
  assert.equal(getField(brief, 'brand.colours.primary'), undefined);
  assert.equal(getField(brief, 'tier.length.x'), undefined);
});

test('condition operators', () => {
  const f = (field, op, value) => holds({ field, op, value }, brief);
  assert.equal(f('projectType', 'eq', 'launch'), true);
  assert.equal(f('projectType', 'neq', 'launch'), false);
  assert.equal(f('features.playIsThePoint', 'neq', true), true);
  assert.equal(f('client.name', 'neq', 'x'), true, 'a missing field is not equal to anything');
  assert.equal(f('tier', 'in', ['M', 'L']), true);
  assert.equal(f('client.name', 'in', ['x']), false);
  assert.equal(f('tier', 'notIn', ['S']), true);
  assert.equal(f('brand.motionIntensity', 'gte', 2), true);
  assert.equal(f('brand.motionIntensity', 'lte', 1), false);
  assert.equal(f('tier', 'gte', 1), false, 'gte on a non-number is false');
  assert.equal(f('features.interactive', 'includes', 'scroll-story'), true);
  assert.equal(f('features.interactive', 'includes', 'game'), false);
  assert.equal(f('client.name', 'includes', 'x'), false);
  assert.equal(holds({ field: 'integrations', op: 'exists' }, brief), false, 'an empty array does not exist');
  assert.equal(holds({ field: 'integrations', op: 'missing' }, brief), true);
  assert.equal(holds({ field: 'tier', op: 'exists' }, brief), true);
});

test('all, any and not combine leaves and report the leaves that matched', () => {
  const motion = { field: 'brand.motionIntensity', op: 'gte', value: 2 };
  const game = { field: 'features.interactive', op: 'includes', value: 'game' };
  assert.deepEqual(evaluate({ any: [motion, game] }, brief), { holds: true, matched: ['brand.motionIntensity gte 2'] });
  assert.deepEqual(evaluate({ all: [motion, game] }, brief), { holds: false, matched: [] });
  assert.equal(evaluate({ not: game }, brief).holds, true);
  assert.equal(describeCondition({ all: [motion, { not: game }] }), 'brand.motionIntensity gte 2 and not (features.interactive includes game)');
});

test('loadApproaches reads all eight approaches and the matrix', () => {
  const { approaches, matrix } = loadApproaches();
  assert.deepEqual(approaches.map((a) => a.id), APPROACH_IDS);
  assert.equal(matrix.registryVersion, approaches[0].registryVersion);
  for (const a of approaches) {
    if (a.id !== 'APP-01') assert.ok(a.fallback.triggers.length > 0, `${a.id} has fallback triggers`);
  }
});

test('APP-04 and APP-06 start as experimental for every project type where they are allowed', () => {
  const { matrix } = loadApproaches();
  for (const row of Object.values(matrix.matrix)) {
    assert.ok(['experimental', 'excluded'].includes(row['APP-04']));
    assert.ok(['experimental', 'excluded'].includes(row['APP-06']));
  }
});

function copyRegistry() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-registry-'));
  cpSync(REGISTRY_DIR, dir, { recursive: true });
  return dir;
}

test('loadApproaches rejects a missing registry, a misnamed file and a version mismatch', () => {
  assert.throws(() => loadApproaches(join(tmpdir(), 'no-such-registry')), ConfigMissing);

  const misnamed = copyRegistry();
  renameSync(join(misnamed, 'approaches', 'APP-08.json'), join(misnamed, 'approaches', 'APP-09.json'));
  assert.throws(() => loadApproaches(misnamed), ConfigInvalid);

  const missing = copyRegistry();
  rmSync(join(missing, 'approaches', 'APP-05.json'));
  assert.throws(() => loadApproaches(missing), (e) => e instanceof ConfigInvalid && /APP-05 appears 0 times/.test(e.hint));

  const version = copyRegistry();
  const file = join(version, 'approaches', 'APP-03.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), registryVersion: '9.9.9' }));
  assert.throws(() => loadApproaches(version), (e) => /registryVersion 9\.9\.9/.test(e.hint));

  const broken = copyRegistry();
  writeFileSync(join(broken, 'selection-matrix.json'), '{ not json');
  assert.throws(() => loadApproaches(broken), SchemaInvalid);
});

test('selectApproaches is deterministic and does not change its inputs', () => {
  const { approaches, matrix } = loadApproaches();
  const sample = JSON.parse(readFileSync(new URL('../../samples/briefs/flagship.json', import.meta.url), 'utf8'));
  const before = JSON.stringify([sample, approaches, matrix]);
  const now = new Date('2026-10-28T00:00:00Z');
  const a = selectApproaches(sample, approaches, matrix, { now });
  const b = selectApproaches(sample, approaches, matrix, { now });
  assert.deepEqual(a, b);
  assert.equal(a.decidedAt, '2026-10-28T00:00:00.000Z');
  assert.equal(JSON.stringify([sample, approaches, matrix]), before);
});

test('selectApproaches refuses an incomplete registry', () => {
  const { approaches, matrix } = loadApproaches();
  const sample = JSON.parse(readFileSync(new URL('../../samples/briefs/launch.json', import.meta.url), 'utf8'));
  assert.throws(() => selectApproaches(sample, approaches.slice(1), matrix), ConfigInvalid);
});

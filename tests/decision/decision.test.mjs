// T16 decision tests (acceptance criterion A6): for every approach, 3 qualifying and 3
// non-qualifying briefs give the expected result, and every selection records a fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaInvalid } from '../../src/core/errors.mjs';
import { loadApproaches } from '../../src/registry/load.mjs';
import { selectApproaches } from '../../src/registry/select.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-10-28T00:00:00Z');
const { approaches, matrix } = loadApproaches();
const readCase = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const select = (brief) => selectApproaches(brief, approaches, matrix, { now: NOW });

// Each negative case names the rule it exercises, so it cannot pass for the wrong reason.
const BECAUSE = {
  matrix: /excluded for \w+ in the selection matrix/,
  selectWhen: /does not meet/,
  rejectWhen: /rejected because/,
  plugin: /plugin, which is not in brief\.integrations/,
};

for (const entry of approaches) {
  test(`${entry.id} lists decision briefs that exist`, () => {
    for (const path of [...entry.tests.positiveBriefs, ...entry.tests.negativeBriefs]) {
      assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);
    }
  });

  for (const path of entry.tests.positiveBriefs) {
    test(`${entry.id} is selected: ${readCase(path).case}`, () => {
      const c = readCase(path);
      assert.equal(c.expect, 'selected');
      const d = select(c.brief).decisions.find((x) => x.approach === entry.id);
      assert.equal(d.selected, true, d.reason);
      if (entry.id !== 'APP-01') assert.equal(d.fallback.description, entry.fallback.description);
      if (d.matrixStatus === 'experimental') assert.match(d.needsApproval, /^B[12]$/);
    });
  }

  for (const path of entry.tests.negativeBriefs) {
    test(`${entry.id} is not selected: ${readCase(path).case}`, () => {
      const c = readCase(path);
      if (c.expect === 'refused') {
        // A brief Forge cannot build gets no decision at all, so not even APP-01.
        assert.throws(() => select(c.brief), SchemaInvalid);
        return;
      }
      assert.equal(c.expect, 'not-selected');
      const d = select(c.brief).decisions.find((x) => x.approach === entry.id);
      assert.equal(d.selected, false, d.reason);
      assert.match(d.reason, BECAUSE[c.because], `expected a ${c.because} rejection, got: ${d.reason}`);
    });
  }
}

test('every approach has 3 positive and 3 negative cases in tests/decision', () => {
  for (const entry of approaches) {
    const dir = join(ROOT, 'tests', 'decision', entry.id.replace('APP-', 'app'));
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.filter((f) => f.startsWith('pos-')).length, 3, entry.id);
    assert.equal(files.filter((f) => f.startsWith('neg-')).length, 3, entry.id);
  }
});

// The seven sample briefs, one per project type. Any change here is a change in what Forge
// builds for that kind of project, so it should be deliberate.
const SAMPLES = {
  business: ['APP-01'],
  event: ['APP-01', 'APP-05'],
  flagship: ['APP-01', 'APP-02', 'APP-03', 'APP-04', 'APP-07'],
  launch: ['APP-01', 'APP-02'],
  nonprofit: ['APP-01', 'APP-06'],
  portfolio: ['APP-01'],
  showroom: ['APP-01', 'APP-03'],
};

for (const [type, expected] of Object.entries(SAMPLES)) {
  test(`sample ${type} brief selects ${expected.join(', ')}`, () => {
    const brief = JSON.parse(readFileSync(join(ROOT, 'samples', 'briefs', `${type}.json`), 'utf8'));
    const record = select(brief);
    assert.deepEqual(
      record.decisions.filter((d) => d.selected).map((d) => d.approach),
      expected,
    );
    for (const d of record.decisions) assert.ok(d.reason.length > 5);
  });
}

test('experimental selections carry the approval they need: B1 for APP-06, B2 for APP-04', () => {
  const nonprofit = select(readCase('tests/decision/app06/pos-1.json').brief);
  assert.equal(nonprofit.decisions.find((d) => d.approach === 'APP-06').needsApproval, 'B1');
  const spline = select(readCase('tests/decision/app04/pos-1.json').brief);
  assert.equal(spline.decisions.find((d) => d.approach === 'APP-04').needsApproval, 'B2');
});

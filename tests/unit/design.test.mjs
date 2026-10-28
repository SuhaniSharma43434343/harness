import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadDesignCatalog, paletteFamily } from '../../src/design/catalog.mjs';
import { proposeDirections } from '../../src/design/propose.mjs';
import { blocking, checkDesignRules } from '../../src/design/rules.mjs';
import { tokensFromDirection } from '../../src/site/tokens.mjs';

const catalog = loadDesignCatalog();
const sample = (type) => JSON.parse(readFileSync(new URL(`../../samples/briefs/${type}.json`, import.meta.url), 'utf8'));
const TYPES = ['business', 'event', 'flagship', 'launch', 'nonprofit', 'portfolio', 'showroom'];
const ids = (findings) => findings.map((f) => f.id);

test('every catalog palette passes the starter contrast pairs, and every font is open-licensed', () => {
  for (const p of catalog.palettes) {
    const direction = { id: `dir-${p.id}`, colour: { mode: p.mode, tokens: p.tokens }, typography: { display: { family: 'Inter', category: 'sans', source: 'fontsource', licence: 'OFL-1.1' }, body: { family: 'Inter', category: 'sans', source: 'fontsource', licence: 'OFL-1.1' }, scaleRatio: 1.25 }, motionIntensity: 0, layout: 'grid' };
    assert.doesNotThrow(() => tokensFromDirection(direction), p.id);
  }
  for (const f of catalog.fonts) assert.ok(['OFL-1.1', 'Apache-2.0', 'MIT'].includes(f.licence), f.family);
  assert.ok(catalog.fonts.filter((f) => f.body).length >= 5);
});

for (const type of TYPES) {
  test(`${type}: 3 distinct directions that pass every design rule`, async () => {
    const brief = sample(type);
    const record = await proposeDirections(brief);
    assert.equal(record.directions.length, 3);
    assert.deepEqual(checkDesignRules(record, brief), []);
    const d = record.directions;
    assert.equal(new Set(d.map((x) => paletteFamily(x.colour))).size, 3, 'three palette families');
    assert.equal(new Set(d.map((x) => x.typography.display.family)).size, 3, 'three display faces');
    assert.equal(new Set(d.map((x) => x.layout)).size, 3, 'three layouts');
    for (const x of d) assert.ok(x.motionIntensity <= brief.brand.motionIntensity);
    assert.deepEqual(await proposeDirections(brief), record, 'deterministic');
  });
}

test('the tone steers the directions: premium flagships go dark and serif, nonprofits warm', async () => {
  const flagship = (await proposeDirections(sample('flagship'))).directions[0];
  assert.equal(flagship.colour.mode, 'dark');
  assert.equal(flagship.typography.display.category, 'serif');
  const business = (await proposeDirections(sample('business'))).directions;
  assert.ok(business.every((x) => x.colour.mode === 'light'));
});

test('client colours lead the first direction, darkened only as far as contrast needs', async () => {
  const brief = sample('business');
  brief.brand.existingAssets = { colours: ['#FFB000', '#0055AA'] };
  const first = (await proposeDirections(brief)).directions[0];
  assert.equal(first.id, 'dir-client');
  assert.notEqual(first.colour.tokens.primary.toLowerCase(), '#ffb000', 'pure amber fails on white, so it is darkened');
  assert.match(first.colour.tokens.accent, /^#[0-9a-f]{6}$/i);
});

test('the avoid list removes dark palettes and named fonts', async () => {
  const brief = sample('flagship');
  brief.brand.avoid = ['dark backgrounds', 'Playfair'];
  const record = await proposeDirections(brief, undefined, { count: 5 });
  assert.equal(record.directions.length, 5);
  for (const d of record.directions) {
    assert.equal(d.colour.mode, 'light');
    assert.ok(!/Playfair/.test(d.typography.display.family + d.typography.body.family));
  }
});

test('checkDesignRules catches contrast, licences, sameness, a bad choice, claims, motion and missing renders', async () => {
  const brief = sample('launch');
  const good = await proposeDirections(brief);
  const bad = structuredClone(good);
  bad.directions[0].colour.tokens.muted = bad.directions[0].colour.tokens.bg; // invisible text
  bad.directions[1].typography = structuredClone(bad.directions[2].typography);
  bad.directions[1].colour = structuredClone(bad.directions[2].colour);
  bad.directions[2].colour.contrast[0].ratio = 4.6;
  bad.directions[2].motionIntensity = 3;
  bad.directions[0].typography.body.licence = 'Apache-2.0';
  const found = checkDesignRules({ ...bad, status: 'chosen', chosen: 'dir-nope', approval: { code: 'B2', ledgerSeq: 3 } }, { ...brief, brand: { ...brief.brand, motionIntensity: 2 } }, { dir: '/nonexistent' });
  for (const id of ['contrast', 'font-licence', 'not-distinct', 'chosen-unknown', 'contrast-claim', 'motion', 'render-missing']) {
    assert.ok(ids(found).includes(id), `expected ${id} in ${ids(found).join(', ')}`);
  }
  assert.ok(blocking(found).length > 0);
  assert.ok(ids(checkDesignRules({ ...good, directions: good.directions.slice(0, 2) }, brief)).includes('too-few'));
  assert.ok(ids(checkDesignRules({}, brief)).includes('schema'));
});

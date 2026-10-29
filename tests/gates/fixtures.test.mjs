// T23: the gate fixtures. The gate suites (T21, T22) and the QA Verifier tests (T24) run on
// these: the blank site must fail every gate, the known-good site must pass every gate, and
// each seeded defect must be caught by the gate it names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import { FIXTURES_DIR, listDefects, materializeFixture } from '../../src/gates/fixtures.mjs';

const GATES = JSON.parse(readFileSync(new URL('../../schemas/gate-result.schema.json', import.meta.url), 'utf8')).properties.gate.enum;
const routes = (dist) =>
  readdirSync(dist, { recursive: true })
    .map((f) => String(f).replace(/\\/g, '/')) // readdirSync gives backslashes on Windows
    .filter((f) => f.endsWith('.html') && f !== '404.html');

test('the known-good site is complete: pages, sitemap, robots, register, locked content', () => {
  const { dir, siteDir } = materializeFixture('known-good');
  const dist = join(siteDir, 'dist');
  assert.deepEqual(routes(dist).sort(), ['contact/index.html', 'index.html', 'services/index.html']);
  for (const f of ['404.html', 'sitemap.xml', 'robots.txt']) assert.ok(existsSync(join(dist, f)), f);
  for (const f of ['content/pages/index.md', 'content/claims.json', 'research/sources.json', 'assets/register.json']) assert.ok(existsSync(join(dir, f)), f);
  for (const r of routes(dist)) {
    const doc = parse(readFileSync(join(dist, r), 'utf8'));
    assert.equal(doc.querySelectorAll('h1').length, 1, r);
    assert.ok(doc.querySelector('meta[name="description"]'), r);
    assert.ok(doc.querySelector('link[rel="canonical"]'), r);
  }
});

test('the blank site is an empty page with locked content waiting for it', () => {
  const { dir, siteDir } = materializeFixture('blank');
  const doc = parse(readFileSync(join(siteDir, 'dist', 'index.html'), 'utf8'));
  assert.equal(doc.querySelector('body').text.trim(), '');
  assert.ok(existsSync(join(dir, 'content', 'pages', 'index.md')));
});

test('every seeded defect applies cleanly and names a real gate', () => {
  const defects = listDefects();
  assert.ok(defects.length >= 20);
  const covered = new Set(defects.map((d) => d.gate));
  for (const gate of GATES) assert.ok(covered.has(gate), `no seeded defect for the ${gate} gate`);
  for (const d of defects) {
    assert.ok(GATES.includes(d.gate), `${d.id}: unknown gate ${d.gate}`);
    assert.ok(d.finding && d.description, d.id);
    assert.doesNotThrow(() => materializeFixture(d.id), d.id);
  }
});

test('a defect changes its copy, never the fixture itself', () => {
  const before = readFileSync(join(FIXTURES_DIR, 'known-good', 'site', 'dist', 'index.html'), 'utf8');
  const { siteDir } = materializeFixture('claim-unsourced');
  assert.match(readFileSync(join(siteDir, 'dist', 'index.html'), 'utf8'), /best-rated/);
  assert.equal(readFileSync(join(FIXTURES_DIR, 'known-good', 'site', 'dist', 'index.html'), 'utf8'), before);
});

test('a defect whose change no longer matches its base fails loudly', () => {
  assert.throws(
    () => materializeFixture('broken', { dir: fakeFixtures() }),
    /matches 0 times/,
  );
});

function fakeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-fixtures-'));
  cpSync(join(FIXTURES_DIR, 'known-good'), join(dir, 'known-good'), { recursive: true });
  mkdirSync(join(dir, 'defects'));
  writeFileSync(join(dir, 'defects', 'broken.json'), JSON.stringify({ base: 'known-good', gate: 'seo', finding: 'x', description: 'x', replace: [{ file: 'site/dist/index.html', find: 'not in the page', replace: '' }] }));
  return dir;
}

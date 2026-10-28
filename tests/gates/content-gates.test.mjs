// T21: the content, claims, licence, secrets, SEO and dependency gates. Each gate fails the blank
// site, passes the known-good site, and catches each of its seeded defects with the finding id
// the defect names (fixtures/sites/defects/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gateContext } from '../../src/gates/context.mjs';
import { listDefects, materializeFixture } from '../../src/gates/fixtures.mjs';
import { qualityFloor, runGate, runGates } from '../../src/gates/index.mjs';
import { licenceAllowed } from '../../src/gates/dependencies.mjs';
import { isClaim } from '../../src/gates/claims.mjs';
import { cmdGates } from '../../src/cli/gates.mjs';
import { createProject } from '../../src/core/project.mjs';
import { read as readLedger } from '../../src/core/ledger.mjs';

const CONTENT_GATES = ['content-parity', 'claims', 'licences', 'secrets', 'seo', 'dependencies'];
const NOW = () => new Date('2026-10-28T00:00:00Z');

for (const gate of CONTENT_GATES) {
  test(`${gate}: passes the known-good site`, async () => {
    const { siteDir } = materializeFixture('known-good');
    const r = await runGate(gate, siteDir, { now: NOW });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });

  test(`${gate}: fails the blank site`, async () => {
    const { siteDir } = materializeFixture('blank');
    const r = await runGate(gate, siteDir, { now: NOW });
    assert.equal(r.status, 'fail');
    assert.ok(r.findings.some((f) => f.severity === 'critical'));
  });

  test(`${gate}: fails when there is no build`, async () => {
    const { dir } = materializeFixture('known-good');
    const r = await runGate(gate, join(dir, 'missing-site'), { now: NOW });
    assert.equal(r.status, 'fail');
    assert.equal(r.findings[0].id, 'no-build');
  });

  for (const defect of listDefects().filter((d) => d.gate === gate)) {
    test(`${gate}: catches ${defect.id} as ${defect.finding}`, async () => {
      const { siteDir } = materializeFixture(defect.id);
      const r = await runGate(gate, siteDir, { now: NOW });
      assert.equal(r.status, 'fail');
      assert.ok(
        r.findings.some((f) => f.id === defect.finding),
        `expected ${defect.finding}, got ${r.findings.map((f) => f.id).join(', ')}`,
      );
    });
  }
}

test('secrets never prints the secret it found', async () => {
  const { siteDir } = materializeFixture('secret-in-bundle');
  const r = await runGate('secrets', siteDir);
  const text = readFileSync(join(siteDir, 'dist/_astro/form.js'), 'utf8');
  const key = /sk-ant-[A-Za-z0-9_-]+/.exec(text)?.[0] ?? /AKIA[0-9A-Z]{16}/.exec(text)?.[0];
  assert.ok(key, 'fixture has a key');
  assert.ok(!JSON.stringify(r).includes(key));
});

test('secrets: a .env.example is allowed, a source .env is not', async () => {
  const { siteDir } = materializeFixture('known-good');
  writeFileSync(join(siteDir, '.env.example'), 'FORMS_TOKEN=\n');
  assert.equal((await runGate('secrets', siteDir)).status, 'pass');
  writeFileSync(join(siteDir, '.env'), 'FORMS_TOKEN=x\n');
  const r = await runGate('secrets', siteDir);
  assert.deepEqual(r.findings.map((f) => f.id), ['env-file']);
});

test('seo: a preview build must be noindex, a production build must not be', async () => {
  const { siteDir } = materializeFixture('known-good');
  const preview = await runGate('seo', siteDir, { preview: true });
  assert.equal(preview.status, 'fail');
  assert.ok(preview.findings.some((f) => f.id === 'preview-indexable'));
  const file = join(siteDir, 'dist/index.html');
  writeFileSync(file, readFileSync(file, 'utf8').replace('<meta charset="utf-8">', '<meta charset="utf-8">\n    <meta name="robots" content="noindex">'));
  assert.ok((await runGate('seo', siteDir)).findings.some((f) => f.id === 'noindex'));
});

test('seo: a route missing from the sitemap and broken JSON-LD are serious', async () => {
  const { siteDir } = materializeFixture('known-good');
  const map = join(siteDir, 'dist/sitemap.xml');
  writeFileSync(map, readFileSync(map, 'utf8').replace(/\s*<url><loc>[^<]*contact[^<]*<\/loc><\/url>/, ''));
  const page = join(siteDir, 'dist/services/index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace('</head>', '<script type="application/ld+json">{"@type":</script></head>'));
  const ids = (await runGate('seo', siteDir)).findings.map((f) => f.id);
  assert.ok(ids.includes('sitemap-incomplete'));
  assert.ok(ids.includes('jsonld-invalid'));
});

test('claims: an unsourced claim within the allowance is reported but does not fail', async () => {
  const { siteDir } = materializeFixture('claim-unsourced');
  const r = await runGate('claims', siteDir, { thresholds: { maxUnsourced: 5 } });
  assert.equal(r.status, 'pass');
  assert.ok(r.findings.every((f) => f.severity === 'minor'));
});

test('claims: numbers, superlatives and "trusted by" are claims; plain copy is not', () => {
  for (const s of ['Over 40% faster than last year.', 'The best builder in Pune.', 'Trusted by 200 families.', 'Established in 2009.'])
    assert.ok(isClaim(s), s);
  for (const s of ['We build kitchens.', 'The price only changes if you change the plan.', 'Call us on weekdays.']) assert.ok(!isClaim(s), s);
});

test('dependencies: SPDX expressions', () => {
  assert.ok(licenceAllowed('MIT'));
  assert.ok(licenceAllowed('(MIT OR GPL-3.0)'));
  assert.ok(!licenceAllowed('MIT AND GPL-3.0'));
  assert.ok(!licenceAllowed('GPL-3.0-only'));
  assert.ok(!licenceAllowed(undefined));
});

test('dependencies: a recorded exception passes; a missing lockfile is serious', async () => {
  const { dir, siteDir } = materializeFixture('dependency-gpl');
  const failing = await runGate('dependencies', siteDir);
  const name = failing.findings[0].message.split('@')[0];
  const regFile = join(dir, 'assets/register.json');
  const reg = JSON.parse(readFileSync(regFile, 'utf8'));
  reg.assets.push({ package: name, licence: 'GPL-3.0', status: 'licensed', evidence: 'research/licences/gpl-exception.md', usage: 'build tool only' });
  writeFileSync(regFile, JSON.stringify(reg));
  assert.equal((await runGate('dependencies', siteDir)).status, 'pass');

  const { siteDir: other } = materializeFixture('known-good');
  rmSync(join(other, 'package-lock.json'));
  assert.deepEqual((await runGate('dependencies', other)).findings.map((f) => f.id), ['no-lockfile']);
});

test('a gate that throws is an error, never a pass', async () => {
  const { siteDir } = materializeFixture('known-good');
  writeFileSync(join(siteDir, 'package-lock.json'), '{not json');
  const r = await runGate('dependencies', siteDir);
  assert.equal(r.status, 'error');
  assert.ok(r.error.message);
  assert.deepEqual(qualityFloor([r], ['dependencies']), { met: false, failing: ['dependencies'] });
});

test('runGates writes evidence for each gate and qualityFloor needs every required gate', async () => {
  const { dir, siteDir } = materializeFixture('known-good');
  const results = await runGates(siteDir, { gates: CONTENT_GATES, now: NOW });
  assert.deepEqual(results.map((r) => r.gate), CONTENT_GATES);
  for (const g of CONTENT_GATES) assert.ok(existsSync(join(dir, 'evidence/gates', `${g}.json`)), g);
  assert.equal(qualityFloor(results, CONTENT_GATES).met, true);
  assert.deepEqual(qualityFloor(results).failing, ['routes', 'accessibility', 'forms', 'responsive', 'performance']);
});

test('gateContext lists routes without the 404 page', () => {
  const { siteDir } = materializeFixture('known-good');
  assert.deepEqual(gateContext(siteDir).routes(), ['/', '/contact', '/services']);
});

test('forge gates runs the gates on a project and records gate_result entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const workspace = join(root, 'ws');
  createProject('harbor', { workspace });
  cpSync(materializeFixture('known-good').dir, join(workspace, 'harbor'), { recursive: true });
  const { log } = console;
  const out = [];
  console.log = (...a) => out.push(a.join(' '));
  let code;
  try {
    code = await cmdGates(root, ['harbor', ...CONTENT_GATES.flatMap((g) => ['--gate', g])]);
  } finally {
    console.log = log;
  }
  assert.equal(code, 0, out.join('\n'));
  assert.match(out.join('\n'), /Quality floor met/);
  const entries = readLedger('harbor', { workspace }).filter((e) => e.type === 'gate_result');
  assert.deepEqual(entries.map((e) => e.data.gate), CONTENT_GATES);
  assert.ok(entries.every((e) => e.data.status === 'pass'));
});

test('seo: a sitemap with root-relative locations (no site URL yet) still lists every route', async () => {
  const { siteDir } = materializeFixture('known-good');
  const map = join(siteDir, 'dist/sitemap.xml');
  writeFileSync(map, readFileSync(map, 'utf8').replaceAll('https://harbor-home.example', ''));
  assert.ok(!(await runGate('seo', siteDir)).findings.some((f) => f.id === 'sitemap-incomplete'));
});

test('dependencies: an optional build-machine binary is reported but does not block', async () => {
  const { siteDir } = materializeFixture('known-good');
  const lockFile = join(siteDir, 'package-lock.json');
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  lock.packages['node_modules/@img/sharp-libvips-linux-x64'] = { version: '1.3.4', license: 'LGPL-3.0-or-later', optional: true, os: ['linux'], cpu: ['x64'] };
  writeFileSync(lockFile, JSON.stringify(lock));
  const r = await runGate('dependencies', siteDir);
  assert.equal(r.status, 'pass');
  assert.deepEqual(r.findings.map((f) => [f.id, f.severity]), [['build-binary-licence', 'moderate']]);
});

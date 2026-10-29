import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, toMarkdown } from '../../src/core/audit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

// A tiny harness: no lockfiles (so no npm audit), a package, and a workspace.
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'forge-audit-'));
  for (const f of ['VERSION', 'package.json']) cpSync(join(ROOT, f), join(root, f));
  mkdirSync(join(root, 'workspace', 'harbor-home', 'reports'), { recursive: true });
  writeFileSync(join(root, 'workspace', 'harbor-home', 'reports', 'status.md'), '# Status\nAll good.\n');
  return root;
}

test('a clean harness passes, and the report is written as Markdown and JSON', () => {
  const root = harness();
  const r = runAudit({ root, secrets: [], now: new Date('2026-10-29T00:00:00Z') });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.deepEqual(r.files.map((f) => f.split(/[\\/]/).pop()), ['audit-2026-10-29.md', 'audit-2026-10-29.json']);
  assert.match(readFileSync(r.files[0], 'utf8'), /Result: \*\*pass\*\*/);
});

test('a credential in a project report fails the audit, and the report never repeats it', () => {
  const root = harness();
  writeFileSync(join(root, 'workspace', 'harbor-home', 'reports', 'final.md'), `deployed with ${GITHUB}\n`);
  const r = runAudit({ root, secrets: [] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.secrets.map((f) => [f.file, f.id]), [['workspace/harbor-home/reports/final.md', 'github-token']]);
  for (const f of r.files) assert.ok(!readFileSync(f, 'utf8').includes(GITHUB), f);
});

test('high and critical advisories fail the report; the table lists each one', () => {
  const md = toMarkdown({
    date: '2026-10-29',
    ok: false,
    problems: ['tools: 1 high advisory'],
    dependencies: [{ lockfile: 'tools/package-lock.json', counts: { critical: 0, high: 1, moderate: 0, low: 0 }, advisories: [{ name: 'zod', severity: 'high', range: '<4.6.6', fix: 'available' }] }],
    package: { files: 10, findings: [] },
    secrets: [],
  });
  assert.match(md, /Result: \*\*fail\*\*: tools: 1 high advisory/);
  assert.match(md, /\| `tools\/package-lock.json` \| zod \| high \| <4.6.6 \| available \|/);
});

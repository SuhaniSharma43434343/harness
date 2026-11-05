import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isClaim } from '../../src/gates/claims.mjs';
import { operationalClaims, CHECKS } from '../../src/design/spec.mjs';
import { visualReviewGate, distHash, syncContent } from '../../src/qa/visual.mjs';
import { mergeReview } from '../../src/qa/defects.mjs';

// P1 quality upgrades: the write-time fact firewall, review scores as telemetry, escalated
// defects closing when fixed, and shipping only referenced assets.

const write = (dir, file, data) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  writeFileSync(join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

test('operational specifics are claims: times, prices and durations, but never layout numbers', () => {
  for (const s of ['Doors are sealed at 9:00', 'Open from 8 am', 'The caramel cold coffee is ₹120', 'A kitchen takes 4 to 6 weeks', 'Swept clean at 4:30pm every day']) {
    assert.equal(isClaim(s), true, s);
  }
  for (const s of ['A 3:2 crop with the focus on the tub', 'The title sits at 8.5rem across 16:9 frames', 'Offset by a third']) {
    assert.equal(isClaim(s), false, s);
  }
  // Percentages were already claims before this change (the claims gate's original list), and
  // that stands for page copy; the plan-side operational check is the one that must ignore them.
  assert.equal(isClaim('A 6% grain over the photo'), true);
});

test('a section plan may not invent operational facts, and a claims row covers legitimate ones', () => {
  const section = (composition) => ({ id: 's', purpose: 'Explain the day on site', pattern: 'statement', composition, hierarchy: 'Headline, then the list of steps' });
  assert.deepEqual(operationalClaims(section('A 3:2 photo at 8.5rem beside a 16:9 frame with 6% grain')), []);
  const hits = operationalClaims(section('A timeline from 9:00 to 4:30pm, each step priced from ₹120, over 5 weeks'));
  assert.ok(hits.includes('9:00') && hits.some((h) => /4:30\s*pm/i.test(h)) && hits.some((h) => h.includes('120')) && hits.some((h) => /5\s*weeks/.test(h)), JSON.stringify(hits));
});

test('the visual-review gate treats scores as telemetry: only concrete findings block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-p1-'));
  try {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.html'), '<html></html>');
    const review = {
      buildHash: distHash(join(dir, 'dist')),
      verdict: 'fail',
      approachPreserved: true,
      scores: { distinctiveness: 3.0, composition: 3.2, typography: 4, contentFit: 3.4, specFidelity: 3.0 },
      findings: [],
    };
    write(dir, 'reports/visual-review.json', review);
    const r = visualReviewGate.run({ projectDir: dir, dist: join(dir, 'dist') }, visualReviewGate.thresholds);
    assert.ok(r.findings.length >= 3, 'low scores are still reported');
    assert.ok(r.findings.every((f) => !['critical', 'serious'].includes(f.severity)), `nothing blocks on scores alone: ${JSON.stringify(r.findings)}`);
    // A concrete serious finding still blocks.
    review.findings = [{ id: 'title-on-cup', severity: 'serious', section: 'her-recipe', message: 'The title sits on the cup, not the empty wood the plan names; move it onto the cream field', evidence: 'evidence/visual/x.jpg' }];
    write(dir, 'reports/visual-review.json', review);
    const r2 = visualReviewGate.run({ projectDir: dir, dist: join(dir, 'dist') }, visualReviewGate.thresholds);
    assert.ok(r2.findings.some((f) => f.severity === 'serious' && f.id === 'title-on-cup'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an escalated defect that no longer reproduces is verified on the next review', () => {
  const previous = {
    schemaVersion: '0.1.0', project: 'demo', review: 3, updatedAt: new Date().toISOString(),
    qualityFloor: { met: false, failing: ['visual-review'] },
    defects: [{ id: 'D-001', key: 'visual-review|title-on-cup|her-recipe', gate: 'visual-review', finding: 'title-on-cup', severity: 'serious', message: 'm', status: 'escalated', foundIn: 1, evidence: ['e.jpg'], history: [{ review: 1, status: 'found' }] }],
    advisories: 0, escalated: true,
  };
  const report = mergeReview(previous, {
    project: 'demo', number: 4, now: new Date(),
    results: [{ gate: 'visual-review', status: 'pass', findings: [] }],
    evidenceFor: () => ['evidence/visual/fresh.jpg'],
    floor: { met: true, failing: [] },
  });
  assert.equal(report.defects[0].status, 'verified');
});

test('syncContent ships only the asset files something references', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-p1-sync-'));
  try {
    write(dir, 'assets/public/images/used.jpg', 'x');
    write(dir, 'assets/public/images/unused.jpg', 'x');
    write(dir, 'site/src/sections/APP-01/Hero.astro', '<img src="/images/used.jpg" />');
    syncContent(dir);
    assert.equal(existsSync(join(dir, 'site/public/images/used.jpg')), true);
    assert.equal(existsSync(join(dir, 'site/public/images/unused.jpg')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

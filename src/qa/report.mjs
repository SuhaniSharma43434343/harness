import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_ORDER } from '../gates/index.mjs';

// The QA/QC report: reports/qa-report.md, rewritten after every review so it always describes
// the current state. reports/defects.json stays the machine-readable truth and qa-log.md the
// append-only history; this is the hand-over document - what was tested, what is wrong, how to
// reproduce it, and what was left unchecked. It never claims a check that did not run: a gate
// that errored or was skipped is listed as a limitation, not a pass.

const FINAL = { verified: 'Verified fixed', open: 'Open', escalated: 'Escalated to the operator' };

// The five evaluation parameters, and the gates that evidence each. Creativity rests on a model's
// review of screenshots, which is judgement, not measurement, so the report says so. The release
// gates (licences, secrets, dependencies) protect the release rather than answer a parameter.
export const PARAMETERS = [
  { name: 'Usability', gates: ['routes', 'forms', 'interactions', 'performance'], basis: 'measured' },
  { name: 'Design', gates: ['accessibility', 'design-fidelity'], basis: 'measured' },
  { name: 'Creativity', gates: ['visual-review'], basis: 'judgement' },
  { name: 'Content', gates: ['content-parity', 'claims', 'seo'], basis: 'measured' },
  { name: 'Responsiveness', gates: ['responsive'], basis: 'measured' },
];
export const RELEASE_GATES = ['licences', 'secrets', 'dependencies'];

function parameterRows(results) {
  const by = new Map(results.map((r) => [r.gate, r]));
  const verdict = (gates) => {
    const ran = gates.map((g) => by.get(g)).filter(Boolean);
    if (!ran.length) return 'not checked in this review';
    if (ran.some((r) => r.status === 'error' || r.status === 'skipped')) return 'incomplete: a gate did not run';
    const failing = ran.filter((r) => r.status === 'fail').map((r) => r.gate);
    const unrun = gates.filter((g) => !by.has(g));
    const base = failing.length ? `fails (${failing.join(', ')})` : 'passes';
    return unrun.length ? `${base}; not checked: ${unrun.join(', ')}` : base;
  };
  return [...PARAMETERS, { name: 'Release safety', gates: RELEASE_GATES, basis: 'measured' }].map((p) => `| ${p.name} | ${verdict(p.gates)} | ${p.gates.join(', ')} | ${p.basis === 'judgement' ? 'A model reviewing screenshots: judgement, not measurement' : 'Automated gates'} |`);
}
// Page text reaches defect messages (console errors, headings); one line each, no table breaks.
const clean = (t) => String(t).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

export function writeQaReport(dir, project, report, results, at = new Date()) {
  const lines = [];
  const floor = report.qualityFloor;
  const scope = results.map((r) => r.gate);
  const outOfScope = GATE_ORDER.filter((g) => !scope.includes(g));
  const floorLabel = outOfScope.length ? `Quality floor over the gates in scope (${scope.join(', ')})` : 'Quality floor';
  lines.push(`# QA/QC report: ${project}`, '');
  lines.push(`Review ${report.review}, ${at.toISOString()}. ${floorLabel}: ${floor.met ? 'met' : `**not met** (${floor.failing.join(', ')})`}.`, '');
  lines.push('Written by the QA Verifier from gate evidence. A defect is closed only when a later review, with fresh evidence, no longer finds it; nothing here rests on a builder\'s own report.', '');

  lines.push('## By parameter', '');
  lines.push('| Parameter | Result | Gates | Basis |', '| --- | --- | --- | --- |', ...parameterRows(results), '');

  lines.push('## What was tested', '');
  lines.push('| Gate | Status | Findings | Evidence |', '| --- | --- | --- | --- |');
  for (const r of results) lines.push(`| ${r.gate} | ${r.status} | ${r.findings.length} | evidence/qa/review-${report.review}/${r.gate}.json |`);
  lines.push('');

  const defects = report.defects ?? [];
  lines.push('## Defects', '');
  if (!defects.length) lines.push('None found.', '');
  for (const d of defects) {
    lines.push(`### ${d.id} - ${d.finding} (${d.severity}, ${d.gate})`, '');
    lines.push(`- Status: ${FINAL[d.status] ?? d.status}${d.verifiedIn ? ` in review ${d.verifiedIn}` : ''}`);
    if (d.location) lines.push(`- Where: ${d.location}`);
    lines.push(`- What is wrong: ${clean(d.message)}`);
    lines.push(`- Reproduce: \`forge gates ${project} --gate ${d.gate}\` (finding \`${d.finding}\`)`);
    lines.push(`- Found in review ${d.foundIn}; evidence: ${d.evidence.join(', ')}`);
    if (d.fixTasks?.length) lines.push(`- Repair tasks: ${d.fixTasks.join(', ')}`);
    if (d.verification?.length) lines.push(`- Verification evidence: ${d.verification.join(', ')}`);
    lines.push('');
  }

  if (report.advisories) {
    lines.push('## Advisories', '');
    lines.push(`${report.advisories} moderate or minor finding(s) in the latest review did not block: see evidence/qa/review-${report.review}/ for each gate's full list.`, '');
  }

  const unchecked = results.filter((r) => r.status === 'error' || r.status === 'skipped');
  const limitations = [
    ...(outOfScope.length ? [`This review ran ${scope.length} of the ${GATE_ORDER.length} default gates. Not in scope, so not covered here: ${outOfScope.join(', ')}.`] : []),
    ...unchecked.map((r) => `The ${r.gate} gate did not run (${r.status}): ${clean(r.error?.message ?? 'no reason recorded')}. Nothing it checks is covered by this review.`),
    ...(report.escalated ? ['Open defects were escalated to the operator after the repair-loop cap: see reports/escalation.md.'] : []),
    ...(report.discarded ? [`${report.discarded} finding(s) were discarded because their evidence could not be written.`] : []),
  ];
  lines.push('## Limitations', '');
  if (!limitations.length) lines.push('Every gate in this review ran to completion.', '');
  else lines.push(...limitations.map((l) => `- ${l}`), '');

  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'reports', 'qa-report.md'), lines.join('\n') + '\n');
  return join(dir, 'reports', 'qa-report.md');
}

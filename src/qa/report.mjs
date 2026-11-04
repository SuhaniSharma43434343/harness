import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The QA/QC report: reports/qa-report.md, rewritten after every review so it always describes
// the current state. reports/defects.json stays the machine-readable truth and qa-log.md the
// append-only history; this is the hand-over document - what was tested, what is wrong, how to
// reproduce it, and what was left unchecked. It never claims a check that did not run: a gate
// that errored or was skipped is listed as a limitation, not a pass.

const FINAL = { verified: 'Verified fixed', open: 'Open', escalated: 'Escalated to the operator' };

export function writeQaReport(dir, project, report, results, at = new Date()) {
  const lines = [];
  const floor = report.qualityFloor;
  lines.push(`# QA/QC report: ${project}`, '');
  lines.push(`Review ${report.review}, ${at.toISOString()}. Quality floor: ${floor.met ? 'met' : `**not met** (${floor.failing.join(', ')})`}.`, '');
  lines.push('Written by the QA Verifier from gate evidence. A defect is closed only when a later review, with fresh evidence, no longer finds it; nothing here rests on a builder\'s own report.', '');

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
    lines.push(`- What is wrong: ${d.message}`);
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
    ...unchecked.map((r) => `The ${r.gate} gate did not run (${r.status}): ${r.error?.message ?? 'no reason recorded'}. Nothing it checks is covered by this review.`),
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

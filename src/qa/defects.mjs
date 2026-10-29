import { assertValid } from '../core/schemas.mjs';

const BLOCKING = new Set(['critical', 'serious']);

export const defectKey = (gate, finding, location) => `${gate}|${finding}|${location ?? ''}`;

// The blocking findings of one review, as candidate defects. A gate that errored is a critical
// defect of its own (gate-error), because an unchecked gate is never a pass.
export function blockingFindings(results) {
  const out = [];
  for (const r of results) {
    if (r.status === 'error' || r.status === 'skipped') {
      out.push({ gate: r.gate, finding: `gate-${r.status}`, severity: 'critical', message: `${r.gate} could not run: ${r.error?.code ?? ''} ${r.error?.message ?? ''}`.trim() });
      continue;
    }
    for (const f of r.findings) if (BLOCKING.has(f.severity)) out.push({ gate: r.gate, finding: f.id, severity: f.severity, message: f.message, location: f.location, evidence: f.evidence });
  }
  return out;
}

// mergeReview(previous, review) => DefectReport
// Pure. Matches the new review's blocking findings to the known defects by key:
//  - an open defect the review no longer finds is verified, with this review's evidence;
//  - an open defect it still finds stays open ("still-open");
//  - a verified defect that comes back is reopened;
//  - anything new is a new defect.
// review: { project, number, now, results, evidenceFor(gate) => string[] | null, floor }
// evidenceFor returns the evidence files written for a gate in this review; a finding whose
// gate has no evidence is discarded (plan: a finding without evidence is discarded).
export function mergeReview(previous, review) {
  const defects = structuredClone(previous?.defects ?? []);
  const byKey = new Map(defects.map((d) => [d.key, d]));
  let next = defects.reduce((n, d) => Math.max(n, Number(d.id.slice(2))), 0);
  const seen = new Set();
  let discarded = 0;

  for (const f of blockingFindings(review.results)) {
    const evidence = review.evidenceFor(f.gate);
    if (!evidence?.length) {
      discarded++;
      continue;
    }
    const key = defectKey(f.gate, f.finding, f.location);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = byKey.get(key);
    if (!known) {
      next++;
      const d = {
        id: `D-${String(next).padStart(3, '0')}`,
        key,
        gate: f.gate,
        finding: f.finding,
        severity: f.severity,
        message: f.message,
        ...(f.location ? { location: f.location } : {}),
        status: 'open',
        foundIn: review.number,
        evidence,
        history: [{ review: review.number, status: 'found' }],
      };
      defects.push(d);
      byKey.set(key, d);
    } else if (known.status === 'verified') {
      known.status = 'open';
      known.evidence = evidence;
      delete known.verifiedIn;
      delete known.verification;
      known.history.push({ review: review.number, status: 'reopened', note: 'Found again after it was verified' });
    } else if (known.status === 'open') {
      known.evidence = evidence;
      known.message = f.message;
      known.history.push({ review: review.number, status: 'still-open' });
    }
  }

  // Open defects this review did not find are verified, but only for gates that ran and left
  // evidence in this review: a gate that was not re-run proves nothing.
  const ran = new Set(review.results.filter((r) => r.status === 'pass' || r.status === 'fail').map((r) => r.gate));
  for (const d of defects) {
    if (d.status !== 'open' || seen.has(d.key) || !ran.has(d.gate)) continue;
    const evidence = review.evidenceFor(d.gate);
    if (!evidence?.length) continue;
    d.status = 'verified';
    d.verifiedIn = review.number;
    d.verification = evidence;
    d.history.push({ review: review.number, status: 'verified' });
  }

  const advisories = review.results.reduce((n, r) => n + r.findings.filter((f) => !BLOCKING.has(f.severity) && f.severity !== 'info').length, 0);
  return assertValid('defectReport', {
    schemaVersion: '0.1.0',
    project: review.project,
    review: review.number,
    updatedAt: review.now.toISOString(),
    qualityFloor: review.floor,
    defects,
    advisories,
    ...(discarded ? { discarded } : {}),
    ...(previous?.escalated ? { escalated: true } : {}),
  });
}

export const openDefects = (report) => (report?.defects ?? []).filter((d) => d.status === 'open');

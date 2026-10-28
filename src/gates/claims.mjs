import { normalise, visibleText } from './context.mjs';

// Sentences that make a checkable claim: numbers and percentages, superlatives, rankings,
// awards, years in business, "trusted by". Each one needs a source in research/sources.json
// or a client flag, recorded in content/claims.json (plan target: 0 unsourced claims).
const CLAIM = [
  /\b\d[\d,.]*\s*(%|percent|x\b|times\b|\+)/i,
  /\b(more|over|fewer|less) than \d/i,
  /\b(since|established|founded)( in)? (1[89]|20)\d\d\b/i,
  /\b(best|leading|largest|biggest|fastest|cheapest|top-rated|best-rated|highest-rated|most trusted|number one|no\. ?1|#1|award-winning|award winning|world-class|the only)\b/i,
  /\b(trusted|used|chosen|loved) by\b/i,
  /\b(guarantee[ds]?|certified|accredited|proven)\b/i,
];

const sentences = (text) => text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).map((s) => s.trim()).filter(Boolean);
export const isClaim = (s) => CLAIM.some((re) => re.test(s));

export default {
  name: 'claims',
  version: '0.1.0',
  thresholds: { maxUnsourced: 0 },
  run(ctx, t) {
    const findings = [];
    const register = ctx.json('content/claims.json', { claims: [] }).claims ?? [];
    const sources = new Set((ctx.json('research/sources.json', { sources: [] }).sources ?? []).map((s) => s.id));
    const covered = [];
    for (const c of register) {
      const ok = c.clientFlag === true || (c.source && sources.has(c.source));
      if (!ok) findings.push({ id: c.source ? 'unknown-source' : 'no-source', severity: 'serious', message: c.source ? `Claim "${c.text}" cites ${c.source}, which is not in research/sources.json` : `Claim "${c.text}" has no source and no client flag` });
      else covered.push(normalise(c.text).toLowerCase());
    }

    let checked = 0;
    let unsourced = 0;
    for (const route of ctx.routes()) {
      const text = visibleText(ctx.doc(route));
      for (const s of sentences(text)) {
        if (!isClaim(s)) continue;
        checked++;
        const lower = s.toLowerCase();
        if (covered.some((c) => lower.includes(c) || c.includes(lower))) continue;
        unsourced++;
        findings.push({ id: 'unsourced-claim', severity: 'serious', message: `Claim without a source or client flag: "${s.slice(0, 160)}"`, location: route });
      }
    }
    // Within the allowance (plan target 0), unsourced claims are reported but do not fail.
    if (unsourced <= t.maxUnsourced) for (const f of findings) if (f.id === 'unsourced-claim') f.severity = 'minor';
    return { findings, metrics: { claimsChecked: checked, unsourced, registered: register.length } };
  },
};

// renderPlan(brief, decision, estimate) => string: intake/plan.md, shown to the operator at B1.
// Built only from the files it is given, so it never says more than they do.
export function renderPlan(brief, decision, estimate) {
  const selected = decision?.decisions.filter((d) => d.selected) ?? [];
  const approvals = [...new Set(selected.map((d) => d.needsApproval).filter(Boolean))];
  const lines = [
    `# Plan: ${brief.client.name}`,
    '',
    `Project \`${brief.project}\`, a ${brief.projectType} site at tier ${brief.tier}. Status: ${brief.status}.`,
    '',
    '## Goals',
    '',
    ...brief.goals.map((g) => `- ${g.statement}${g.metric ? ` (measured by ${g.metric})` : ''}`),
    '',
    '## Audience',
    '',
    ...brief.audience.map((a) => `- ${a.segment}: ${a.need}`),
    '',
    '## Pages',
    '',
    '| Page | Purpose | Call to action |',
    '| --- | --- | --- |',
    ...brief.pages.map((p) => `| ${p.title} (\`${p.slug}\`) | ${p.purpose} | ${p.cta} |`),
    '',
    '## Approaches',
    '',
  ];
  if (decision) {
    for (const d of selected) lines.push(`- **${d.approach}**: ${d.reason}${d.fallback ? ` Fallback: ${d.fallback.description}.` : ''}`);
    if (approvals.length) lines.push('', `Experimental approaches need ${approvals.join(' and ')} before they are built.`);
  } else {
    lines.push('Not selected yet (P3).');
  }
  lines.push(
    '',
    '## Estimate',
    '',
    `${estimate.hours.min} to ${estimate.hours.max} hours, ${estimate.cost.min} to ${estimate.cost.max} ${estimate.cost.currency} (rates ${estimate.rateVersion}).`,
    '',
    '| Item | Hours |',
    '| --- | --- |',
    ...(estimate.lines ?? []).map((l) => `| ${l.item} | ${l.hours.min} to ${l.hours.max} |`),
    '',
    '## Assumptions',
    '',
  );
  const notes = estimate.assumptions;
  lines.push(...(notes.length ? notes.map((a) => `- ${a}`) : ['None.']));
  lines.push(
    '',
    '## Next steps',
    '',
    `1. The operator reviews this plan, \`intake/brief.json\` and \`intake/estimate.json\`, then approves with \`forge approve ${brief.project} B1\`.`,
    '2. Research (P2), then approach selection (P3) and three or more creative directions (P4), approved at B2.',
    '3. Content is locked at B3, the preview is accepted at B6, and production deploy needs B7.',
    '',
  );
  return lines.join('\n');
}

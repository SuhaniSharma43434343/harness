// What the site is built to make happen for this kind of business, in the operator's words.
function businessLines(brief) {
  const b = brief.business;
  if (!b?.primaryConversion) return [];
  const lines = [
    '## What the site is built to do',
    '',
    `Industry playbook: **${b.industryId}**. The whole site leads to one action: **${b.primaryConversion.label}**.`,
    '',
    'The home hero must show:',
    '',
    ...(b.heroMustHave ?? []).map((h) => `- ${h}`),
    '',
  ];
  if (b.contentNeeds?.length) lines.push('Material the client should supply:', '', ...b.contentNeeds.map((c) => `- ${c}`), '');
  if (b.compliance?.length) lines.push('Rules for the copy in this industry:', '', ...b.compliance.map((c) => `- ${c}`), '');
  return lines;
}

// What only this business can claim. With fewer than three, the first deliverable is questions
// for the client, not a design, and the plan says so.
function truthLines(brief) {
  const truths = brief.truths ?? [];
  const lines = ['## What only this business can claim', ''];
  if (truths.length) lines.push(...truths.map((t) => `- ${t.text}${t.kind ? ` (${t.kind})` : ''}`), '');
  if (truths.length < 3) lines.push(`**${truths.length ? `Only ${truths.length}` : 'None'} given.** The design rests on one of these facts, so with fewer than three the first deliverable is questions for the client, not a design.`, '');
  return lines;
}

// Day-one access: what is in hand, and what to ask the client for now.
function accessLines(brief) {
  const a = brief.access ?? {};
  const ask = [];
  if (!a.domain?.name) ask.push('the domain name');
  if (!a.domain?.status || a.domain.status === 'unknown') ask.push('who controls the domain');
  if (!a.dns || a.dns === 'unknown') ask.push('DNS access');
  for (const x of a.assets ?? []) if (x.quality === 'unknown') ask.push(`the quality of the ${x.item}`);
  if (!(a.assets ?? []).length) ask.push('what material exists (logo, photos, video, copy, menus, current site, social feeds) and how good each is');
  const lines = ['## Day-one access', ''];
  if (a.domain?.name || a.domain?.status) lines.push(`- Domain: ${a.domain.name ?? 'not named'}${a.domain.status ? ` (${a.domain.status})` : ''}`);
  if (a.dns) lines.push(`- DNS: ${a.dns}`);
  for (const x of a.assets ?? []) lines.push(`- ${x.item}: ${x.quality}${x.where ? `, ${x.where}` : ''}`);
  if (ask.length) lines.push(...(lines.length > 2 ? [''] : []), `**Ask the client for, now:** ${ask.join('; ')}.`);
  return [...lines, ''];
}

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
    ...brief.audience.map((a) => `- ${a.segment}: ${a.need}${[['wants', 'wants'], ['needs to see', 'proof'], ['should', 'action'], ['arrives from', 'arrivesFrom'], ['mood', 'mood']].filter(([, k]) => a[k]?.length).map(([l, k]) => `; ${l}: ${[a[k]].flat().join(', ')}`).join('')}`),
    '',
    ...businessLines(brief),
    ...truthLines(brief),
    ...(brief.jobs?.length ? ['## One-tap jobs', '', 'Every page gives a visitor these in one tap:', '', ...brief.jobs.map((j) => `- ${j}`), ''] : []),
    ...(brief.contentRules?.length ? ['## Content rules', '', 'The copy check refuses copy that breaks these.', '', ...brief.contentRules.map((r) => `- ${r.rule === 'never' ? 'Never' : 'Always'} on ${r.pages.map((x) => (x === '*' ? 'every page' : `\`${x}\``)).join(', ')}: "${r.text}"${r.note ? ` (${r.note})` : ''}`), ''] : []),
    ...accessLines(brief),
    '## Pages',
    '',
    `${brief.pages.length} pages.`,
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

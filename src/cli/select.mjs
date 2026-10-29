import { readFileSync } from 'node:fs';
import { loadApproaches } from '../registry/load.mjs';
import { selectApproaches } from '../registry/select.mjs';

// forge select <brief.json> [--json]: show which approaches the selector picks for a brief, and why.
// It only reads; P3 writes design/approach-decision.json through the runner.
export function cmdSelect(args) {
  const file = args.find((a) => !a.startsWith('-'));
  if (!file) {
    console.error('Usage: forge select <brief.json> [--json]');
    return 2;
  }
  const brief = JSON.parse(readFileSync(file, 'utf8'));
  const { approaches, matrix } = loadApproaches();
  const record = selectApproaches(brief, approaches, matrix);
  if (args.includes('--json')) {
    console.log(JSON.stringify(record, null, 2));
    return 0;
  }
  console.log(`${brief.project} (${brief.projectType}, tier ${brief.tier}), registry ${record.registryVersion}\n`);
  for (const d of record.decisions) {
    const mark = d.selected ? 'yes' : 'no ';
    const approval = d.needsApproval ? ` [needs ${d.needsApproval}]` : '';
    console.log(`  ${d.approach}  ${mark}  ${d.reason}${approval}`);
    if (d.fallback) console.log(`                fallback: ${d.fallback.description}`);
  }
  return 0;
}

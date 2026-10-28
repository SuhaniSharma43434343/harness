import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import * as ledger from '../core/ledger.mjs';
import { loadProject } from '../core/project.mjs';
import { GATE_ORDER, GATES, qualityFloor, runGates } from '../gates/index.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const USAGE = `Usage: forge gates <project> [--gate <name>]... [--preview] [--json]\nGates: ${GATE_ORDER.join(', ')}`;

// forge gates: runs the automated gates on workspace/<project>/site, writes evidence/gates/<gate>.json
// and one gate_result ledger entry per gate, and exits 1 unless the quality floor is met.
export async function cmdGates(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const gates = args.flatMap((a, i) => (args[i - 1] === '--gate' ? [a] : []));
  const unknown = gates.filter((g) => !GATE_ORDER.includes(g));
  if (unknown.length) {
    console.error(`Unknown gate: ${unknown.join(', ')}\n${USAGE}`);
    return 2;
  }
  const workspace = workspaceFor(root);
  loadProject(project, { workspace });
  const dir = join(workspace, project);
  const available = (gates.length ? gates : GATE_ORDER).filter((g) => GATES.has(g));
  const results = await runGates(join(dir, 'site'), { project, projectDir: dir, gates: available, preview: args.includes('--preview') });
  for (const r of results) {
    ledger.append(project, { actor: 'qa', type: 'gate_result', data: { gate: r.gate, status: r.status, findings: r.findings.length, evidence: `evidence/gates/${r.gate}.json` } }, { workspace });
  }
  const floor = qualityFloor(results, gates.length ? gates : GATE_ORDER);

  if (args.includes('--json')) {
    console.log(JSON.stringify({ results, qualityFloor: floor }, null, 2));
    return floor.met ? 0 : 1;
  }
  for (const r of results) {
    console.log(`${r.status.toUpperCase().padEnd(7)} ${r.gate}${r.error ? `: ${r.error.code} ${r.error.message}` : ''}`);
    for (const f of r.findings) console.log(`          ${f.severity.padEnd(8)} ${f.id}: ${f.message}`);
  }
  const notBuilt = (gates.length ? gates : GATE_ORDER).filter((g) => !GATES.has(g));
  if (notBuilt.length) console.log(`No result (gate not available yet): ${notBuilt.join(', ')}`);
  console.log(floor.met ? 'Quality floor met.' : `Quality floor not met: ${floor.failing.join(', ')}.`);
  return floor.met ? 0 : 1;
}

import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { loadProject } from '../core/project.mjs';
import { designStatus, runDesignWorkflow } from '../design/manager.mjs';
import { openDefects } from '../qa/defects.mjs';
import { runRepairLoop } from '../qa/repair.mjs';
import { createClaudeCodeWorker } from '../workers/claude-code.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const USAGE = 'Usage: forge design status <project> | forge design run <project> [--model <m>] [--max-usd <n>] | forge design qa <project> [--model <m>]';

// The gates visual QA repairs against. The rest of the floor (SEO, forms, performance) needs a
// real domain and endpoint and is checked before release.
export const DESIGN_QA_GATES = ['content-parity', 'routes', 'accessibility', 'responsive', 'design-fidelity', 'visual-review'];

// forge design: the Design Manager's workflow.
//   status  what the specification has and lacks
//   run     runs every phase up to visual QA; stops only for an approval or an escalation
//   qa      the render, review and repair loop, up to the retry limit
export async function cmdDesign(root, args) {
  const [action, project] = args;
  if (!project || !['status', 'run', 'qa'].includes(action)) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  loadProject(project, { workspace });

  if (action === 'status') {
    const s = designStatus(project, { workspace });
    console.log(`${project} is in ${s.phase}. The specification is ${s.ready ? 'complete' : 'not complete'}.`);
    for (const st of s.stages) {
      console.log(`${st.ok ? 'ok     ' : 'missing'} ${st.label}`);
      for (const p of st.problems) console.log(`          - ${p}`);
    }
    return s.ready ? 0 : 1;
  }

  const worker = createClaudeCodeWorker({ model: flag(args, '--model') });
  if (action === 'run') {
    const maxUsd = Number(flag(args, '--max-usd') ?? Infinity);
    const r = await runDesignWorkflow(project, { workspace, worker, maxUsd, onStep: (s) => console.log(`${s.phase}: done ${s.done.join(', ') || 'nothing'}`) });
    console.log(`Stopped in ${r.stoppedAt}: ${r.reason}. Spent $${r.spentUsd.toFixed(2)}.`);
    for (const b of r.blockers ?? []) console.log(`  - ${b}`);
    for (const p of r.problems ?? []) console.log(`  - ${p}`);
    return r.reason === 'reached' || r.reason === 'needs' ? 0 : 1;
  }

  const { outcome, loops, report } = await runRepairLoop(project, { workspace, worker, gates: DESIGN_QA_GATES });
  console.log(`Visual QA ${outcome} after ${loops} repair loop(s). Open defects: ${openDefects(report).length}.`);
  for (const d of openDefects(report)) console.log(`  - ${d.id} ${d.gate} ${d.finding}: ${d.message}`);
  return outcome === 'passed' ? 0 : 1;
}

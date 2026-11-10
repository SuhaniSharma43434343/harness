import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import * as ledger from '../core/ledger.mjs';
import { approve, loadProject } from '../core/project.mjs';
import { chooseDirection } from '../design/choose.mjs';
import { releaseChecks } from '../design/release.mjs';
import { designStatus, retryBuildTask, retryStage, runDesignWorkflow } from '../design/manager.mjs';
import { openDefects } from '../qa/defects.mjs';
import { runRepairLoop } from '../qa/repair.mjs';
import { createClaudeCodeWorker } from '../workers/claude-code.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const USAGE = 'Usage: forge design status|run|qa|release <project> [--model <m>] [--max-usd <n>] | forge design choose <project> <direction id> [--note <text>] | forge design accept-licence <project> <package> --note <the decision> | forge design retry <project> <stage or build task> --note <the decision>';

// The gates visual QA repairs against. The others (SEO, forms, licences, dependencies) can need
// something only the operator has, and are reported by forge design release.
export const DESIGN_QA_GATES = ['content-parity', 'claims', 'routes', 'accessibility', 'interactions', 'responsive', 'performance', 'design-fidelity', 'visual-review'];

// forge design: the Design Manager's workflow.
//   status  what the specification has and lacks
//   run     runs every phase up to visual QA; stops only for an approval or an escalation
//   qa      the render, review and repair loop, up to the retry limit
//   release every gate on the finished site: passed, failed, blocked or not applicable
//   choose  the operator's B2: records the approval and the chosen direction
//   retry   the operator's answer to an escalation: the stage, or a build task (build-page-<page>,
//           build-foundation) that used up its retries, gets a fresh fix task
export async function cmdDesign(root, args) {
  const [action, project] = args;
  if (!project || !['status', 'run', 'qa', 'release', 'choose', 'accept-licence', 'retry'].includes(action)) {
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

  if (action === 'choose') {
    const id = args[2];
    let entry;
    try {
      entry = chooseDirection(project, id, { workspace, note: flag(args, '--note') });
    } catch (err) {
      console.error(err.message);
      return 2;
    }
    console.log(`Recorded B2 for ${project}: ${id} (ledger #${entry.seq}).`);
    return 0;
  }

  // The operator's decision on a licence the harness cannot verify. Only a person can make it, so
  // it goes in the ledger as theirs, and the register row points to that entry.
  if (action === 'accept-licence') {
    const pkg = args[2];
    const note = flag(args, '--note');
    if (!pkg || !note) {
      console.error(USAGE);
      return 2;
    }
    const entry = ledger.append(project, { actor: 'operator', type: 'note', data: { event: 'licence_accepted', package: pkg, message: note } }, { workspace });
    const file = join(workspace, project, 'assets', 'register.json');
    const register = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { assets: [] };
    const row = { package: pkg, licence: note, source: `npm ${pkg}`, usage: 'Operator decision', status: 'cleared', evidence: `ledger.jsonl #${entry.seq}` };
    register.assets = [...(register.assets ?? []).filter((a) => a.package !== pkg), row];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(register, null, 2) + '\n');
    console.log(`Recorded the licence decision for ${pkg} (ledger #${entry.seq}).`);
    return 0;
  }

  if (action === 'retry') {
    const [stage, note] = [args[2], flag(args, '--note')];
    if (!stage || stage.startsWith('-') || !note) {
      console.error(USAGE);
      return 2;
    }
    if (stage.startsWith('build-')) {
      const out = retryBuildTask(project, stage, { note, workspace });
      console.log(`Recorded the retry of ${stage} for ${project}: ${out.task}. Run the workflow again to do the work.`);
      return 0;
    }
    const out = retryStage(project, stage, { note, workspace });
    console.log(`Recorded the retry of ${stage} for ${project}: fix attempt ${out.attempt}. Run the workflow again to do the work.`);
    return 0;
  }

  if (action === 'release') {
    const r = await releaseChecks(project, { workspace });
    for (const row of r.rows) {
      console.log(`${row.outcome.padEnd(15)} ${row.gate}${row.reason ? `: ${row.reason}` : ''}`);
      for (const f of row.findings) console.log(`                  - ${f}`);
    }
    console.log(r.releasable ? 'Every check passed or does not apply.' : 'Not releasable.');
    return r.releasable ? 0 : 1;
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

import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { assertProjectExists } from '../core/workspace.mjs';
import { CHECKS } from '../design/spec.mjs';
import { confirmFacts, factsBlockers, writeTruthDoc } from '../design/truth.mjs';

// forge facts <project>                       writes research/truth-doc.md and says what is left
// forge facts <project> confirm --note <text> records that the operator checked the facts are real
const USAGE = 'Usage: forge facts <project> [confirm --note "<what you checked>"]';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

export function cmdFacts(root, args) {
  const [project, action] = args;
  if (!project || project.startsWith('-') || (action && action !== 'confirm' && !action.startsWith('--'))) {
    console.error(USAGE);
    return 2;
  }
  const opts = { workspace: workspaceFor(root) };
  if (action === 'confirm') {
    const entry = confirmFacts(project, { note: flag(args, '--note'), ...opts });
    console.log(`Recorded the facts confirmation for ${project} (ledger #${entry.seq}, Truth Doc ${entry.data.hash}).`);
    return 0;
  }
  const { dir } = assertProjectExists(project, opts);
  const problems = CHECKS.research(dir);
  if (problems.length) {
    console.log(`Research is not finished (${problems.length} problem(s)):`);
    for (const p of problems) console.log(`- ${p}`);
    return 1;
  }
  const { file, hash } = writeTruthDoc(dir);
  console.log(`Wrote ${file} (${hash}). Read it and check every fact is real.`);
  const left = factsBlockers(project, dir, opts);
  console.log(left.length ? `Then: forge facts ${project} confirm --note "<what you checked>"` : 'The facts are confirmed for this version of the Truth Doc.');
  return 0;
}

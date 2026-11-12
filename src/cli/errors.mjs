import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { addRule, allRules, clearRules, memoryDir, rejectGate, rulesFor } from '../core/error-memory.mjs';

// forge errors [list] [agent]             the rules each agent has learned from its mistakes
// forge errors add <agent> --rule <text>  the operator teaches an agent a rule
// forge errors clear [agent] --yes        forget one agent's rules, or every agent's
// forge reject <project> <B1-B7|FACTS> --note <reason>  turn down an approval, and teach the reason
const USAGE = 'Usage: forge errors [list [agent] | add <agent> --rule <text> | clear [agent] --yes]';
const REJECT_USAGE = 'Usage: forge reject <project> <B1-B7|FACTS> --note "<why>"';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function print(agent, rules) {
  console.log(`${agent} (${rules.length} rule${rules.length === 1 ? '' : 's'})`);
  for (const r of rules) console.log(`  - ${r.rule}  [seen ${r.count}x, last ${r.lastProject} ${r.lastStage}]`);
}

export function cmdErrors(root, args) {
  const opts = { workspace: workspaceFor(root) };
  const [sub = 'list', agent] = args;
  if (sub === 'list') {
    const groups = agent ? [{ agent, rules: rulesFor(agent, opts) }] : allRules(opts);
    if (!groups.some((g) => g.rules.length)) {
      console.log(`No learned rules yet (${memoryDir(opts)}).`);
      return 0;
    }
    for (const g of groups) print(g.agent, g.rules);
    return 0;
  }
  if (sub === 'add') {
    const rule = flag(args, '--rule');
    if (!agent || agent.startsWith('-') || !rule) {
      console.error(USAGE);
      return 2;
    }
    print(agent, addRule(agent, rule, opts));
    return 0;
  }
  if (sub === 'clear') {
    const who = agent && !agent.startsWith('-') ? agent : undefined;
    if (!args.includes('--yes')) {
      console.error(`This forgets ${who ? `${who}'s` : 'every agent\'s'} learned rules. Run again with --yes to confirm.`);
      return 2;
    }
    const cleared = clearRules(who, opts);
    console.log(cleared.length ? `Cleared: ${cleared.join(', ')}.` : 'There were no rules to clear.');
    return 0;
  }
  console.error(USAGE);
  return 2;
}

export function cmdReject(root, args) {
  const [project, code] = args;
  const note = flag(args, '--note');
  if (!project || project.startsWith('-') || !code || !note) {
    console.error(REJECT_USAGE);
    return 2;
  }
  const { entry, error } = rejectGate(project, code, { note, workspace: workspaceFor(root) });
  console.log(`Recorded the rejection of ${code.toUpperCase()} for ${project} (ledger #${entry.seq}).${error ? ` ${error.agent} will read the rule before its next task.` : ''}`);
  return 0;
}

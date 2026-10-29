import { PHASES } from '../core/project.mjs';
import { agentsForPhase, checkGenerated, loadAgents, writeGenerated } from '../core/agents.mjs';

// forge agents [list|generate|check]
export function cmdAgents(args) {
  const [sub = 'list'] = args;
  const agents = loadAgents();
  if (sub === 'generate') {
    const files = writeGenerated(agents);
    console.log(`Generated ${files.length} files from agents/:`);
    for (const f of files) console.log(`  ${f}`);
    return 0;
  }
  if (sub === 'check') {
    const drift = checkGenerated(agents);
    if (!drift.length) {
      console.log('Generated agent files match agents/.');
      return 0;
    }
    for (const d of drift) console.log(`${d.file}: ${d.problem}`);
    console.log('Run forge agents generate.');
    return 1;
  }
  if (sub === 'list') {
    for (const a of agents) console.log(`${a.id.padEnd(18)} ${a.phases.join(', ')}`);
    console.log('\nBy phase:');
    for (const p of PHASES) console.log(`  ${p.id.padEnd(4)} ${p.name.padEnd(20)} ${agentsForPhase(p.name, agents).join(', ') || '(CLI only)'}`);
    return 0;
  }
  console.error('Usage: forge agents [list|generate|check]');
  return 2;
}

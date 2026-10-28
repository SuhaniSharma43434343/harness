#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ForgeError } from '../core/errors.mjs';
import { cmdAgents } from './agents.mjs';
import { printDoctor, runDoctor } from './doctor.mjs';
import { cmdApprove, cmdNew, cmdResume, cmdRun, cmdStatus } from './project.mjs';
import { cmdDirections } from './directions.mjs';
import { cmdGates } from './gates.mjs';
import { cmdIntake } from './intake.mjs';
import { cmdSelect } from './select.mjs';
import { cmdSite } from './site.mjs';
import { validateFile } from './validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// Commands that exist today. Everything else in PLANNED is reported honestly as not built yet.
const COMMANDS = {
  help: { summary: 'Show this help', run: () => printHelp() },
  version: { summary: 'Print the harness version', run: () => console.log(VERSION) },
  doctor: {
    summary: 'Check Node, npm, Git, Claude Code, config and workspace (--json for machine output)',
    run: (args) => {
      const report = runDoctor(ROOT);
      if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
      else printDoctor(report);
      return report.ok ? 0 : 1;
    },
  },
  validate: {
    summary: 'Validate a JSON file: forge validate <schema> <file> (run without arguments to list schemas)',
    run: (args) => validateFile(args[0], args[1]),
  },
  new: { summary: 'Create a project: forge new <project> [--brief <file>]', run: (args) => cmdNew(ROOT, args) },
  approve: { summary: 'Record an operator approval: forge approve <project> <B1-B7>', run: (args) => cmdApprove(ROOT, args) },
  status: { summary: 'Show phase, approvals and tasks: forge status <project> [--json]', run: (args) => cmdStatus(ROOT, args) },
  run: { summary: 'Run the tasks that can start: forge run <project> [--replay <dir>] [--model <m>]', run: (args) => cmdRun(ROOT, args) },
  agents: { summary: 'List agents by phase, or generate/check the Claude Code and Cursor files: forge agents [list|generate|check]', run: (args) => cmdAgents(args) },
  intake: {
    summary: 'Run intake (P1): forge intake <project> [--answers <file.json>] [--use-recommendations]',
    run: (args) => cmdIntake(ROOT, args),
  },
  directions: {
    summary: 'Propose and render 3 to 5 design directions (P4), or check them: forge directions <project> [--count n] [--check]',
    run: (args) => cmdDirections(ROOT, args),
  },
  gates: {
    summary: 'Run the automated quality gates on a built site: forge gates <project> [--gate <name>] [--preview] [--json]',
    run: (args) => cmdGates(ROOT, args),
  },
  select: { summary: 'Show which approaches a brief selects, and why: forge select <brief.json> [--json]', run: (args) => cmdSelect(args) },
  resume: { summary: 'Requeue tasks left running by an interruption: forge resume <project>', run: (args) => cmdResume(ROOT, args) },
  site: {
    summary: 'Write the starter site from the brief and tokens: forge site <project> [--build] (see docs/starter.md)',
    run: (args) => cmdSite(ROOT, args),
  },
};

// Planned commands and the milestone that delivers them (see the project plan).
const PLANNED = {
  preview: 'M3',
  deploy: 'M3',
  report: 'M3',
  plugins: 'M2',
  task: 'M5',
  test: 'M5',
  demo: 'M6',
  package: 'M6',
  upgrade: 'M6',
};

function printHelp() {
  console.log(`forge ${VERSION}: portable AI website production harness\n`);
  console.log('Usage: forge <command> [options]\n');
  console.log('Available now:');
  for (const [name, cmd] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(10)} ${cmd.summary}`);
  console.log('\nPlanned (not built yet):');
  console.log(
    '  ' +
      Object.entries(PLANNED)
        .map(([name, m]) => `${name} (${m})`)
        .join(', '),
  );
}

export async function main(argv) {
  const [name = 'help', ...args] = argv;
  if (name === '--help' || name === '-h') return printHelp() ?? 0;
  if (name === '--version' || name === '-v') return COMMANDS.version.run() ?? 0;

  const cmd = COMMANDS[name];
  if (cmd) return (await cmd.run(args)) ?? 0;

  if (PLANNED[name]) {
    console.error(`forge ${name} is planned for milestone ${PLANNED[name]} and is not built yet.`);
    return 2;
  }
  console.error(`Unknown command "${name}". Run forge --help.`);
  return 2;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      if (err instanceof ForgeError) {
        console.error(`${err.code}: ${err.message}`);
        if (err.hint) console.error(`  -> ${err.hint}`);
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}

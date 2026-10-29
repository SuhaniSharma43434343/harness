import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { getModule } from '../approaches/index.mjs';
import { loadConfig } from '../core/config.mjs';
import { deploy, writeReport } from '../core/deliver.mjs';
import { goProject } from '../core/go.mjs';
import { approve, createProject, hasApproval, loadProject } from '../core/project.mjs';
import { runProject } from '../core/runner.mjs';
import { readJson } from '../core/workspace.mjs';
import { runIntake } from '../intake/run.mjs';
import { runRepairLoop } from '../qa/repair.mjs';
import { scaffoldSite } from '../site/scaffold.mjs';
import { buildSite, JS_BUDGET_BYTES, siteReport } from '../site/build.mjs';
import { createClaudeCodeWorker, createReplayWorker } from '../workers/claude-code.mjs';
import { cmdApproach } from './approach.mjs';
import { cmdDirections } from './directions.mjs';
import { cmdGates } from './gates.mjs';
import { intakeAsk } from './intake.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const USAGE = 'Usage: forge go <project> [--brief <file>] [--approve <B1,B2,...>] [--direction <n|id>] [--render] [--model <model>] [--replay <dir>]';

// Yes/no, pick-one and type-a-word questions on the terminal. A closed input counts as "no".
function terminalAsk(rl) {
  const line = async (q) => {
    try {
      return (await rl.question(q)).trim();
    } catch {
      return null;
    }
  };
  return {
    async confirm(question) {
      for (;;) {
        const a = await line(`\n${question} [y/n] `);
        if (a === null || /^(n|no)$/i.test(a)) return false;
        if (/^(y|yes)$/i.test(a)) return true;
      }
    },
    async choose(question, labels, defaultIndex = 0) {
      console.log(`\n${question}`);
      labels.forEach((l, i) => console.log(`  ${i + 1}. ${l}${i === defaultIndex ? ' (recommended)' : ''}`));
      for (;;) {
        const a = await line(`Type a number, Enter for ${defaultIndex + 1}, or n to stop: `);
        if (a === null || /^(n|no)$/i.test(a)) return null;
        if (a === '') return defaultIndex;
        const n = Number(a);
        if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
      }
    },
    async typed(question, word) {
      const a = await line(`\n${question}\nType "${word}" to go ahead, anything else stops: `);
      return a === word;
    },
  };
}

// Answers from flags first: --approve lists the approvals the operator has already given in
// conversation (when Claude runs forge go for them, as in the Claude desktop app), and --direction
// is their B2 pick. Anything else is asked on the terminal, or, with no terminal, left unanswered
// and listed in `missing`, so whoever runs it can ask the operator and run it again.
export function flagAsk({ approved = [], direction, interactive, terminal }) {
  const given = new Set(approved);
  const missing = [];
  const answer = async (code, ask) => {
    if (given.has(code)) return true;
    if (interactive) return ask();
    if (code !== 'up-front') missing.push(code);
    return false;
  };
  return {
    missing,
    note: (code) =>
      given.has(code)
        ? 'given by the operator in conversation, passed to forge go --approve'
        : code === 'B2' && direction !== undefined
          ? 'picked by the operator in conversation, passed to forge go --direction'
          : undefined,
    confirm: (question, code) => answer(code, () => terminal.confirm(question)),
    typed: (question, word, code) => (interactive ? terminal.typed(question, word) : (missing.push(code), false)),
    async choose(question, labels, defaultIndex, code) {
      if (direction !== undefined) {
        const n = Number(direction);
        const i = Number.isInteger(n) ? n - 1 : labels.findIndex((l) => l.startsWith(`${direction}:`));
        if (i >= 0 && i < labels.length) return i;
      }
      if (interactive) return terminal.choose(question, labels, defaultIndex);
      missing.push(code);
      console.log(`\n${question}\n${labels.map((l, i) => `  ${i + 1}. ${l}${i === defaultIndex ? ' (recommended)' : ''}`).join('\n')}`);
      return null;
    },
  };
}

// The site with every selected approach applied, then the build (BUILD, P9). The draft site from
// P5 is written again first, so it carries the content locked at B3.
async function buildWithApproaches(project, root, workspace, ask) {
  const dir = join(workspace, project);
  const siteDir = join(dir, 'site');
  scaffoldSite(project, { force: true, workspace });
  const decisions = readJson(join(dir, 'design', 'approach-decision.json')).decisions.filter((d) => d.selected && d.approach !== 'APP-01');
  const parts = new Set(decisions.flatMap((d) => getModule(d.approach).composedOf ?? []));
  const applied = readJson(join(siteDir, 'src', 'site.json')).approaches ?? [];
  for (const d of decisions) {
    if (parts.has(d.approach) || applied.includes(d.approach)) continue;
    if (d.needsApproval && !hasApproval(project, d.needsApproval, { workspace })) {
      if (!(await ask.confirm(`${d.approach} is experimental and needs ${d.needsApproval}. Approve it? (No keeps its fallback.)`, d.needsApproval))) continue;
      approve(project, d.needsApproval, { note: `given in forge go for ${d.approach}`, workspace });
    }
    await cmdApproach(root, [project, d.approach, '--no-install']);
  }
  const b = buildSite(siteDir);
  if (!b.ok) throw new Error(`The site did not build:\n${b.output.trim().split('\n').slice(-20).join('\n')}`);
  const report = siteReport(b.dist);
  console.log(`Built ${report.routes.length} routes. JavaScript: ${(report.jsBytes / 1024).toFixed(1)} KB gzip (budget ${JS_BUDGET_BYTES / 1024} KB).`);
}

// forge go: from intake to handoff in one command, stopping only for approvals and blockers.
export async function cmdGo(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  const opts = { workspace };
  if (!existsSync(join(workspace, project, 'project.json'))) {
    createProject(project, { brief: flag(args, '--brief'), workspace });
    console.log(`Created ${project}.`);
  }
  loadProject(project, opts);
  const replay = flag(args, '--replay');
  const worker = replay ? createReplayWorker({ recordDir: replay }) : createClaudeCodeWorker({ model: flag(args, '--model') });
  const approved = (args.flatMap((a, i) => (args[i - 1] === '--approve' ? a.split(',') : []))).map((c) => c.trim().toUpperCase()).filter(Boolean);
  const bad = approved.filter((c) => !/^B[1-6]$/.test(c));
  if (bad.length) {
    console.error(`--approve takes B1 to B6, not ${bad.join(', ')}. B7 (production) is only ever typed by the operator in a terminal.`);
    return 2;
  }
  const interactive = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = flagAsk({ approved, direction: flag(args, '--direction'), interactive, terminal: terminalAsk(rl) });
  const steps = {
    intake: () => runIntake(project, { ask: interactive ? intakeAsk(rl) : async (qs) => qs.map(() => undefined), ...opts }),
    directions: () => cmdDirections(root, [project, ...(args.includes('--render') ? [] : ['--no-render'])]),
    scaffold: () => scaffoldSite(project, opts),
    runAgents: (agents) => runProject(project, { ...opts, worker, agents }),
    build: () => buildWithApproaches(project, root, workspace, ask),
    gates: () => cmdGates(root, [project]),
    review: async () => ({ met: (await runRepairLoop(project, { ...opts, worker })).outcome === 'passed' }),
    deployPreview: () => deploy(project, { target: 'preview', ...opts }),
    deployProduction: () => deploy(project, { target: 'production', ...opts }),
    report: () => console.log(`Final report: ${writeReport(project, opts).file}`),
  };
  try {
    const r = await goProject(project, { ask, steps, ...opts });
    if (!interactive && r.stopped?.some((x) => x.startsWith('answers to the intake'))) {
      console.log(`\nThe intake questions need the operator: run ./forge intake ${project} in a terminal, or answer them with --answers <file.json>.`);
    }
    if (ask.missing.length) {
      const codes = [...new Set(ask.missing)];
      console.log(`\nWaiting for the operator: ${codes.map((c) => (c === 'B7' ? 'B7 (typed "deploy" in a terminal)' : c)).join(', ')}. Ask them; once they say yes, run:`);
      const more = codes.filter((c) => c !== 'B7' && c !== 'B2');
      console.log(`  ./forge go ${project}${[...approved, ...more].length ? ` --approve ${[...new Set([...approved, ...more])].join(',')}` : ''}${codes.includes('B2') ? ' --direction <number>' : ''}`);
    }
    return r.done ? 0 : 1;
  } finally {
    rl.close();
  }
}

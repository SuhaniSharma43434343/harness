import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../core/config.mjs';
import { readJson } from '../core/workspace.mjs';
import { runIntake } from '../intake/run.mjs';
import { shapeAnswer } from '../intake/shape.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const USAGE = 'Usage: forge intake <project> [--answers <file.json>] [--use-recommendations] [--rounds <n>]';

function recommendationText(q) {
  const r = q.recommendation;
  const value = 'value' in r ? JSON.stringify(r.value) : `the value of ${r.fromField}`;
  return `${value} (${r.reason})`;
}

// Parses what the operator typed. An empty line means "use your recommendation".
function parseTyped(q, text) {
  const t = text.trim();
  if (!t || /^(r|rec|use your recommendation)$/i.test(t)) return 'use-recommendation';
  const option = (s) => {
    const n = Number(s);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) return q.options[n - 1].value;
    return q.options.find((o) => String(o.value) === s || o.label.toLowerCase() === s.toLowerCase())?.value ?? s;
  };
  switch (q.kind) {
    case 'single':
      return option(t);
    case 'multi':
      return t === '-' ? [] : t.split(',').map((s) => option(s.trim()));
    case 'boolean':
      return /^(y|yes|true)$/i.test(t);
    case 'number':
      return Number(t);
    default:
      return shapeAnswer(q, t);
  }
}

function prompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (questions, { round }) => {
    console.log(`\nRound ${round}: ${questions.length} question(s). Press Enter to use the recommendation.\n`);
    const answers = [];
    for (const q of questions) {
      console.log(`${q.prompt}${q.why ? `\n  Why: ${q.why}` : ''}`);
      q.options?.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
      console.log(`  Recommendation: ${recommendationText(q)}`);
      answers.push(parseTyped(q, await rl.question('> ')));
    }
    return answers;
  };
  return { ask, close: () => rl.close() };
}

// forge intake: runs P1 for a project. Answers come from the terminal, from an answers file
// ({ "q-id": answer }), or all from the recommendations.
export async function cmdIntake(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  const answersFile = flag(args, '--answers');
  const allRecommended = args.includes('--use-recommendations');
  const fileAnswers = answersFile ? readJson(resolve(answersFile)) : null;

  let tty = null;
  let ask;
  if (fileAnswers || allRecommended) {
    ask = async (questions) =>
      questions.map((q) => (fileAnswers && q.id in fileAnswers ? shapeAnswer(q, fileAnswers[q.id]) : allRecommended ? 'use-recommendation' : undefined));
  } else {
    tty = prompter();
    ask = tty.ask;
  }

  try {
    const rounds = flag(args, '--rounds') ? Number(flag(args, '--rounds')) : undefined;
    const r = await runIntake(project, { ask, workspace, ...(rounds ? { maxRounds: rounds } : {}) });
    const assumed = r.facts.facts.filter((f) => f.status === 'inferred').length;
    if (r.status === 'ready') {
      console.log(`\nBrief ready: intake/brief.json, facts.json, estimate.json and plan.md in workspace/${project}/.`);
      console.log(`${assumed} assumption(s) recorded. Estimate: ${r.estimate.hours.min} to ${r.estimate.hours.max} hours, ${r.estimate.cost.min} to ${r.estimate.cost.max} ${r.estimate.cost.currency}.`);
      console.log(`Review intake/plan.md, then approve with: forge approve ${project} B1`);
      return 0;
    }
    console.log(`\nIntake needs more answers. Missing: ${r.missing.join(', ') || 'none'}.`);
    for (const e of r.errors) console.log(`  - ${e}`);
    console.log(`Run forge intake ${project} again to continue.`);
    return 1;
  } finally {
    tty?.close();
  }
}

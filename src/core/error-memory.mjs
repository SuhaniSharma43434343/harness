import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ledger from './ledger.mjs';
import { redactText } from './redact.mjs';
import { assertValid } from './schemas.mjs';
import { DEFAULT_WORKSPACE, ROOT, projectPaths, writeJsonAtomic } from './workspace.mjs';

// Remember My Error: every mistake an agent makes becomes a rule that agent reads before its next task.
// - The project keeps the full log: workspace/<project>/errors/agent-errors.json.
// - The harness keeps each agent's rules, once each, across projects: memory/errors/<agent>.md (for
//   people) beside memory/errors/<agent>.json (the same rules, with how often each was hit).
// The memory is not in git and is not packaged, because a rule can quote a client's facts. Secrets
// are redacted before anything is written.

export const PROJECT_LOG = 'errors/agent-errors.json';
export const PROJECT_RULES = (agent) => `errors/rules/${agent}.md`;
const AGENT_ID = /^[a-z][a-z0-9-]*$/;

// The memory folder: memory/errors at the harness root for the harness's own workspace, and
// <workspace>/.memory/errors for any other (a workspace set elsewhere in forge.config.json, or a
// test's), so two workspaces never share rules. Both are outside git.
export function memoryDir({ workspace = DEFAULT_WORKSPACE, memoryDir: dir } = {}) {
  if (dir) return dir;
  return resolve(workspace) === resolve(DEFAULT_WORKSPACE) ? join(ROOT, 'memory', 'errors') : join(workspace, '.memory', 'errors');
}

const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s) => redactText(String(s)).replace(/\s+/g, ' ').trim();

// A rule from a finding: the part that says what to do (after the last "; "), with what went wrong,
// else the finding itself as something to avoid. A file prefix ("design/x.json: ") is dropped.
export function ruleFrom(mistake) {
  const text = clean(mistake).replace(/^[\w./-]+\.(json|md|astro|mjs): /, '');
  const cut = text.lastIndexOf('; ');
  const advice = cut === -1 ? '' : text.slice(cut + 2);
  if (advice.length < 6) return `Avoid this: ${text}`;
  return `${advice[0].toUpperCase()}${advice.slice(1)} (it went wrong when: ${text.slice(0, cut)})`;
}

function readRules(agent, opts) {
  const file = join(memoryDir(opts), `${agent}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rules : [];
}

function writeRules(agent, rules, opts) {
  const dir = memoryDir(opts);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, `${agent}.json`), { agent, rules });
  const lines = [
    `# Learned rules: ${agent}`,
    '',
    'Written by forge from this agent\'s past mistakes (Remember My Error). Read them before starting a task, and follow every one. Edit with `forge errors`.',
    '',
    ...rules.map((r) => `- ${r.rule} _(seen ${r.count} time${r.count === 1 ? '' : 's'}; last on ${r.lastProject}, ${r.lastStage}, ${r.lastSeen.slice(0, 10)})_`),
    '',
  ];
  writeFileSync(join(dir, `${agent}.md`), lines.join('\n'));
}

// Adds a rule to an agent's memory, or counts it again when the same rule is already there.
function remember(agent, rule, { project, stage, at }, opts) {
  const rules = readRules(agent, opts);
  const key = normalise(rule);
  const same = rules.find((r) => normalise(r.rule) === key);
  if (same) Object.assign(same, { count: same.count + 1, lastProject: project, lastStage: stage, lastSeen: at });
  else rules.push({ rule, count: 1, lastProject: project, lastStage: stage, lastSeen: at });
  writeRules(agent, rules, opts);
}

// recordError(project, { agent, stage, source, mistake, preventionRule? }, opts) => the entry.
// Never throws into the caller's work: a memory that cannot be written is reported, not fatal.
export function recordError(project, { agent, stage, source, mistake, preventionRule }, opts = {}) {
  try {
    if (!AGENT_ID.test(agent ?? '')) return null;
    const at = (opts.now?.() ?? new Date()).toISOString();
    const entry = { timestamp: at, project, agent, stage: String(stage), source, mistake: clean(mistake), preventionRule: clean(preventionRule ?? ruleFrom(mistake)) };
    const file = join(projectPaths(project, opts).dir, PROJECT_LOG);
    const log = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { errors: [] };
    log.errors.push(entry);
    assertValid('errorMemory', log, PROJECT_LOG);
    mkdirSync(dirname(file), { recursive: true });
    writeJsonAtomic(file, log);
    remember(agent, entry.preventionRule, { project, stage: entry.stage, at }, opts);
    return entry;
  } catch (err) {
    process.emitWarning(`Remember My Error could not record a mistake: ${err.message}`);
    return null;
  }
}

// The rules an agent has learned, newest last.
export const rulesFor = (agent, opts = {}) => readRules(agent, opts);

// Every agent with rules: [{ agent, rules }].
export function allRules(opts = {}) {
  const dir = memoryDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => ({ agent: f.slice(0, -5), rules: readRules(f.slice(0, -5), opts) }));
}

// The operator adds a rule by hand (forge errors add).
export function addRule(agent, rule, opts = {}) {
  if (!AGENT_ID.test(agent ?? '')) throw new Error(`"${agent}" is not an agent id`);
  remember(agent, clean(rule), { project: 'operator', stage: 'forge errors add', at: (opts.now?.() ?? new Date()).toISOString() }, opts);
  return rulesFor(agent, opts);
}

// The operator clears an agent's rules, or every agent's (forge errors clear).
export function clearRules(agent, opts = {}) {
  const dir = memoryDir(opts);
  const agents = agent ? [agent] : allRules(opts).map((x) => x.agent);
  for (const a of agents) for (const ext of ['json', 'md']) rmSync(join(dir, `${a}.${ext}`), { force: true });
  return agents;
}

// The agent whose work each operator decision judges.
export const GATE_AGENT = { B1: 'project-manager', FACTS: 'research-strategy', B2: 'creative-director', B3: 'content-ux', B4: 'asset-rights', B5: 'lead-developer', B6: 'lead-developer', B7: 'lead-developer' };

// forge reject: the operator turns down an approval. The ledger gets a refusal (the frozen ledger
// schema's own shape: action and reason), and the reason becomes a rule for the agent whose work it was.
export function rejectGate(project, code, { note, ...opts } = {}) {
  const gate = String(code ?? '').toUpperCase();
  if (!GATE_AGENT[gate]) throw new Error(`"${code}" is not an approval to reject; use B1 to B7 or FACTS`);
  if (!note) throw new Error('A rejection needs your reason as its note: it becomes the rule the agent learns');
  const entry = ledger.append(project, { actor: 'operator', type: 'refusal', data: { action: gate === 'FACTS' ? 'confirm facts' : `approve ${gate}`, reason: note } }, opts);
  const error = recordError(project, { agent: GATE_AGENT[gate], stage: gate, source: 'gate-rejected', mistake: `The operator rejected ${gate}: ${note}`, preventionRule: note }, opts);
  return { entry, error };
}

// The read hook: before an agent starts a task, its learned rules are copied into the project
// (task inputs must be project-relative) and named in the task's inputs and acceptance.
// Returns the task unchanged when the agent has no rules.
export function withErrorRules(project, task, opts = {}) {
  const rules = rulesFor(task.agent, opts);
  if (!rules.length) return task;
  const rel = PROJECT_RULES(task.agent);
  const target = join(projectPaths(project, opts).dir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(join(memoryDir(opts), `${task.agent}.md`), 'utf8'));
  if (task.inputs.includes(rel)) return task;
  const line = `Read ${rel} before you start: rules learned from this agent's past mistakes. Follow every one`;
  return { ...task, inputs: [...task.inputs, rel], acceptance: [...task.acceptance, line] };
}

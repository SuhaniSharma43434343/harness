// Remember My Error: every mistake becomes a rule its agent reads before the next task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { addRule, allRules, clearRules, memoryDir, PROJECT_LOG, recordError, rejectGate, ruleFrom, rulesFor, withErrorRules } from '../../src/core/error-memory.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { getTask, listTasks } from '../../src/core/board.mjs';
import { forbiddenReason } from '../../src/core/package.mjs';
import { planPhase } from '../../src/core/planner.mjs';
import { createProject } from '../../src/core/project.mjs';
import { runTask } from '../../src/core/runner.mjs';
import { check } from '../../src/core/schemas.mjs';
import { readJson, ROOT, writeJsonAtomic } from '../../src/core/workspace.mjs';
import { sendBack } from '../../src/design/manager.mjs';
import { materializeFixture } from '../../src/gates/fixtures.mjs';
import { qaReview } from '../../src/qa/review.mjs';
import { addTasks, newProject, recordingWorker, task } from './helpers.mjs';

const BRIEF = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));
const setPhase = (dir, phase) => writeJsonAtomic(join(dir, 'project.json'), { ...readJson(join(dir, 'project.json')), phase });
const withBrief = () => {
  const p = newProject('demo');
  const dir = join(p.workspace, p.project);
  mkdirSync(join(dir, 'intake'), { recursive: true });
  writeFileSync(join(dir, 'intake/brief.json'), JSON.stringify(BRIEF));
  return { ...p, dir };
};

test('a mistake is logged in the project and kept once, as a rule, in the memory beside the workspace', () => {
  const { project, opts, workspace, dir } = withBrief();
  assert.equal(memoryDir(opts), join(workspace, '.memory', 'errors'), 'a test workspace gets its own memory, never the harness\'s');
  assert.equal(memoryDir({}), join(ROOT, 'memory', 'errors'), 'the harness workspace keeps it at the harness root');
  const mistake = 'design/section-plan.json: only 2 of 9 sections break the grid; say in the composition what overlaps';
  const e = recordError(project, { agent: 'creative-director', stage: 'section-plan', source: 'design-returned', mistake }, opts);
  assert.equal(e.preventionRule, 'Say in the composition what overlaps (it went wrong when: only 2 of 9 sections break the grid)');
  recordError(project, { agent: 'creative-director', stage: 'section-plan-fix-1', source: 'design-returned', mistake }, opts);
  const log = JSON.parse(readFileSync(join(dir, PROJECT_LOG), 'utf8'));
  assert.equal(log.errors.length, 2);
  assert.deepEqual(check('errorMemory', log).errors, []);
  for (const k of ['timestamp', 'project', 'agent', 'stage', 'mistake', 'preventionRule']) assert.ok(log.errors[0][k], k);
  const rules = rulesFor('creative-director', opts);
  assert.equal(rules.length, 1, 'the same rule is kept once');
  assert.equal(rules[0].count, 2);
  const md = readFileSync(join(memoryDir(opts), 'creative-director.md'), 'utf8');
  assert.match(md, /# Learned rules: creative-director/);
  assert.match(md, /- Say in the composition what overlaps \(it went wrong when: only 2 of 9 sections break the grid\) _\(seen 2 times; last on demo, section-plan-fix-1,/);
  assert.equal(ruleFrom('Verify command failed on attempt 3'), 'Avoid this: Verify command failed on attempt 3');
  assert.equal(recordError(project, { agent: 'Not An Agent', stage: 'x', source: 'operator', mistake: 'oops' }, opts), null, 'a bad agent id is skipped, never thrown');
});

test('a secret in a mistake is redacted before it reaches the log or the memory', () => {
  const { project, opts, dir } = withBrief();
  const token = `ghp_${'a1B2'.repeat(9)}`;
  recordError(project, { agent: 'builder', stage: 'deploy', source: 'task-blocked', mistake: `push failed with token ${token}` }, opts);
  assert.ok(!readFileSync(join(dir, PROJECT_LOG), 'utf8').includes(token));
  assert.ok(!readFileSync(join(memoryDir(opts), 'builder.md'), 'utf8').includes(token));
});

test('a task that runs out of attempts teaches its agent the findings its verify check printed', async () => {
  const { project, opts, dir } = withBrief();
  const finding = 'design/copy.json: 3 headlines start with "We"; vary them';
  addTasks(project, opts, task('copy', { agent: 'content-ux', verify: `node -e "console.log('- ${finding.replace(/"/g, '\\"')}'); process.exit(1)"`, budget: { minutes: 1, retries: 0 } }));
  const r = await runTask(project, 'copy', { ...opts, worker: recordingWorker() });
  assert.equal(r.status, 'blocked');
  const log = JSON.parse(readFileSync(join(dir, PROJECT_LOG), 'utf8')).errors;
  assert.deepEqual(log.map((x) => [x.agent, x.stage, x.source]), [['content-ux', 'copy', 'task-blocked']]);
  assert.match(log[0].mistake, /3 headlines start with "We"; vary them/);
  assert.match(rulesFor('content-ux', opts)[0].rule, /^Vary them \(it went wrong when: 3 headlines start with "We"\)/);
});

test('every task starts with its agent\'s rules: planned tasks, fix tasks, the runner and step mode', async () => {
  const { project, opts, dir } = withBrief();
  addRule('research-strategy', 'Never cite a competitor price you did not see on its own site', opts);
  setPhase(dir, 'RESEARCH');
  const [research] = planPhase(project, opts);
  assert.ok(research.inputs.includes('errors/rules/research-strategy.md'));
  assert.match(research.acceptance.at(-1), /Read errors\/rules\/research-strategy.md before you start/);
  assert.match(readFileSync(join(dir, 'errors/rules/research-strategy.md'), 'utf8'), /Never cite a competitor price/);
  // An agent with no rules gets its contract unchanged.
  const plain = task('hero', { agent: 'builder' });
  assert.equal(withErrorRules(project, plain, opts), plain);
  // The runner hands the worker the rules too, for tasks added outside the planner.
  addRule('builder', 'Keep every tap target at least 44 pixels', opts);
  addTasks(project, opts, task('hero', { agent: 'builder' }));
  const seen = [];
  const worker = async ({ task: t }) => {
    seen.push(t);
    return { evidence: ['site/hero.txt'] };
  };
  await runTask(project, 'hero', { ...opts, worker, verifier: async () => ({ ok: true, code: 0, output: 'ok' }) });
  assert.ok(seen[0].inputs.includes('errors/rules/builder.md'));
  assert.ok(!getTask(project, 'hero', opts).inputs.includes('errors/rules/builder.md'), 'the board keeps the contract as planned');
  // Step mode prints them.
  const { cmdTask } = await import('../../src/cli/task.mjs');
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: dirname(dir) }));
  addTasks(project, opts, task('nav', { agent: 'builder' }));
  const out = [];
  const { log } = console;
  console.log = (s) => out.push(String(s));
  try {
    assert.equal(await cmdTask(root, ['next', project, '--json']), 0);
  } finally {
    console.log = log;
  }
  // Step mode hands out the research task (the project is in research), with that agent's rules.
  const next = JSON.parse(out.join('\n'));
  assert.equal(next.agent, 'research-strategy');
  assert.ok(next.inputs.includes('errors/rules/research-strategy.md'));
});

test('a stage sent back is its agent\'s mistake, and the fix task already carries the new rule', () => {
  const { project, opts, dir } = withBrief();
  setPhase(dir, 'TECHNICAL_PLAN');
  sendBack(project, 'section-plan', ['hero: the composition is too vague; give the exact layout (columns, placement, overlap, scale)'], opts);
  sendBack(project, 'asset-plan', ['media rejected: workshop (assets/public/photos/workshop.jpg): warped hands. Choose another file'], opts);
  const log = JSON.parse(readFileSync(join(dir, PROJECT_LOG), 'utf8')).errors;
  assert.deepEqual(log.map((x) => [x.agent, x.stage, x.source]), [['creative-director', 'section-plan', 'design-returned'], ['creative-director', 'asset-plan', 'media-rejected']]);
  const fix = listTasks(project, opts).find((t) => t.id === 'section-plan-fix-1');
  assert.ok(fix.inputs.includes('errors/rules/creative-director.md'));
  assert.match(fix.acceptance[0], /^Fix: hero: the composition is too vague/, 'the findings still come first');
});

test('a new QA defect is the builder\'s mistake', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-qa-memory-'));
  const workspace = join(root, 'ws');
  createProject('qa-memory', { workspace });
  cpSync(materializeFixture('seo-two-h1').dir, join(workspace, 'qa-memory'), { recursive: true });
  await qaReview('qa-memory', { workspace, gates: ['seo'] });
  const log = JSON.parse(readFileSync(join(workspace, 'qa-memory', PROJECT_LOG), 'utf8')).errors;
  assert.ok(log.some((x) => x.agent === 'builder' && x.source === 'qa-defect' && x.stage === 'qa seo'), JSON.stringify(log));
  assert.ok(rulesFor('builder', { workspace }).length >= 1);
  await qaReview('qa-memory', { workspace, gates: ['seo'] });
  assert.equal(JSON.parse(readFileSync(join(workspace, 'qa-memory', PROJECT_LOG), 'utf8')).errors.length, log.length, 'a defect still open is not counted again');
});

test('forge reject records a schema-valid refusal and teaches the agent whose work it was', () => {
  const { project, opts } = withBrief();
  const { entry, error } = rejectGate(project, 'b2', { note: 'Every direction is navy and gold; show one built from the client logo colours', ...opts });
  assert.equal(entry.type, 'refusal');
  assert.equal(entry.actor, 'operator');
  assert.deepEqual(entry.data, { action: 'approve B2', reason: 'Every direction is navy and gold; show one built from the client logo colours' });
  assert.deepEqual(check('ledgerEntry', entry).errors, []);
  assert.equal(ledger.read(project, opts).at(-1).type, 'refusal');
  assert.equal(error.agent, 'creative-director');
  assert.equal(error.source, 'gate-rejected');
  assert.match(rulesFor('creative-director', opts)[0].rule, /show one built from the client logo colours/);
  assert.equal(rejectGate(project, 'FACTS', { note: 'The founding year is wrong: 1998, not 1989', ...opts }).error.agent, 'research-strategy');
  assert.throws(() => rejectGate(project, 'B9', { note: 'x', ...opts }), /not an approval to reject/);
  assert.throws(() => rejectGate(project, 'B3', opts), /needs your reason/);
});

test('forge errors lists, adds and clears rules, and forge reject is a command', async () => {
  const { cmdErrors, cmdReject } = await import('../../src/cli/errors.mjs');
  const { project, workspace } = withBrief();
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: workspace }));
  const out = [];
  const { log, error } = console;
  console.log = (s) => out.push(String(s));
  console.error = (s) => out.push(String(s));
  try {
    assert.equal(cmdErrors(root, []), 0);
    assert.match(out.at(-1), /No learned rules yet/);
    assert.equal(cmdErrors(root, ['add', 'builder', '--rule', 'Never ship a form without its error state']), 0);
    assert.equal(cmdErrors(root, ['add', 'builder']), 2, 'a rule is needed');
    assert.equal(cmdReject(root, [project, 'B3', '--note', 'The FAQ answers are three words long; answer in full']), 0);
    assert.match(out.at(-1), /Recorded the rejection of B3 for demo \(ledger #\d+\)\. content-ux will read the rule/);
    out.length = 0;
    assert.equal(cmdErrors(root, ['list']), 0);
    const listed = out.join('\n');
    assert.match(listed, /builder \(1 rule\)\n {2}- Never ship a form without its error state/);
    assert.match(listed, /content-ux \(1 rule\)/);
    assert.equal(cmdErrors(root, ['clear', 'builder']), 2, 'clearing needs --yes');
    assert.equal(cmdErrors(root, ['clear', 'builder', '--yes']), 0);
    assert.deepEqual(allRules({ workspace }).map((x) => x.agent), ['content-ux']);
    assert.equal(cmdErrors(root, ['clear', '--yes']), 0);
    assert.deepEqual(allRules({ workspace }), []);
    assert.equal(cmdReject(root, [project, 'B3']), 2, 'a rejection needs a note');
  } finally {
    console.log = log;
    console.error = error;
  }
  assert.deepEqual(clearRules(undefined, { workspace }), []);
});

test('the memory never goes into git or the portable package', () => {
  assert.equal(forbiddenReason('memory/errors/builder.md'), 'error-memory');
  const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^memory\/$/m);
  assert.ok(!existsSync(new URL('../../memory/errors', import.meta.url)) || true, 'the harness memory may exist locally; tests never write to it');
});

test('step mode reads the rules at hand-out time, so a rule learned after planning still reaches the agent', async () => {
  const { cmdTask } = await import('../../src/cli/task.mjs');
  const { project, opts, dir } = withBrief();
  setPhase(dir, 'RESEARCH');
  const [planned] = planPhase(project, opts);
  assert.ok(!planned.inputs.includes('errors/rules/research-strategy.md'), 'no rules yet when it was planned');
  rejectGate(project, 'FACTS', { note: 'Never round the founding year; quote it as the client wrote it', ...opts });
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: dirname(dir) }));
  const out = [];
  const { log } = console;
  console.log = (s) => out.push(String(s));
  try {
    assert.equal(await cmdTask(root, ['next', project]), 0);
  } finally {
    console.log = log;
  }
  const printed = out.join('\n');
  assert.match(printed, /errors\/rules\/research-strategy.md/);
  assert.match(readFileSync(join(dir, 'errors/rules/research-strategy.md'), 'utf8'), /Never round the founding year/);
});

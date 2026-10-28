import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdScan } from '../../src/cli/scan.mjs';
import { addTask } from '../../src/core/board.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { approve } from '../../src/core/project.mjs';
import { MASK, redact, redactText, scanPaths, scanText, secretValues } from '../../src/core/redact.mjs';
import { runProject } from '../../src/core/runner.mjs';
import { decide } from '../../src/hooks/guard.mjs';
import { createClaudeCodeWorker, workerSettings } from '../../src/workers/claude-code.mjs';
import { addTasks, newProject, passVerifier, task } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, '..', '..', 'src', 'hooks', 'guard.mjs');
const FAKE = join(HERE, '..', 'fixtures', 'fake-claude.mjs');

// Realistic-looking but fake credentials, built at runtime so this file holds none.
const ANTHROPIC = ['sk', 'ant', 'api03', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('-');
const GITHUB = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const VERCEL = 'vcp' + 'Z9y8X7w6V5u4T3s2R1q0P9o8';

// ---- redaction ----

test('known token formats are masked wherever they appear', () => {
  const text = `key ${ANTHROPIC} and ${GITHUB}; header Authorization: Bearer abcdefghijklmnopqrstuvwx1234; VERCEL_TOKEN=${VERCEL}`;
  const out = redactText(text, { secrets: [] });
  for (const s of [ANTHROPIC, GITHUB, 'abcdefghijklmnopqrstuvwx1234', VERCEL]) assert.ok(!out.includes(s), `${s.slice(0, 6)}… was not masked`);
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.match(out, /VERCEL_TOKEN=\[REDACTED\]/);
});

test('the values of secret-looking variables in the environment are masked', () => {
  const secrets = secretValues({ VERCEL_TOKEN: 'plain-value-123', FORM_WEBHOOK_URL: 'https://hooks.example.com/T0/abc', HOME: '/home/suhani', SHORT_KEY: 'abc' });
  assert.deepEqual(secrets.sort(), ['https://hooks.example.com/T0/abc', 'plain-value-123']);
  assert.equal(redactText('posted to https://hooks.example.com/T0/abc ok', { secrets }), `posted to ${MASK} ok`);
});

test('ordinary text and code are left alone', () => {
  for (const s of ['const token = getToken();', 'password: string', 'the API key is in .env', 'task build-hero done', 'sha 3f2a9c1d']) {
    assert.equal(redactText(s, { secrets: [] }), s);
  }
});

test('redact copies nested data and leaves keys and non-strings alone', () => {
  const input = { message: `failed with ${GITHUB}`, list: [ANTHROPIC, 3], ok: true, token: null };
  const out = redact(input, { secrets: [] });
  assert.deepEqual(out, { message: `failed with ${MASK}`, list: [MASK, 3], ok: true, token: null });
  assert.equal(input.message.includes(GITHUB), true, 'the input is not changed');
});

test('the ledger never stores a credential', () => {
  const { project, opts } = newProject();
  ledger.append(project, { actor: 'cli', type: 'error', data: { message: `Vercel said: bad token ${GITHUB}` } }, opts);
  const raw = readFileSync(join(opts.workspace, project, 'ledger.jsonl'), 'utf8');
  assert.ok(!raw.includes(GITHUB));
  assert.match(raw, /\[REDACTED\]/);
});

test('verify logs are redacted', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero', { verify: `echo deploy key ${GITHUB}` }));
  const summary = await runProject(project, { ...opts, worker: async () => ({ evidence: ['site/hero.txt'] }) });
  assert.deepEqual(summary.done, ['hero']);
  const log = readFileSync(join(opts.workspace, project, 'evidence', 'tasks', 'hero', 'attempt-1-verify.log'), 'utf8');
  assert.ok(!log.includes(GITHUB));
});

// ---- scanning ----

test('the secret scan reports file, line and kind, never the secret', () => {
  assert.deepEqual(scanText(`ok\nx ${GITHUB}\n`, { secrets: [] }), [{ id: 'github-token', line: 2 }]);
  const root = mkdtempSync(join(tmpdir(), 'forge-scan-'));
  mkdirSync(join(root, 'site'));
  writeFileSync(join(root, 'site', 'app.js'), `const k = "${ANTHROPIC}";\n`);
  writeFileSync(join(root, 'site', 'clean.js'), 'export const x = 1;\n');
  writeFileSync(join(root, '.env'), 'X=1\n');
  writeFileSync(join(root, '.env.example'), 'X=\n');
  const findings = scanPaths(['.'], { root, secrets: [] });
  assert.deepEqual(findings.map((f) => `${f.file}:${f.id}`).sort(), ['.env:env-file', 'site/app.js:anthropic-key', 'site/app.js:openai-key'].sort());

  const out = [];
  const { log } = console;
  console.log = (...a) => out.push(a.join(' '));
  try {
    assert.equal(cmdScan(root, ['site']), 1);
  } finally {
    console.log = log;
  }
  assert.ok(!out.join('\n').includes(ANTHROPIC), 'the scan never prints the secret');
});

test('the harness itself has no secrets in it', () => {
  const root = join(HERE, '..', '..');
  assert.deepEqual(scanPaths(['src', 'schemas', 'agents', 'plugins', 'docs', 'fixtures', 'samples', '.claude'], { root, secrets: [] }), []);
});

// ---- the guard hook ----

function workspaceWithTask() {
  const { project, opts } = newProject();
  addTask(project, task('hero', { owns_files: ['site/src/Hero.astro', 'site/public/hero/**'], must_not_touch: ['site/public/hero/locked.svg'] }), opts);
  const dir = join(opts.workspace, project);
  const env = { FORGE_PROJECT: project, FORGE_TASK: 'hero', FORGE_WORKSPACE: opts.workspace };
  return { project, opts, dir, env };
}

test('a task worker may write only its own files', () => {
  const { dir, env } = workspaceWithTask();
  const write = (p) => decide({ toolName: 'Write', toolInput: { file_path: p }, cwd: dir, env });
  assert.equal(write('site/src/Hero.astro').allow, true);
  assert.equal(write(join(dir, 'site', 'public', 'hero', 'a.png')).allow, true);
  assert.match(write('site/src/Nav.astro').reason, /not in owns_files for task hero/);
  assert.match(write('site/public/hero/locked.svg').reason, /must_not_touch/);
  assert.match(write('../other/site/x.txt').reason, /outside project/);
  assert.match(write(join(tmpdir(), 'x.txt')).reason, /outside project/);
  assert.match(decide({ toolName: 'Edit', toolInput: { file_path: 'board/hero.json' }, cwd: dir, env }).reason, /belongs to the forge runtime/);
  assert.equal(decide({ toolName: 'Bash', toolInput: { command: 'ls' }, cwd: dir, env }).allow, false, 'workers have no shell');
  assert.equal(decide({ toolName: 'Read', toolInput: { file_path: 'design/tokens.json' }, cwd: dir, env }).allow, true, 'reading is fine');
});

test('a worker whose contract cannot be read may not write at all', () => {
  const { dir, env } = workspaceWithTask();
  assert.match(decide({ toolName: 'Write', toolInput: { file_path: 'site/src/Hero.astro' }, cwd: dir, env: { ...env, FORGE_TASK: 'ghost' } }).reason, /could not be read/);
});

test('.env is never read or written, by a tool or a shell command', () => {
  const env = { FORGE_WORKSPACE: mkdtempSync(join(tmpdir(), 'forge-ws-')) };
  const cwd = mkdtempSync(join(tmpdir(), 'forge-cwd-'));
  for (const toolName of ['Read', 'Write', 'Edit']) {
    assert.equal(decide({ toolName, toolInput: { file_path: '.env' }, cwd, env }).allow, false, toolName);
    assert.equal(decide({ toolName, toolInput: { file_path: 'site/.env.local' }, cwd, env }).allow, false, toolName);
  }
  assert.equal(decide({ toolName: 'Read', toolInput: { file_path: '.env.example' }, cwd, env }).allow, true);
  for (const command of ['cat .env', 'type .env', 'Get-Content ./.env', 'source .env && npm test', 'grep KEY .env.local', 'cp .env /tmp/x']) {
    assert.equal(decide({ toolName: 'Bash', toolInput: { command }, cwd, env }).allow, false, command);
  }
  for (const command of ['cp .env.example .env.example.bak', 'npm test', 'git status', 'echo environment']) {
    assert.equal(decide({ toolName: 'Bash', toolInput: { command }, cwd, env }).allow, true, command);
  }
});

test('a production deploy needs B7 in the ledger; the Vercel CLI is never used for it', () => {
  const { project, opts } = newProject();
  const env = { FORGE_WORKSPACE: opts.workspace };
  const cmd = (command) => decide({ toolName: 'Bash', toolInput: { command }, env });
  assert.match(cmd(`./forge deploy ${project} --production`).reason, /B7 is not recorded/);
  assert.equal(cmd(`./forge deploy ${project} --preview`).allow, true);
  approve(project, 'B7', opts);
  assert.equal(cmd(`./forge deploy ${project} --production`).allow, true);
  assert.match(cmd('npx vercel deploy --prod').reason, /not with the Vercel CLI/);
  assert.match(cmd('vercel --prod --yes').reason, /not with the Vercel CLI/);
  assert.equal(cmd('vercel ls').allow, true);
});

test('interactive sessions keep editing the harness, but not the runtime files', () => {
  const { project, opts } = newProject();
  const env = { FORGE_WORKSPACE: opts.workspace };
  const root = join(HERE, '..', '..');
  assert.equal(decide({ toolName: 'Edit', toolInput: { file_path: join(root, 'src', 'core', 'runner.mjs') }, env }).allow, true);
  assert.equal(decide({ toolName: 'Write', toolInput: { file_path: join(opts.workspace, project, 'intake', 'brief.json') }, env }).allow, true);
  for (const rel of ['project.json', 'ledger.jsonl', 'locks/run.lock', 'evidence/recordings/x/attempt-1.json']) {
    assert.equal(decide({ toolName: 'Write', toolInput: { file_path: join(opts.workspace, project, rel) }, env }).allow, false, rel);
  }
});

test('the hook blocks with exit code 2 and a reason, and allows with 0', () => {
  const { dir, env } = workspaceWithTask();
  const run = (call) => spawnSync(process.execPath, [GUARD], { input: JSON.stringify(call), encoding: 'utf8', env: { ...process.env, ...env } });
  const blocked = run({ tool_name: 'Write', tool_input: { file_path: 'site/src/Nav.astro' }, cwd: dir });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Blocked by forge: .*not in owns_files/);
  assert.equal(run({ tool_name: 'Write', tool_input: { file_path: 'site/src/Hero.astro' }, cwd: dir }).status, 0);
  const broken = spawnSync(process.execPath, [GUARD], { input: '{not json', encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(broken.status, 2, 'a worker fails closed');
});

test('workers run Claude Code with the guard hook and their contract in the environment', async () => {
  const { project, opts } = newProject();
  addTasks(project, opts, task('hero'));
  await runProject(project, { ...opts, worker: createClaudeCodeWorker({ command: [process.execPath, FAKE] }), verifier: passVerifier });
  const rec = JSON.parse(readFileSync(join(opts.workspace, project, 'evidence', 'recordings', 'hero', 'attempt-1.json'), 'utf8'));
  assert.ok(rec.args.includes('--settings'));
  const hook = workerSettings().hooks.PreToolUse[0];
  assert.match(hook.matcher, /Write/);
  assert.match(hook.hooks[0].command, /guard\.mjs"$/);
});

test('the committed Claude Code settings run the guard', () => {
  const settings = JSON.parse(readFileSync(join(HERE, '..', '..', '.claude', 'settings.json'), 'utf8'));
  const hook = settings.hooks.PreToolUse[0];
  assert.match(hook.matcher, /Bash/);
  assert.match(hook.hooks[0].command, /src\/hooks\/guard\.mjs/);
});

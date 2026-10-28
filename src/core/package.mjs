import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SchemaInvalid, Unavailable } from './errors.mjs';
import { walk } from './glob.mjs';
import { knownSecrets, scanText } from './redact.mjs';
import { ROOT } from './workspace.mjs';
import { createZip, readZip } from './zip.mjs';

// forge package (T11): builds forge-v<version>.zip from an allow-list of the harness's files,
// then opens the archive it just wrote and checks every entry. It fails if anything forbidden
// slipped in: node_modules, .env, workspace data, logs, Git history, a credential or a personal
// absolute path. Only files Git tracks are packed, so ignored and untracked files never are.

// Top-level files and folders that make up the harness (the plan's package layout).
export const ALLOW = [
  'README.md', 'QUICKSTART.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'VERSION',
  'package.json', 'package-lock.json', 'forge', 'forge.cmd', '.env.example', 'forge.config.example.json',
  '.gitignore', '.gitattributes', 'CLAUDE.md', 'AGENTS.md', '.claude', '.cursor', 'agents', 'skills',
  'registry', 'schemas', 'src', 'plugins', 'starters', 'samples', 'fixtures', 'tests', 'tools', 'scripts',
  'docs', 'workspace/.gitkeep',
];

// The plan lists these in every release; a package without them is reported, not refused.
export const EXPECTED = ['README.md', 'QUICKSTART.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md'];

const FORBIDDEN = [
  { id: 'node-modules', re: /(^|\/)node_modules(\/|$)/ },
  { id: 'env-file', re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/ },
  { id: 'workspace-data', re: /^workspace\/(?!\.gitkeep$)/ },
  { id: 'git-history', re: /(^|\/)\.git(\/|$)/ },
  { id: 'log-file', re: /\.log$/ },
  { id: 'local-config', re: /^forge\.config\.json$/ },
  { id: 'os-junk', re: /(^|\/)(\.DS_Store|Thumbs\.db)$/ },
];

// A path inside a real person's home folder (C:\Users\<name>\ or /home/<name>/). Placeholders
// such as <you> or $USER are allowed.
const PERSONAL_PATH = /\b[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!<|\{|\$|you\b|your|name\b|USER|Public\b|Default\b)[A-Za-z0-9._-]+|(?<![A-Za-z0-9._-])\/(?:Users|home)\/(?!<|\{|\$|you\b|your|name\b|user\b|runner\b)[a-z0-9._-]+(?=[/\\'"`\s]|$)/;

const EXECUTABLE = new Set(['forge', 'scripts/setup.sh', 'scripts/clean-extract-test.sh']);

const allowed = (path) => ALLOW.some((a) => path === a || path.startsWith(`${a}/`));

export function forbiddenReason(path) {
  return FORBIDDEN.find((f) => f.re.test(path))?.id ?? null;
}

function trackedFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.status === 0) return r.stdout.split('\0').filter(Boolean);
  return walk(root, { skip: ['node_modules', '.git', 'dist', 'workspace'] });
}

export function packageFiles(root = ROOT) {
  return trackedFiles(root)
    .filter((p) => allowed(p) && !forbiddenReason(p))
    .filter((p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile())
    .sort();
}

// THIRD_PARTY_NOTICES.md from the installed production dependencies, when the repository does
// not hold its own.
export function thirdPartyNotices(root = ROOT) {
  const dir = join(root, 'node_modules');
  const rows = [];
  if (existsSync(dir)) {
    const names = readdirSync(dir).flatMap((n) => (n.startsWith('@') ? readdirSync(join(dir, n)).map((s) => `${n}/${s}`) : [n]));
    for (const name of names.filter((n) => !n.startsWith('.'))) {
      const file = join(dir, name, 'package.json');
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      const licence = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN';
      rows.push(`| ${pkg.name} | ${pkg.version} | ${licence} |`);
    }
  }
  return ['# Third-party notices', '', 'Dependencies installed by `npm ci`, with the licence each one declares.', '', '| Package | Version | Licence |', '| --- | --- | --- |', ...rows.sort(), ''].join('\n');
}

// Checks archive entries; returns [{ file, id, line? }] and never the matched text.
export function auditEntries(entries, { secrets = knownSecrets(), prefix = '' } = {}) {
  const problems = [];
  for (const e of entries) {
    const path = e.name.startsWith(prefix) ? e.name.slice(prefix.length) : e.name;
    const why = forbiddenReason(path);
    if (why) {
      problems.push({ file: path, id: why });
      continue;
    }
    if (e.data.includes(0)) continue;
    const text = e.data.toString('utf8');
    for (const f of scanText(text, { secrets })) problems.push({ file: path, ...f });
    text.split(/\r?\n/).forEach((line, i) => {
      if (PERSONAL_PATH.test(line)) problems.push({ file: path, id: 'personal-path', line: i + 1 });
    });
  }
  return problems;
}

// Builds the ZIP and audits it. Returns { file, version, files, missing } or throws with the
// problems listed (the archive is deleted).
export function buildPackage({ root = ROOT, outDir = join(root, 'dist'), secrets } = {}) {
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  const prefix = `forge-v${version}/`;
  const files = packageFiles(root);
  const entries = files.map((f) => ({ name: prefix + f, data: readFileSync(join(root, f)), mode: EXECUTABLE.has(f) ? 0o755 : 0o644 }));
  if (!files.includes('THIRD_PARTY_NOTICES.md')) entries.push({ name: `${prefix}THIRD_PARTY_NOTICES.md`, data: Buffer.from(thirdPartyNotices(root)) });
  const present = new Set(entries.map((e) => e.name.slice(prefix.length)));
  const missing = EXPECTED.filter((f) => !present.has(f));

  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `forge-v${version}.zip`);
  writeFileSync(file, createZip(entries));

  const problems = auditEntries(readZip(readFileSync(file)), { secrets, prefix });
  if (problems.length) {
    rmSync(file, { force: true });
    throw new SchemaInvalid(`The package was not built: ${problems.length} problem${problems.length === 1 ? '' : 's'} found`, {
      hint: 'Remove the files or lines listed, then run forge package again.',
      details: problems,
    });
  }
  return { file, version, files: entries.length, missing };
}

export function extractZip(file, dest) {
  for (const e of readZip(readFileSync(file))) {
    if (e.name.endsWith('/')) continue;
    if (e.name.split('/').includes('..')) throw new SchemaInvalid(`Unsafe path in archive: ${e.name}`);
    const target = join(dest, e.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, e.data, { mode: e.mode || 0o644 });
  }
}

// The clean-extraction test: extract the ZIP into an empty folder, then run setup's steps
// (npm ci, a config from the example), forge doctor and the test suite there. Needs network
// access for npm ci.
export function verifyPackage(file, { keep = false, log = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-clean-'));
  const steps = [];
  try {
    extractZip(file, dir);
    const [top] = readdirSync(dir);
    const home = join(dir, top);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const run = (name, cmd, args) => {
      log(`${name}...`);
      const r = spawnSync(cmd, args, { cwd: home, encoding: 'utf8', shell: process.platform === 'win32' && cmd === npm, windowsHide: true, timeout: 15 * 60_000 });
      const step = { name, ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n') };
      steps.push(step);
      if (!step.ok) throw new Unavailable(`Clean extraction failed at "${name}"`, { details: steps });
    };
    run('npm ci', npm, ['ci', '--no-audit', '--no-fund']);
    writeFileSync(join(home, 'forge.config.json'), readFileSync(join(home, 'forge.config.example.json')));
    run('forge doctor', process.execPath, ['src/cli/index.mjs', 'doctor']);
    run('npm test', npm, ['test']);
    return { dir: home, steps };
  } finally {
    if (!keep) rmSync(dir, { recursive: true, force: true });
  }
}

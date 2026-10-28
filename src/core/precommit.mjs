import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import { scanText } from './redact.mjs';
import { ROOT } from './workspace.mjs';

// A Git pre-commit hook that runs the secret scan on staged files, in Claude Code and Cursor
// alike. The git plugin installs it in every project repository; `forge hooks install` puts it
// in any other repository, such as the harness itself.

const MARK = '# forge pre-commit hook';

export function hookScript(root = ROOT, nodePath = process.execPath) {
  const node = nodePath.replace(/\\/g, '/');
  const cli = join(root, 'src', 'cli', 'index.mjs').replace(/\\/g, '/');
  return `#!/bin/sh\n${MARK}: blocks a commit that would add a credential or a .env file.\nexec "${node}" "${cli}" scan --staged\n`;
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

export function installPreCommit(repoDir, { root = ROOT, force = false } = {}) {
  const r = git(repoDir, ['rev-parse', '--git-path', 'hooks']);
  if (r.status !== 0) throw new ConfigMissing(`${repoDir} is not a Git repository`);
  const dir = join(repoDir, r.stdout.trim());
  const file = join(dir, 'pre-commit');
  if (existsSync(file) && !readFileSync(file, 'utf8').includes(MARK) && !force) {
    throw new PermissionDenied('A different pre-commit hook is already installed', { hint: 'Add `forge scan --staged` to it yourself, or pass --force to replace it.' });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, hookScript(root));
  try {
    chmodSync(file, 0o755);
  } catch {
    // Windows has no executable bit; Git for Windows runs the hook anyway.
  }
  return file;
}

// Scans the staged version of every staged file (what the commit would contain).
export function scanStaged(repoDir) {
  const names = git(repoDir, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']);
  if (names.status !== 0) throw new ConfigMissing(`${repoDir} is not a Git repository`);
  const findings = [];
  for (const file of names.stdout.split('\0').filter(Boolean)) {
    const base = file.split('/').pop();
    if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
      findings.push({ file, id: 'env-file', line: null });
      continue;
    }
    const blob = spawnSync('git', ['show', `:${file}`], { cwd: repoDir, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
    if (blob.status !== 0 || blob.stdout.includes(0)) continue;
    for (const f of scanText(blob.stdout.toString('utf8'))) findings.push({ file, ...f });
  }
  return findings;
}

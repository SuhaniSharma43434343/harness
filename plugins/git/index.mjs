import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConfigMissing, Unavailable } from '../../src/core/errors.mjs';

// Local Git repository per project (Release 1.0: no remote, no GitHub). The project folder is
// the top of its own repository, which is what forge resume relies on to discard a crashed
// task's uncommitted changes.

export const actionKinds = { init: 'write', commit: 'write', status: 'read', log: 'read' };

const MIN = [2, 40];

// The runtime's own working files stay out of history.
const IGNORE = ['locks/', 'node_modules/', 'site/node_modules/', 'site/.astro/', '.env', '.env.*', '!.env.example', ''].join('\n');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.error?.code === 'ENOENT') throw new ConfigMissing('Git is not installed', { hint: 'Install Git 2.40 or later.' });
  return r;
}

function must(r, what) {
  if (r.status !== 0) throw new Unavailable(`git ${what} failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  return r.stdout;
}

const isRepoTop = (dir) => {
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  return r.status === 0 && resolve(r.stdout.trim()).toLowerCase() === resolve(dir).toLowerCase();
};

export async function healthCheck() {
  const out = must(git(process.cwd(), ['--version']), '--version');
  const [maj, min] = (out.match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
  if (!(maj > MIN[0] || (maj === MIN[0] && min >= MIN[1]))) {
    return { ok: false, detail: `${out.trim()} is older than ${MIN.join('.')}` };
  }
  return { ok: true, detail: out.trim() };
}

// Makes the project folder its own repository, with an ignore file and a first commit.
// Running it again on an initialised project changes nothing.
export async function init(projectDir) {
  if (isRepoTop(projectDir)) return { created: false };
  must(git(projectDir, ['init', '-q', '-b', 'main']), 'init');
  if (!existsSync(join(projectDir, '.gitignore'))) writeFileSync(join(projectDir, '.gitignore'), IGNORE);
  must(git(projectDir, ['add', '-A']), 'add');
  must(git(projectDir, ['-c', 'user.name=Forge', '-c', 'user.email=forge@localhost', 'commit', '-q', '--allow-empty', '-m', 'Project created']), 'commit');
  return { created: true };
}

// Commits the given paths (or everything) and returns the new commit, or null if nothing changed.
export async function commit(projectDir, message, { paths = ['.'], author = 'Forge <forge@localhost>' } = {}) {
  if (!isRepoTop(projectDir)) throw new ConfigMissing(`${projectDir} is not a Git repository`, { hint: 'Run the git plugin init action first.' });
  must(git(projectDir, ['add', '--', ...paths]), 'add');
  if (git(projectDir, ['diff', '--cached', '--quiet']).status === 0) return null;
  const [name, email] = author.match(/^(.*) <(.*)>$/)?.slice(1) ?? ['Forge', 'forge@localhost'];
  must(git(projectDir, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', message]), 'commit');
  return must(git(projectDir, ['rev-parse', 'HEAD']), 'rev-parse').trim();
}

export async function status(projectDir) {
  if (!isRepoTop(projectDir)) return { repo: false, changed: [] };
  const out = must(git(projectDir, ['status', '--porcelain']), 'status');
  return { repo: true, changed: out.split('\n').filter(Boolean).map((l) => l.slice(3)) };
}

export async function log(projectDir, { limit = 20 } = {}) {
  if (!isRepoTop(projectDir)) return [];
  const out = must(git(projectDir, ['log', `-${limit}`, '--format=%H%x09%s']), 'log');
  return out.split('\n').filter(Boolean).map((l) => {
    const [sha, subject] = l.split('\t');
    return { sha, subject };
  });
}

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../core/config.mjs';

// Minimum versions from the plan's supported-platforms table.
export const REQUIREMENTS = {
  node: '22.0.0',
  npm: '10.0.0',
  git: '2.40.0',
};

export function parseVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

export function versionAtLeast(actual, minimum) {
  const a = parseVersion(actual);
  const b = parseVersion(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function runVersion(cmd, args = ['--version']) {
  // npm and claude are .cmd shims on Windows, which need a shell to run.
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 15000,
  });
  if (res.error || res.status !== 0) return null;
  return (res.stdout || res.stderr).trim();
}

function toolCheck(name, cmd, minimum, { required = true, why } = {}) {
  const out = runVersion(cmd);
  if (!out) {
    return {
      name,
      status: required ? 'fail' : 'warn',
      detail: `${cmd} not found`,
      hint: why ?? `Install ${name}${minimum ? ` ${minimum} or later` : ''}`,
    };
  }
  const version = parseVersion(out)?.join('.') ?? out;
  if (minimum && !versionAtLeast(version, minimum)) {
    return {
      name,
      status: required ? 'fail' : 'warn',
      detail: `found ${version}, need ${minimum}+`,
      hint: `Upgrade ${name}`,
    };
  }
  return { name, status: 'ok', detail: version };
}

export function runDoctor(root) {
  const checks = [];

  checks.push(
    versionAtLeast(process.versions.node, REQUIREMENTS.node)
      ? { name: 'Node.js', status: 'ok', detail: process.versions.node }
      : {
          name: 'Node.js',
          status: 'fail',
          detail: `found ${process.versions.node}, need ${REQUIREMENTS.node}+`,
          hint: 'Install Node 22 LTS',
        },
  );
  checks.push(toolCheck('npm', 'npm', REQUIREMENTS.npm));
  checks.push(toolCheck('Git', 'git', REQUIREMENTS.git));
  checks.push(
    toolCheck('Claude Code', 'claude', null, {
      required: false,
      why: 'Install Claude Code and sign in; it is needed for real-model runs (mock mode works without it)',
    }),
  );

  let loaded;
  try {
    loaded = loadConfig(root);
    checks.push({
      name: 'Config',
      status: 'ok',
      detail: loaded.source === 'defaults' ? 'no forge.config.json; using safe defaults' : 'forge.config.json valid',
    });
  } catch (err) {
    checks.push({ name: 'Config', status: 'fail', detail: err.message, hint: err.hint });
  }

  if (loaded) {
    checks.push(
      loaded.envFileFound
        ? { name: '.env', status: 'ok', detail: 'found (values not shown)' }
        : {
            name: '.env',
            status: 'warn',
            detail: 'not found',
            hint: 'Copy .env.example to .env and add only the credentials you need',
          },
    );

    const workspace = resolve(root, loaded.config.workspaceDir);
    try {
      if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
      accessSync(workspace, constants.W_OK);
      checks.push({ name: 'Workspace', status: 'ok', detail: 'writable' });
    } catch (err) {
      checks.push({ name: 'Workspace', status: 'fail', detail: err.code ?? err.message, hint: `Make ${workspace} writable` });
    }

    const enabled = Object.entries(loaded.config.plugins).filter(([, on]) => on).map(([id]) => id);
    checks.push({
      name: 'Plugins',
      status: 'ok',
      detail: enabled.length ? `enabled: ${enabled.join(', ')} (each one's health check is listed below)` : 'none enabled',
    });
  }

  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, platform: `${process.platform} ${process.arch}`, checks };
}

export function printDoctor(report, out = console.log) {
  const mark = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL' };
  out(`forge doctor (${report.platform})`);
  for (const c of report.checks) {
    out(`  [${mark[c.status]}] ${c.name.padEnd(12)} ${c.detail}`);
    if (c.hint && c.status !== 'ok') out(`         -> ${c.hint}`);
  }
  out(report.ok ? 'All required checks passed.' : 'Some required checks failed.');
}

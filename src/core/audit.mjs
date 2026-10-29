import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPackage } from './package.mjs';
import { scanPaths } from './redact.mjs';
import { ROOT } from './workspace.mjs';

// forge audit (T29, acceptance A13): the release security review.
//   1. npm audit of every lockfile the harness installs from: the harness, the starter site and
//      the optional test tools. Any high or critical advisory fails the audit.
//   2. A secret scan of the package ZIP (forge package audits every entry), the workspace (every
//      project's files, ledger, logs and reports) and any log files next to the package.
// It writes a Markdown and a JSON report and never prints a secret.

export const LOCKFILES = ['.', 'starters/astro-base', 'tools'];
const BLOCKING = ['high', 'critical'];

function npmAudit(dir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['audit', '--json', '--package-lock-only'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 120_000 });
  let data;
  try {
    data = JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.error?.message || 'npm audit gave no report').trim().split('\n').pop() };
  }
  if (data.error) return { error: data.error.summary ?? data.error.code };
  const advisories = Object.values(data.vulnerabilities ?? {}).map((v) => ({ name: v.name, severity: v.severity, range: v.range, fix: v.fixAvailable === true ? 'available' : v.fixAvailable ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : 'none' }));
  return { counts: data.metadata.vulnerabilities, advisories };
}

export function runAudit({ root = ROOT, outDir = join(root, 'dist'), now = new Date(), secrets } = {}) {
  const report = { date: now.toISOString().slice(0, 10), dependencies: [], secrets: [], package: null, ok: true, problems: [] };

  for (const rel of LOCKFILES) {
    const dir = join(root, rel);
    if (!existsSync(join(dir, 'package-lock.json'))) continue;
    const r = npmAudit(dir);
    report.dependencies.push({ lockfile: rel === '.' ? 'package-lock.json' : `${rel}/package-lock.json`, ...r });
    if (r.error) report.problems.push(`npm audit could not check ${rel}: ${r.error}`);
    else for (const s of BLOCKING) if (r.counts[s]) report.problems.push(`${rel}: ${r.counts[s]} ${s} advisor${r.counts[s] === 1 ? 'y' : 'ies'}`);
  }

  try {
    const pkg = buildPackage({ root, outDir, secrets });
    report.package = { file: pkg.file, files: pkg.files, missing: pkg.missing, findings: [] };
  } catch (err) {
    report.package = { findings: err.details ?? [{ id: 'build-failed', file: err.message }] };
    report.problems.push(`the package failed its audit: ${report.package.findings.length} finding(s)`);
  }

  for (const rel of ['workspace', 'dist']) {
    if (!existsSync(join(root, rel))) continue;
    const found = scanPaths([rel], { root, secrets }).filter((f) => rel !== 'dist' || f.file.endsWith('.log'));
    report.secrets.push(...found);
  }
  if (report.secrets.length) report.problems.push(`${report.secrets.length} possible secret(s) in the workspace or logs`);

  report.ok = report.problems.length === 0;
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `audit-${report.date}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(`${base}.md`, toMarkdown(report));
  return { ...report, files: [`${base}.md`, `${base}.json`] };
}

export function toMarkdown(r) {
  const lines = [`# Security audit, ${r.date}`, '', `Result: **${r.ok ? 'pass' : 'fail'}**${r.ok ? '' : `: ${r.problems.join('; ')}`}`, '', '## Dependencies (npm audit)', ''];
  lines.push('| Lockfile | Critical | High | Moderate | Low |', '| --- | --- | --- | --- | --- |');
  for (const d of r.dependencies) {
    if (d.error) lines.push(`| \`${d.lockfile}\` | could not check: ${d.error} | | | |`);
    else lines.push(`| \`${d.lockfile}\` | ${d.counts.critical} | ${d.counts.high} | ${d.counts.moderate} | ${d.counts.low} |`);
  }
  const listed = r.dependencies.flatMap((d) => (d.advisories ?? []).map((a) => ({ ...a, lockfile: d.lockfile })));
  if (listed.length) {
    lines.push('', '| Lockfile | Package | Severity | Affected | Fix |', '| --- | --- | --- | --- | --- |');
    for (const a of listed) lines.push(`| \`${a.lockfile}\` | ${a.name} | ${a.severity} | ${a.range} | ${a.fix} |`);
  }
  lines.push('', '## Secret scan', '');
  const pf = r.package?.findings ?? [];
  lines.push(`- Package ZIP: ${pf.length ? `${pf.length} finding(s)` : 'clean'}${r.package?.files ? ` (${r.package.files} files)` : ''}`);
  for (const f of pf) lines.push(`  - \`${f.file}${f.line ? `:${f.line}` : ''}\` ${f.id}`);
  lines.push(`- Workspace, project logs and reports: ${r.secrets.length ? `${r.secrets.length} finding(s)` : 'clean'}`);
  for (const f of r.secrets) lines.push(`  - \`${f.file}${f.line ? `:${f.line}` : ''}\` ${f.id}`);
  lines.push('', 'Findings name the file, line and kind; the matched text is never written.', '');
  return lines.join('\n');
}

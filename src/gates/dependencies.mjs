import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Licences a shipped dependency may have without a record. Copyleft licences (GPL, AGPL, LGPL)
// and anything unknown need a row in assets/register.json with the package name, or they fail.
export const ALLOWED = ['MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Unlicense', 'CC0-1.0', 'OFL-1.1', 'BlueOak-1.0.0', 'Python-2.0', 'MPL-2.0', 'CC-BY-4.0', 'Zlib'];

// "(MIT OR Apache-2.0)" passes when any option is allowed; "MIT AND X" needs every part.
export function licenceAllowed(expr, allowed = ALLOWED) {
  if (!expr || typeof expr !== 'string') return false;
  const e = expr.replace(/[()]/g, '').trim();
  if (/\sOR\s/i.test(e)) return e.split(/\s+OR\s+/i).some((x) => licenceAllowed(x, allowed));
  if (/\sAND\s/i.test(e)) return e.split(/\s+AND\s+/i).every((x) => licenceAllowed(x, allowed));
  return allowed.includes(e);
}

// Dependencies: every package the site installs for production (site/package-lock.json, without
// dev packages) has an allowed licence or a licence record. Optional packages are reported
// but do not block (see below).
export default {
  name: 'dependencies',
  version: '0.1.0',
  thresholds: {},
  run(ctx) {
    const findings = [];
    const lockFile = join(ctx.siteDir, 'package-lock.json');
    if (!existsSync(lockFile)) {
      return { findings: [{ id: 'no-lockfile', severity: 'serious', message: 'site/package-lock.json is missing, so shipped dependencies cannot be checked (and npm ci cannot pin them)' }] };
    }
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    const recorded = new Map((ctx.json('assets/register.json', { assets: [] }).assets ?? []).filter((r) => r.package).map((r) => [r.package, r]));
    let checked = 0;
    for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
      if (!path || pkg.dev || pkg.link) continue;
      checked++;
      const name = path.split('node_modules/').pop();
      if (licenceAllowed(pkg.license)) continue;
      const row = recorded.get(name);
      if (row && row.status !== 'uncertain' && row.evidence) continue;
      // An optional package is a build-machine binary or its fallback (sharp's libvips builds,
      // for example): it runs where the site is built and is never sent to a visitor, so it is
      // reported for THIRD_PARTY_NOTICES but does not block.
      if (pkg.optional) {
        findings.push({ id: 'build-binary-licence', severity: 'moderate', message: `${name}@${pkg.version} is ${pkg.license ?? 'unlicensed'}; it is a build-machine binary, so record it in THIRD_PARTY_NOTICES`, location: `site/package-lock.json:${path}` });
        continue;
      }
      findings.push({ id: 'licence-not-allowed', severity: 'serious', message: `${name}@${pkg.version} is ${pkg.license ?? 'unlicensed'}, which needs a licence record`, location: `site/package-lock.json:${path}` });
    }
    return { findings, metrics: { packages: checked } };
  },
};

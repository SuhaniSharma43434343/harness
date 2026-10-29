import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigMissing, Unavailable } from '../core/errors.mjs';
import { ROOT } from '../core/workspace.mjs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : fallback);
const writeJson = (f, v) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
};

// Copies a recipe folder (skills/<app>/recipes/) into the site: sections/ goes to
// src/sections/<id>/ and lib/ to src/lib/<app>/. Existing files are overwritten, so applying
// twice gives the same site.
export function copyRecipes(module, siteDir) {
  const base = join(ROOT, module.recipes);
  if (!existsSync(base)) throw new ConfigMissing(`No recipes for ${module.id} at ${module.recipes}`);
  const written = [];
  for (const [from, to] of [
    ['sections', join('src', 'sections', module.id)],
    ['lib', join('src', 'lib', module.id.toLowerCase().replace('-', ''))],
  ]) {
    const src = join(base, from);
    if (!existsSync(src)) continue;
    cpSync(src, join(siteDir, to), { recursive: true });
    for (const f of readdirSync(src, { recursive: true })) written.push(join(to, String(f)).split('\\').join('/'));
  }
  return written;
}

// The licence rows an approach adds to assets/register.json for its packages. A package whose
// licence is not verified gets status 'uncertain' and no evidence, which the dependencies and
// licence gates treat as blocking until Asset Rights records the evidence.
export function registerPackages(module, projectDir) {
  const file = join(projectDir, 'assets', 'register.json');
  const register = readJson(file, { assets: [] });
  register.assets ??= [];
  for (const dep of module.packages) {
    if (register.assets.some((r) => r.package === dep.name)) continue;
    register.assets.push({
      package: dep.name,
      licence: dep.licence,
      source: `npm ${dep.name}@${dep.version}`,
      usage: `${module.id} ${module.name}`,
      status: dep.licenceVerified ? 'cleared' : 'uncertain',
      ...(dep.licenceVerified ? { evidence: `https://www.npmjs.com/package/${dep.name}/v/${dep.version}` } : {}),
      note: dep.note,
    });
  }
  writeJson(file, register);
}

// applyApproach(module, siteDir, opts?) => { files, packages }
// The generic part of every approach module: copy its sections and runtime into the site, add
// its packages (exact versions) to site/package.json, record their licences, list the approach
// in src/site.json, and install unless opts.install is false.
export function applyApproach(module, siteDir, opts = {}) {
  if (!existsSync(join(siteDir, 'package.json'))) throw new ConfigMissing(`No site at ${siteDir}`, { hint: 'Run forge site <project> first.' });
  const files = copyRecipes(module, siteDir);

  const pkgFile = join(siteDir, 'package.json');
  const pkg = readJson(pkgFile);
  pkg.dependencies = { ...pkg.dependencies };
  for (const dep of module.packages) pkg.dependencies[dep.name] = dep.version;
  pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)));
  writeJson(pkgFile, pkg);

  const siteFile = join(siteDir, 'src', 'site.json');
  const site = readJson(siteFile);
  if (site && !site.approaches.includes(module.id)) {
    site.approaches = [...site.approaches, module.id].sort();
    writeJson(siteFile, site);
  }
  registerPackages(module, opts.projectDir ?? dirname(siteDir));

  if (opts.install !== false && module.packages.length) {
    const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: siteDir, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) throw new Unavailable(`npm install failed for ${module.id}`, { hint: (r.error?.message ?? r.stderr ?? '').slice(-500) });
  }
  return { files, packages: module.packages.map((d) => `${d.name}@${d.version}`) };
}

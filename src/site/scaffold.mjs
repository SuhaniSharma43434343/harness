import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { ConfigMissing, PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { assertValid } from '../core/schemas.mjs';
import { assertProjectExists, readJson } from '../core/workspace.mjs';
import { getModule } from '../approaches/index.mjs';
import { planSite, toMarkdown } from './content.mjs';
import { DEFAULT_TOKENS, STARTER_DIR, assertTokens, fontPackages, fontsCss, tokensFromDirection } from './tokens.mjs';

// Fontsource packages are added at this range; the site's lockfile pins the exact version.
const FONTSOURCE_RANGE = '^5.0.0';
const SKIP = new Set(['node_modules', 'dist', '.astro']);

const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.split(sep).join('/'));
}

// Writes the brief, tokens and content into an existing copy of the starter at `siteDir`.
// `contentDir` is the project's content/pages/: a locked page there replaces the scaffold page.
// `approaches` are the ones being applied, so scaffold pages can place their sections.
// Returns { pages: [{ file, status }], forms, fonts }.
export function writeSite(siteDir, { brief, tokens = DEFAULT_TOKENS, contentDir, approaches = [] } = {}) {
  if (!brief) throw new ConfigMissing('writeSite needs a brief');
  assertTokens(tokens);
  const { site, pages } = planSite(brief, { approaches });

  writeJson(join(siteDir, 'src/site.json'), site);
  writeJson(join(siteDir, 'src/styles/tokens.json'), tokens);
  writeFileSync(join(siteDir, 'src/styles/fonts.css'), fontsCss(tokens));

  const fonts = fontPackages(tokens);
  if (fonts.length) {
    const pkgFile = join(siteDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    for (const name of fonts) pkg.dependencies[name] ??= FONTSOURCE_RANGE;
    writeJson(pkgFile, pkg);
  }

  // The starter's own sample pages are replaced, never mixed with the brief's pages.
  const pagesDir = join(siteDir, 'src/content/pages');
  rmSync(pagesDir, { recursive: true, force: true });
  const locked = new Set(listMarkdown(contentDir));
  const written = [];
  for (const page of pages) {
    const file = join(pagesDir, page.file);
    mkdirSync(dirname(file), { recursive: true });
    if (locked.has(page.file)) {
      cpSync(join(contentDir, page.file), file);
      written.push({ file: page.file, status: 'content' });
    } else {
      writeFileSync(file, toMarkdown(page));
      written.push({ file: page.file, status: 'scaffold' });
    }
  }
  return { pages: written, forms: Object.keys(site.forms), fonts };
}

// The tokens a project should use: design/tokens.json, else the chosen direction in
// design/directions.json, else the starter defaults (before B2).
export function projectTokens(dir) {
  const tokensFile = join(dir, 'design/tokens.json');
  if (existsSync(tokensFile)) return assertTokens(readJson(tokensFile), 'design/tokens.json');
  const dirsFile = join(dir, 'design/directions.json');
  if (existsSync(dirsFile)) {
    const decision = assertValid('designDecision', readJson(dirsFile), 'design/directions.json');
    if (decision.status === 'chosen') return tokensFromDirection(decision.directions.find((d) => d.id === decision.chosen));
  }
  return DEFAULT_TOKENS;
}

// Approaches the scaffold applies on its own when P3 selected them without an approval: their
// sections need no client assets, so the scaffold pages can use them straight away.
const AUTO_APPLY = new Set(['APP-02', 'APP-05']);

// The approaches a (re)scaffold applies: the ones the old site already had (a rebuild must not
// drop them), plus the selected ones in AUTO_APPLY.
function approachesFor(dir) {
  const ids = new Set();
  const oldSite = join(dir, 'site/src/site.json');
  if (existsSync(oldSite)) for (const id of readJson(oldSite).approaches ?? []) ids.add(id);
  const decisionFile = join(dir, 'design/approach-decision.json');
  if (existsSync(decisionFile)) {
    for (const d of readJson(decisionFile).decisions ?? []) {
      if (d.selected && !d.needsApproval && AUTO_APPLY.has(d.approach)) ids.add(d.approach);
    }
  }
  ids.delete('APP-01');
  return [...ids].sort();
}

// Copies the starter template into workspace/<project>/site/ and writes the brief, tokens
// and content into it. Refuses to overwrite an existing site unless `force` is set.
export function scaffoldSite(project, { brief, tokens, force = false, starter = STARTER_DIR, actor = 'cli', ...opts } = {}) {
  const paths = assertProjectExists(project, opts);
  const briefFile = join(paths.dir, 'intake/brief.json');
  brief ??= existsSync(briefFile) ? readJson(briefFile) : undefined;
  if (!brief) {
    throw new ConfigMissing(`Project "${project}" has no brief`, { hint: 'Write intake/brief.json or pass --brief <file>.' });
  }
  const approaches = approachesFor(paths.dir);
  if (existsSync(paths.site)) {
    if (!force) {
      throw new PermissionDenied(`Project "${project}" already has a site`, {
        hint: 'Pass --force to replace it. Builders own site/ once it exists.',
      });
    }
    rmSync(paths.site, { recursive: true, force: true });
  }
  tokens ??= projectTokens(paths.dir);

  cpSync(starter, paths.site, {
    recursive: true,
    filter: (src) => !relative(starter, src).split(sep).some((part) => SKIP.has(part)),
  });
  const result = writeSite(paths.site, { brief, tokens, contentDir: join(paths.dir, 'content/pages'), approaches });
  // Packages are installed by the build (forge site --build), not here.
  for (const id of approaches) getModule(id).apply(paths.site, { install: false, projectDir: paths.dir });
  ledger.append(
    project,
    { actor, type: 'note', data: { event: 'site_scaffolded', starter: 'astro-base', tokens: tokens.source, pages: result.pages, approaches } },
    opts,
  );
  return { siteDir: paths.site, tokens: tokens.source, approaches, ...result };
}


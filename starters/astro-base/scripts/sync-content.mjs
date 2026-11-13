// Runs before every build. In a Forge workspace the project's content/ folder is the single
// source of truth for copy; this pulls it in fresh, so a hand-run `npm run build` can never ship
// text older than an approved copy change (the vendored copies once drifted exactly that way).
// Outside a workspace (fixtures, a standalone checkout) there is no ../content and that step is a no-op.
//
// It then writes one route per page that imports only that page's sections, so each page ships
// only the CSS it uses. Rendering every page through one catch-all route put the CSS of every
// section on the site into every page.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The first line of every generated route, so the next build can find and replace them.
const ROUTE_MARK = '// forge:generated-route';

const site = fileURLToPath(new URL('..', import.meta.url));
const project = join(site, '..');
const pages = join(project, 'content', 'pages');
if (existsSync(pages)) {
  const target = join(site, 'src', 'content', 'pages');
  rmSync(target, { recursive: true, force: true });
  cpSync(pages, target, { recursive: true });
}
const copy = join(project, 'content', 'copy.json');
if (existsSync(copy)) cpSync(copy, join(site, 'src', 'copy.json'));

// Scroll video configs (APP-02 ScrollVideo) live in the project's design/scroll-video/; pull them
// fresh too, so the scene timing a build ships is always the approved file. Reports are left out.
const scrollVideo = join(project, 'design', 'scroll-video');
if (existsSync(scrollVideo)) {
  const target = join(site, 'src', 'data', 'scroll-video');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(scrollVideo)) {
    if (/^[a-z0-9]+(-[a-z0-9]+)*\.json$/.test(f) && !f.endsWith('.report.json')) cpSync(join(scrollVideo, f), join(target, f));
  }
}

writeRoutes(site);

// writeRoutes(site) => ids: a route file for each page in src/content/pages, and
// src/generated-routes.json listing the page ids it covers, which the catch-all route skips.
function writeRoutes(siteDir) {
  const src = join(siteDir, 'src');
  const routesDir = join(src, 'pages');
  const contentDir = join(src, 'content', 'pages');
  for (const file of walk(routesDir)) if (file.endsWith('.astro') && readFileSync(file, 'utf8').includes(ROUTE_MARK)) rmSync(file);
  const ids = [];
  for (const file of walk(contentDir).filter((f) => f.endsWith('.md')).sort()) {
    const id = relative(contentDir, file).replace(/\\/g, '/').replace(/\.md$/, '');
    // Only ids the content collection keeps as they are; anything else stays on the catch-all route.
    if (!/^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/.test(id)) continue;
    const route = join(routesDir, `${id}.astro`);
    if (existsSync(route)) continue; // a hand-written page of the same name wins
    const uses = sectionUses(readFileSync(file, 'utf8'));
    if (!uses.length) continue;
    for (const use of uses) {
      if (!existsSync(join(src, 'sections', `${use}.astro`))) {
        throw new Error(`Page "${id}" uses section "${use}", but src/sections/${use}.astro does not exist.`);
      }
    }
    const up = relative(dirname(route), src).replace(/\\/g, '/') || '.';
    const names = new Map(uses.map((u, i) => [u, `S${i}`]));
    const lines = [
      '---',
      `${ROUTE_MARK}: written by scripts/sync-content.mjs before each build. Do not edit; edit the page in content/pages.`,
      "import { getEntry, render } from 'astro:content';",
      `import Base from '${up}/layouts/Base.astro';`,
      `import SectionList from '${up}/components/SectionList.astro';`,
      ...[...names].map(([use, name]) => `import ${name} from '${up}/sections/${use}.astro';`),
      '',
      `const page = await getEntry('pages', ${JSON.stringify(id)});`,
      'const { Content } = await render(page);',
      `const components = { ${[...names].map(([use, name]) => `${JSON.stringify(use)}: ${name}`).join(', ')} };`,
      '---',
      '<Base title={page.data.title} description={page.data.description}>',
      '  <SectionList page={page} Content={Content} components={components} />',
      '</Base>',
      '',
    ];
    mkdirSync(dirname(route), { recursive: true });
    writeFileSync(route, lines.join('\n'));
    ids.push(id);
  }
  writeFileSync(join(src, 'generated-routes.json'), JSON.stringify(ids, null, 2) + '\n');
  return ids;
}

// The section components a page's frontmatter names, in order and without repeats.
function sectionUses(md) {
  const front = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const uses = [...front.matchAll(/^\s*-\s+use:\s*["']?(APP-0[1-8]\/[A-Z][A-Za-z0-9]*)["']?\s*$/gm)].map((m) => m[1]);
  return [...new Set(uses)];
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

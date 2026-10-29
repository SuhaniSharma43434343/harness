import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { addTask, listTasks } from './board.mjs';
import { ConfigMissing } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { ROOT, assertProjectExists } from './workspace.mjs';

// The planner: writes the task contracts a phase needs onto the board, from the brief. It is the
// standing plan for the phases whose work is the agents' (research, content, assets); phases whose
// work is a forge command (intake, directions, site, gates) get no tasks. Planning is idempotent:
// a task already on the board is kept as it is.

const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
const q = (s) => `"${s}"`;
// The verify command runs in the project folder, through the harness's own node and CLI.
const verify = (check) => `${q(process.execPath)} ${q(CLI)} check ${check}`;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pageFile = (slug) => (slug === '/' ? 'index.md' : `${slug.slice(1)}.md`);

const base = (project, id) => ({ approach_modules: [], depends_on: [], evidence: [], status: 'pending', idempotency_key: `${project}:${id}:v1`, budget: { minutes: 20, retries: 1 } });

const PLANS = {
  RESEARCH: (project, brief) => [
    {
      ...base(project, 'research'),
      id: 'research',
      agent: 'research-strategy',
      inputs: ['intake/brief.json', 'intake/facts.json', 'intake/material/**'],
      owns_files: ['research/summary.md', 'research/sources.json'],
      must_not_touch: ['intake/**', 'content/**', 'site/**'],
      acceptance: [
        `research/summary.md describes ${brief.client.name}'s business, audience and goals, and what the site must do for them, in plain prose of at least a few paragraphs`,
        'Every claim in the summary names a source id from research/sources.json, or is marked "(assumption)"',
        'research/sources.json is {"sources": [{"id", "title", "kind", "ref"}]}; the brief and intake facts count as sources (kind "client", ref their path)',
      ],
      verify: verify('research'),
    },
  ],

  CONTENT: (project, brief) => [
    {
      ...base(project, 'content'),
      id: 'content',
      agent: 'content-ux',
      budget: { minutes: 30, retries: 1 },
      inputs: ['intake/brief.json', 'research/summary.md', 'research/sources.json', 'site/src/content/pages/**'],
      owns_files: ['content/pages/**', 'content/claims.json'],
      must_not_touch: ['site/**', 'intake/**', 'research/**'],
      acceptance: [
        `One page in content/pages/ for each brief page: ${brief.pages.map((p) => `${pageFile(p.slug)} (${p.title}: ${p.purpose}; call to action "${p.cta}")`).join(', ')}`,
        'Start from the draft already in each file: keep its frontmatter fields and the sections list with their "use" values, and replace every heading, lead and body text with real copy for this client',
        'Set status: "locked" in each page. No placeholder text, no lorem ipsum, nothing in [brackets]',
        'Every factual claim (a number, a year, a guarantee) is in content/claims.json as {"claims": [{"text", "source"}]}, with a source id from research/sources.json',
      ],
      verify: verify('content'),
    },
  ],

  ASSETS_LICENSING: (project) => [
    {
      ...base(project, 'asset-register'),
      id: 'asset-register',
      agent: 'asset-rights',
      inputs: ['intake/brief.json', 'content/pages/**', 'design/directions.json'],
      owns_files: ['assets/register.json', 'assets/evidence/**'],
      must_not_touch: ['site/**', 'content/**'],
      acceptance: [
        'assets/register.json is {"assets": [...]} with one row per image, font or file the site uses: {"file", "licence", "source", "evidence", "status"}',
        'Fonts from the chosen design direction are listed with their licence (they come from Fontsource under OFL-1.1 or Apache-2.0); a site with no other assets still has the fonts. The build ships them as site/dist/_astro/<family>-<subset>-<weight>-normal.<hash>.woff and .woff2, so give each font one row whose file is a glob such as "_astro/work-sans-*.{woff,woff2}" (lowercase family, spaces as dashes)',
        'status is "cleared" only when the licence allows the use; anything else is "uncertain"',
      ],
      verify: verify('assets'),
    },
  ],
};

// Copies the starter's draft pages into content/pages/, so Content & UX edits real page files.
function seedContent(dir) {
  const drafts = join(dir, 'site', 'src', 'content', 'pages');
  const target = join(dir, 'content', 'pages');
  if (!existsSync(drafts)) throw new ConfigMissing('The site has no draft pages yet', { hint: 'Run forge site <project> first, so Content & UX starts from its pages.' });
  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(drafts).filter((x) => x.endsWith('.md'))) if (!existsSync(join(target, f))) cpSync(join(drafts, f), join(target, f));
}

// planPhase(project, phase?) => the tasks added (none when the phase is already planned or has
// no agent work).
export function planPhase(project, { phase, actor = 'lead-developer', ...opts } = {}) {
  const { dir } = assertProjectExists(project, opts);
  const current = phase ?? loadProject(project, opts).phase;
  const plan = PLANS[current];
  if (!plan) return [];
  const briefFile = join(dir, 'intake', 'brief.json');
  if (!existsSync(briefFile)) throw new ConfigMissing(`${project} has no brief`, { hint: `Run forge intake ${project} first.` });
  const brief = readJson(briefFile);
  if (current === 'CONTENT') seedContent(dir);
  const have = new Set(listTasks(project, opts).map((t) => t.id));
  const added = [];
  for (const t of plan(project, brief)) {
    if (have.has(t.id)) continue;
    added.push(addTask(project, t, opts));
  }
  if (added.length) ledger.append(project, { actor, type: 'note', data: { event: 'planned', phase: current, tasks: added.map((t) => t.id) } }, opts);
  return added;
}

export const PLANNED_PHASES = Object.keys(PLANS);

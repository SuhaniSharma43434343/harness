import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addTask, listTasks } from './board.mjs';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { ROOT, assertProjectExists } from './workspace.mjs';
import { FILES, readiness, stageById } from '../design/spec.mjs';
import { scaffoldSite } from '../site/scaffold.mjs';

// The planner: writes the task contracts a phase needs onto the board, from the brief and the
// design specification. These contracts are the whole design workflow: research and positioning,
// one interpreted approach, the design system, section, motion and asset plans, real copy, a
// specification review, then the build. Phases whose work is a forge command (intake, directions,
// gates) get no tasks. Planning is idempotent: a task already on the board is kept as it is.

const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
const q = (s) => `"${s}"`;
// The verify command runs in the project folder, through the harness's own node and CLI.
const verify = (check) => `${q(process.execPath)} ${q(CLI)} check ${check}`;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const base = (project, id) => ({ approach_modules: [], depends_on: [], evidence: [], status: 'pending', idempotency_key: `${project}:${id}:v1`, budget: { minutes: 20, retries: 1 } });

const SCHEMA = 'design/reference/design-spec.schema.json';
const shape = (name) => `The file must match the "${name}" definition in ${SCHEMA}`;
const SPEC_INPUTS = ['intake/brief.json', 'intake/material/**', 'research/positioning.json', 'research/summary.md', SCHEMA];
const SPEC = ['design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json'];

// Each stage's contract. A contract states what good looks like, because it is the agent's brief.
const STAGE_TASKS = {
  research: (brief) => ({
    budget: { minutes: 25, retries: 1 },
    inputs: ['intake/brief.json', 'intake/facts.json', 'intake/material/**', SCHEMA],
    owns_files: ['research/summary.md', 'research/sources.json', 'research/positioning.json'],
    must_not_touch: ['intake/**', 'content/**', 'site/**'],
    acceptance: [
      `research/summary.md describes ${brief.client.name}'s business, audience and goals, and what the site must do for them, in plain prose of at least a few paragraphs`,
      'Every claim in the summary names a source id from research/sources.json, or is marked "(assumption)"',
      'research/sources.json is {"sources": [{"id", "title", "kind", "ref"}]}; the brief and intake facts count as sources (kind "client", ref their path)',
      `research/positioning.json states the business, audience insights, objectives and this business's unique positioning. ${shape('positioning')}`,
      'Use WebSearch and WebFetch to study at least two real competitors and three real, well-designed sites worth learning from. For each, say what specifically to learn: a layout, a type treatment, a way of telling the story. If the web is unavailable, say so in researchLimits and do not invent URLs',
      'Do not state a fact about the business that is not in the brief or client material',
    ],
  }),

  direction: () => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/approach-decision.json', 'design/reference/methodologies/**'],
    owns_files: ['design/direction.json', 'design/direction.md'],
    must_not_touch: ['intake/**', 'research/**', 'site/**', 'content/**'],
    acceptance: [
      'Read all eight methodologies. Pick exactly one primaryApproach from those design/approach-decision.json selects, and in "rejected" say why each of the others does not fit this brief',
      'Treat the approach as a complete method: interpret every one of its dimensions for this business, without importing techniques from another approach. "combination" stays empty unless the methodology\'s compatibleWith allows it and you can argue the story needs it',
      'Write a "concept": one sentence, specific to this business, that could not describe a competitor. Everything else must serve it',
      'design/direction.md is the same direction as prose for the other agents: the concept, the personality, what the site must feel like, and what it must never do',
      shape('direction'),
    ],
  }),

  'design-system': () => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/direction.md', 'design/directions.json', 'design/reference/methodologies/**'],
    owns_files: ['design/design-system.json'],
    must_not_touch: ['design/directions.json', 'design/direction.json', 'site/**', 'content/**'],
    acceptance: [
      'Use the direction chosen at B2 in design/directions.json without changing it: its primary, accent, bg, surface, fg and muted colours and its display and body fonts. Add a secondary colour and say where each colour may be used',
      'Give a type hierarchy with at least five levels, each with a real size (use clamp for display), weight and line height, following the approach\'s typography',
      'Define the spacing scale, section rhythm, grid (columns, gutter, max width and how sections break it), borders, shadows, radius and surface treatments',
      'State 3 or more rules of the visual language: the specific recurring devices that make this site recognisable',
      'Give separate desktop, tablet and mobile rules',
      shape('designSystem'),
    ],
  }),

  'section-plan': (brief) => ({
    budget: { minutes: 25, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/reference/methodologies/**'],
    owns_files: ['design/section-plan.json'],
    must_not_touch: ['design/direction.json', 'design/design-system.json', 'site/**', 'content/**'],
    acceptance: [
      `Plan every section of every page: ${brief.pages.map((p) => `${p.slug} (${p.title}: ${p.purpose})`).join('; ')}`,
      'Section ids are unique across the site. For each section give its purpose, pattern (from the primary approach\'s layout.patterns, or give a patternReason), exact composition, visual hierarchy, background, typography, the asset ids and motion ids it uses, and desktop, tablet and mobile behaviour',
      'A composition is specific enough to draw: where things sit, what overlaps, how large, how the grid is broken. "A section with a heading and text" fails',
      'Do not default to cards. At most a quarter of sections may be card or grid layouts; no three neighbours may share a pattern; use at least four patterns',
      'Asset and motion ids you name here are defined next in design/asset-plan.json and design/motion-plan.json',
      shape('sectionPlan'),
    ],
  }),

  'motion-plan': () => ({
    budget: { minutes: 15, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/section-plan.json', 'design/reference/methodologies/**'],
    owns_files: ['design/motion-plan.json'],
    must_not_touch: ['design/section-plan.json', 'site/**', 'content/**'],
    acceptance: [
      'Define every motion id the section plan uses, and no others. Each has a kind (scroll, pin, hover, micro, transition, ambient), a trigger, a behaviour and a purpose: what it makes clearer',
      'Include at least one hover interaction, plus loading behaviour, navigation behaviour, page transitions and what reduced motion shows',
      'Keep to the primary approach\'s animation and scrolling. If its methodology requires pinning, include a pin; if it forbids pinning, do not',
      shape('motionPlan'),
    ],
  }),

  'asset-plan': () => ({
    budget: { minutes: 15, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/section-plan.json', 'assets/public/**', 'assets/unsplash-photos.json'],
    owns_files: ['design/asset-plan.json'],
    must_not_touch: ['design/section-plan.json', 'site/**', 'content/**', 'assets/**'],
    acceptance: [
      'Define every asset id the section plan uses, and no others: its kind, a description someone could act on, its source and its alt text',
      'source "client" or "licensed" must name an existing file under assets/public/ (the path relative to that folder) and its licence. Use files that are already there; you cannot download new ones',
      'Where no real file exists, use source "authored": a detailed inline SVG illustration, CSS artwork or shader the builder will make. Describe it so it looks made on purpose, with layers and depth. Never plan a generic placeholder',
      shape('assetPlan'),
    ],
  }),

  copy: (brief) => ({
    budget: { minutes: 30, retries: 1 },
    inputs: [...SPEC_INPUTS, 'research/sources.json', 'design/direction.md', 'design/section-plan.json'],
    owns_files: ['content/copy.json', 'content/claims.json'],
    must_not_touch: ['site/**', 'intake/**', 'research/**', 'design/**', 'content/pages/**'],
    acceptance: [
      `Write the real copy for every section in design/section-plan.json, in plan order, for ${brief.client.name}: eyebrow, headline, subheadline, body paragraphs, items and call-to-action labels as the section needs. Also the brand story, voice, navigation and footer`,
      `Each brief page has its title, a description and its call to action: ${brief.pages.map((p) => `${p.slug} "${p.cta}"`).join(', ')}`,
      'A headline says something, in this business\'s own voice; "Our services" fails. Write the way a good copywriter writes for this approach (see the direction). Use specifics from the brief and client material. Avoid stock phrases and do not open headlines the same way',
      "A stock or licensed photo is never described as this client's own work: captions and alt text say what it shows, not which job it came from",
      'State only facts found in the brief, client material or research. Every number, year, guarantee or award goes in content/claims.json as {"claims": [{"text", "source"}]}, with a source id from research/sources.json. If a section needs a fact you do not have, write without it',
      shape('siteCopy'),
    ],
  }),
};

// specTask(project, stage, brief, { fix?, problems? }) => the contract for one specification stage,
// or its fix task: the same contract with the Design Manager's findings to resolve.
export function specTask(project, stageId, brief, { fix, problems = [] } = {}) {
  const stage = stageById(stageId);
  const id = fix ? `${stage.task}-fix-${fix}` : stage.task;
  const t = STAGE_TASKS[stageId](brief);
  return {
    ...base(project, id),
    id,
    agent: stage.agent,
    ...t,
    acceptance: fix ? [...problems.map((p) => `Fix: ${p}`), 'Keep what is already right in the file, and change only what these findings need', ...t.acceptance] : t.acceptance,
    verify: verify(stageId),
  };
}

// Makes the methodologies and schema readable by a worker, which stays inside the project folder.
function copyReference(dir, approach) {
  const target = join(dir, 'design', 'reference');
  mkdirSync(target, { recursive: true });
  cpSync(join(ROOT, 'schemas', 'design-spec.schema.json'), join(target, 'design-spec.schema.json'));
  cpSync(join(ROOT, 'registry', 'methodologies'), join(target, 'methodologies'), { recursive: true });
  if (approach) {
    const skill = join(ROOT, 'skills', approach.toLowerCase().replace('-', ''));
    if (existsSync(skill)) cpSync(skill, join(target, 'skill'), { recursive: true });
  }
}

const stageTask = (stage) => (project, brief) => [specTask(project, stage, brief)];

const PLANS = {
  RESEARCH: stageTask('research'),
  APPROACH_SELECTION: stageTask('direction'),

  UX_DESIGN_SYSTEM: (project, brief) => {
    const tasks = ['design-system', 'section-plan', 'motion-plan', 'asset-plan'].map((s) => specTask(project, s, brief));
    tasks[1].depends_on = ['design-system'];
    tasks[2].depends_on = ['section-plan'];
    tasks[3].depends_on = ['section-plan'];
    return tasks;
  },

  CONTENT: stageTask('copy'),

  ASSETS_LICENSING: (project) => [
    {
      ...base(project, 'asset-register'),
      id: 'asset-register',
      agent: 'asset-rights',
      inputs: ['intake/brief.json', 'content/copy.json', 'design/directions.json', 'design/asset-plan.json', 'assets/public/**', 'assets/unsplash-photos.json'],
      owns_files: ['assets/register.json', 'assets/evidence/**'],
      must_not_touch: ['site/**', 'content/**', 'design/**', 'assets/public/**'],
      acceptance: [
        'assets/register.json is {"assets": [...]} with one row per image, font or file the site uses: {"file", "licence", "source", "evidence", "status"}',
        'Each client or licensed asset in design/asset-plan.json has a row. The site serves files under assets/public/ from its root, so "images/x.jpg" is the row\'s file. Authored inline SVG and CSS art needs no row',
        'Fonts from the chosen design direction are listed with their licence (they come from Fontsource under OFL-1.1 or Apache-2.0); a site with no other assets still has the fonts. The build ships them as site/dist/_astro/<family>-<subset>-<weight>-normal.<hash>.woff and .woff2, so give each font one row whose file is a glob such as "_astro/work-sans-*.{woff,woff2}" (lowercase family, spaces as dashes)',
        'favicon.svg is the harness starter\'s own mark: {"file": "favicon.svg", "licence": "harness (own work)", "source": "starters/astro-base", "evidence": "starters/astro-base/public/favicon.svg", "status": "cleared"}',
        'status is "cleared" only when the licence allows the use; anything else is "uncertain"',
      ],
      verify: verify('assets'),
    },
  ],

  // The specification review: a fresh task after each return, because the file it judges changed.
  TECHNICAL_PLAN: (project, brief, { dir, opts }) => {
    if (existsSync(join(dir, FILES.review))) return [];
    const n = listTasks(project, opts).filter((t) => t.id.startsWith('design-review')).length + 1;
    const id = `design-review-${n}`;
    return [
      {
        ...base(project, id),
        id,
        agent: 'design-manager',
        inputs: [...SPEC_INPUTS, ...SPEC, 'design/directions.json', 'content/copy.json', 'design/reference/methodologies/**'],
        owns_files: [FILES.review],
        must_not_touch: [...SPEC, 'content/**', 'site/**'],
        acceptance: [
          'Read the whole specification as one piece of work, and judge what a checker cannot: does each section serve the concept, is the chosen approach followed as a complete method with nothing borrowed from another, does the copy sound like this particular business, would two sections look the same, can a builder implement each section without guessing',
          'A finding is "blocking" only if building the specification as written would give a wrong or generic site: a section that does not serve the concept, a borrowed technique, two sections that would look alike, copy that could be any business, a contradiction with no sensible reading, or a section with no real layout. Each blocking finding names the stage that owns it and exactly what must change',
          'Everything smaller is a "note", not blocking: where a small label goes, a detail the design system already settles, a wording slip, a value a competent builder would resolve from the rest of the specification. The builder reads your notes, so spell out how to resolve each. Do not send a stage back to polish it',
          'verdict "ready" if there are no blocking findings, even with notes. Otherwise verdict "changes"',
          shape('designReview'),
        ],
        verify: verify('review'),
      },
    ];
  },

  // Development starts only here, and only from a complete specification.
  BUILD: (project, brief, { dir, opts }) => {
    const r = readiness(dir);
    if (!r.ready) {
      throw new PermissionDenied('The design specification is not complete, so development cannot start', {
        hint: r.stages.flatMap((s) => s.problems.map((p) => `${s.label}: ${p}`)).join('\n'),
        details: r,
      });
    }
    if (!existsSync(join(dir, 'site', 'package.json'))) scaffoldSite(project, { actor: 'lead-developer', ...opts });
    const direction = readJson(join(dir, FILES.direction));
    const approaches = [direction.primaryApproach, ...direction.combination.map((c) => c.approach)];
    copyReference(dir, direction.primaryApproach);
    const specInputs = [...SPEC, FILES.review, 'design/reference/methodologies/**', 'design/reference/skill/**', 'content/copy.json'];
    const never = ['content/**', 'design/**', 'intake/**', 'research/**', 'site/src/content/**', 'site/dist/**', 'site/node_modules/**'];
    return [
      {
        ...base(project, 'build-foundation'),
        id: 'build-foundation',
        agent: 'builder',
        approach_modules: approaches,
        budget: { minutes: 30, retries: 1 },
        inputs: [...specInputs, 'site/src/layouts/**', 'site/src/components/**', 'site/src/styles/**', 'site/src/lib/**'],
        owns_files: ['site/src/layouts/**', 'site/src/components/**', 'site/src/styles/**', 'site/src/lib/**'],
        must_not_touch: never,
        acceptance: [
          'Turn design/design-system.json into the site\'s foundation: site/src/styles/ holds the system as custom properties and base type (secondary colour, hierarchy, spacing, grid, surfaces). tokens.json stays as it is',
          'Rewrite the Header and Footer to the direction, reading their text from site/src/copy.json (a copy of content/copy.json): nav, navCta, footer. The header behaves as the motion plan\'s navigation says, and the footer is a designed part of the site, not a copyright line',
          'Add site/src/lib/motion.js: the motion plan\'s shared behaviour for this approach, wired from data-motion attributes. Reduced motion shows every word, fully visible. Use the approach\'s recipes in site/src/lib/ when they fit',
          'Keep the starter\'s page routes and the skip link. Do not write page sections yet',
        ],
        verify: verify('foundation'),
      },
      {
        ...base(project, 'build-sections'),
        id: 'build-sections',
        agent: 'builder',
        approach_modules: approaches,
        depends_on: ['build-foundation'],
        budget: { minutes: 60, retries: 2 },
        inputs: [...specInputs, 'site/src/content/pages/**', 'site/src/styles/**', 'site/src/components/**', 'site/src/lib/**', 'site/public/**'],
        owns_files: ['site/src/sections/**', 'site/public/**', 'site/package.json'],
        must_not_touch: never,
        acceptance: [
          `For each section in design/section-plan.json, write its own component at site/src/sections/${direction.primaryApproach}/<PascalCaseOfTheSectionId>.astro. Pages already list them under use. Each component receives its copy as props (eyebrow, headline, subheadline, body, items, cta, note), plus page`,
          'design/review.json holds the Design Manager\'s notes on how to settle small gaps: follow them',
          'Implement the composition exactly as specified: the placement, overlap, scale, background and typography it names, at desktop, tablet and mobile. Use bespoke layout for each section, and use the design system\'s properties, never hard-coded colours or fonts',
          'Render every string of copy exactly as given, unbroken in the HTML, so it can be verified. Line-splitting for animation happens at runtime, in JavaScript',
          'Assets: client or licensed images come from /<file> under site/public/. Authored assets are made here as detailed inline SVG or CSS, as the plan describes; they must look finished. Give each planned asset\'s outermost element data-asset="<asset id>"',
          'Motion: for each motion id a section uses, put data-motion="<motion id>" on the element that moves or responds, and implement the behaviour through site/src/lib/motion.js. Hover motions need a real visible change on hover',
          'Keep to the primary approach. Do not import libraries from any other approach',
          'The verify command builds the site and renders it. Its output lists exactly what failed; fix that on the next attempt',
        ],
        verify: verify('site-build'),
      },
    ];
  },
};

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
  copyReference(dir);
  const have = new Set(listTasks(project, opts).map((t) => t.id));
  const added = [];
  for (const t of plan(project, brief, { dir, opts })) {
    if (have.has(t.id)) continue;
    added.push(addTask(project, t, opts));
  }
  if (added.length) ledger.append(project, { actor, type: 'note', data: { event: 'planned', phase: current, tasks: added.map((t) => t.id) } }, opts);
  return added;
}

export const PLANNED_PHASES = Object.keys(PLANS);

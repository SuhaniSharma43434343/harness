import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addTask, listTasks } from './board.mjs';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { ROOT, assertProjectExists } from './workspace.mjs';
import { FILES, readiness, sectionUse, stageById } from '../design/spec.mjs';
import { STUB_MARK } from '../qa/visual.mjs';
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
const SPEC_INPUTS = ['intake/brief.json', 'intake/material/**', 'research/positioning.json', 'research/crux.json', 'research/summary.md', SCHEMA];
const SPEC = ['design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json'];

// Each stage's contract. A contract states what good looks like, because it is the agent's brief.
const STAGE_TASKS = {
  research: (brief) => ({
    budget: { minutes: 25, retries: 1 },
    inputs: ['intake/brief.json', 'intake/facts.json', 'intake/material/**', SCHEMA],
    owns_files: ['research/summary.md', 'research/sources.json', 'research/positioning.json', 'research/crux.json'],
    must_not_touch: ['intake/**', 'content/**', 'site/**'],
    acceptance: [
      `research/summary.md describes ${brief.client.name}'s business, audience and goals, and what the site must do for them, in plain prose of at least a few paragraphs`,
      'Every claim in the summary names a source id from research/sources.json, or is marked "(assumption)"',
      'research/sources.json is {"sources": [{"id", "title", "kind", "ref"}]}; the brief and intake facts count as sources (kind "client", ref their path)',
      `research/positioning.json states the business, audience insights, objectives and this business's unique positioning. ${shape('positioning')}`,
      'research/crux.json sorts every fact about the business into five buckets: about (story, team, mission, values, promise; put first what nobody else can claim), whatWeDo (services, capabilities, process), ourWork (case studies, proof, metrics, client logos), resourceHub (tools, FAQs, guides, downloads) and reachUs (calls to action, contact points). Each item names its source id from research/sources.json, or "assumption"',
      'A bucket with nothing real in it stays empty and lists in "gaps" what is missing, as a question for the client. Never fill a bucket by inventing proof, people or figures',
      shape('crux'),
      'Use WebSearch and WebFetch to study at least two real competitors and three real, well-designed sites worth learning from. For each, say what specifically to learn: a layout, a type treatment, a way of telling the story. If the web is unavailable, say so in researchLimits and do not invent URLs',
      'Do not state a fact about the business that is not in the brief or client material',
      truthsLine(brief),
    ],
  }),

  direction: (brief) => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/approach-decision.json', 'design/reference/methodologies/**'],
    owns_files: ['design/direction.json', 'design/direction.md'],
    must_not_touch: ['intake/**', 'research/**', 'site/**', 'content/**'],
    acceptance: [
      'Read all eight methodologies. Pick exactly one primaryApproach from those design/approach-decision.json selects, and in "rejected" say why each of the others does not fit this brief',
      'Treat the approach as a complete method: interpret every one of its dimensions for this business, without importing techniques from another approach. "combination" stays empty unless the methodology\'s compatibleWith allows it and you can argue the story needs it',
      'Write a "concept": one sentence, specific to this business, that could not describe a competitor. Everything else must serve it',
      ...(brief?.truths?.length ? [`The concept rests on one of the facts only this business can claim (intake/brief.json truths): ${brief.truths.map((t) => `"${t.text}"`).join(', ')}. Say in whyThisApproach which one, and why`] : []),
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
      'Give each section (except a page\'s last) a transition: toNext says how it hands over to the section after it (a tone change, an overlap, a rule, a motion), and device notes any mobile difference',
      'Never state an operational fact the client did not give: no clock times, prices, durations or process steps beyond the client notes. Any you do use must already be a row in content/claims.json',
      'Give every section a funnel stage, so each page takes its visitor from awareness (the hook) through interest (how it works, the benefits) and desire (proof) to action (a low-friction call to action). The home page opens with awareness; every page with a journey ends on an action; a stage steps back only after a call to action. Use "none" for utility sections such as legal text',
      'Build each page from research/crux.json: a section draws on a bucket that has real facts. Where a bucket is empty, plan around its gap instead of a section that would need invented content',
      'Plan for each audience in intake/brief.json, not a generic visitor. Where an audience gives wants, proof and action, the pages it lands on answer what it wants, show the proof it needs, and end on its action. When audiences want different things, give each its own view: a dedicated page or path from the home page, or a section that switches between them',
      ...(brief.jobs?.length ? [`Every page gives a visitor these jobs in one tap: ${brief.jobs.map((j) => `"${j}"`).join(', ')}. Say on each page where each one sits: the header, a call to action that stays in view, or the footer`] : []),
      ...(brief.audience.some((a) => a.arrivesFrom?.length || a.mood) ? ['Where an audience says where it arrives from or its mood, plan the first screen it lands on for that: arriving from a social post or a QR code means a phone and a cold start; a worried visitor needs reassurance before a sales pitch'] : []),
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
      'A licensed stock photo may only illustrate a kind of work. Its alt text describes what it shows; it must never name this client, say "our" or "finished", or stand for one of the client\'s own jobs',
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
      'Write each section for its funnel stage in design/section-plan.json, using the facts sorted in research/crux.json. A gap stays a gap: no invented proof, testimonials or figures',
      'Where an audience in intake/brief.json names its action, the call to action that serves it uses that action in plain words',
      ...(brief.contentRules?.length ? [`Follow the brief's content rules. ${brief.contentRules.map((r) => `${r.rule === 'never' ? 'Never' : 'Always'} on ${r.pages.includes('*') ? 'every page' : r.pages.join(', ')}: "${r.text}"`).join('. ')}. The copy check refuses copy that breaks them; an "always" line may sit in the footer when it is on every page`] : []),
      'State only facts found in the brief, client material or research. Every number, year, time, price, duration, process step, guarantee or award goes in content/claims.json as {"claims": [{"text", "source"}]}, with a source id from research/sources.json — quote the source line as you write, not afterwards. If a section needs a fact you do not have (an ingredient, a method, an opening day), write around it rather than inventing it',
      shape('siteCopy'),
    ],
  }),
};

// The facts only this business can claim. The design rests on one of them; with fewer than three,
// research looks for more in the client material and lists the rest as questions for the client.
function truthsLine(brief) {
  const truths = brief.truths ?? [];
  const given = truths.length ? `The brief names what only this business can claim: ${truths.map((t) => `"${t.text}"`).join(', ')}. Put them first in the about bucket, with source "brief", and say in research/positioning.json which one the site rests on. ` : '';
  return truths.length >= 3 ? given.trim() : `${given}The brief gives ${truths.length ? `only ${truths.length}` : 'none'} of the three to six facts only this business can claim (about the place, people, material, history, method or a number). Find more in the client material; for what is still missing, add questions for the client to the about bucket's gaps`;
}

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
        'status is "cleared" only when the licence allows the use; anything else is "uncertain". Package rows already in the register keep their status: only the operator clears a licence the harness cannot verify',
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
          'Judge the CURRENT plan and the CURRENT copy together. Where they disagree with each other (the plan quotes or stages text the copy no longer contains, or vice versa), the finding goes against the stage that is out of date - usually section-plan - never against the build, and never by asking for removed text back',
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
    const plan = readJson(join(dir, FILES.sectionPlan));
    writeStubs(dir, direction.primaryApproach, plan);
    const never = ['content/**', 'design/**', 'intake/**', 'research/**', 'site/src/content/**', 'site/dist/**', 'site/node_modules/**'];
    return [
      {
        ...base(project, 'build-foundation'),
        id: 'build-foundation',
        agent: 'builder',
        approach_modules: approaches,
        budget: { minutes: 30, retries: 1 },
        inputs: [...specInputs, 'site/src/layouts/**', 'site/src/components/**', 'site/src/styles/**', 'site/src/lib/**', 'assets/public/**', 'assets/unsplash-photos.json'],
        owns_files: ['site/src/layouts/**', 'site/src/components/**', 'site/src/styles/**', 'site/src/lib/**', 'site/public/**', 'site/package.json'],
        must_not_touch: never,
        acceptance: [
          'Turn design/design-system.json into the site\'s foundation: site/src/styles/ holds the system as custom properties and base type (secondary colour, hierarchy, spacing, grid, surfaces). tokens.json stays as it is',
          'Rewrite the Header and Footer to the direction, reading their text from site/src/copy.json (a copy of content/copy.json): nav, navCta, footer. The header behaves as the motion plan\'s navigation says, and the footer is a designed part of the site, not a copyright line',
          'Add site/src/lib/motion.js: the motion plan\'s shared behaviour for this approach, wired from data-motion attributes. Reduced motion shows every word, fully visible. Use the approach\'s recipes in site/src/lib/ when they fit',
          'Keep the starter\'s page routes and the skip link. Do not write page sections: each page is built next, in parallel, by its own task, and none of them may edit these shared files, so put everything the pages share here',
          'Prepare site/public for every page: only the files design/asset-plan.json lists, and any image rendered under 300 px wide gets its own small file (a -thumb variant or sized copy). Add the packages the approaches need to site/package.json',
        ],
        verify: verify('foundation'),
      },
      // A section component used on several pages belongs to the first page that uses it, so no two
      // page tasks own the same file.
      ...plan.pages.map((pagePlan, i) => {
        const fileOf = (x) => `site/src/sections/${sectionUse(direction.primaryApproach, x.id)}.astro`;
        const earlier = new Set(plan.pages.slice(0, i).flatMap((p) => p.sections.map(fileOf)));
        const files = [...new Set(pagePlan.sections.map(fileOf))].filter((f) => !earlier.has(f));
        return {
          ...base(project, pageTaskId(pagePlan.slug)),
          id: pageTaskId(pagePlan.slug),
          agent: 'builder',
          approach_modules: approaches,
          depends_on: ['build-foundation'],
          budget: { minutes: 45, retries: 2 },
          inputs: [...specInputs, 'site/src/content/pages/**', 'site/src/styles/**', 'site/src/components/**', 'site/src/lib/**', 'site/public/**'],
          owns_files: files,
          must_not_touch: [...never, 'site/src/styles/**', 'site/src/components/**', 'site/src/lib/**', 'site/src/layouts/**', 'site/public/**', 'site/package.json'],
          acceptance: [
            `Build only the page ${pagePlan.slug}. Other pages are built at the same time by other tasks, so change no file outside these: ${files.join(', ')}`,
            `Each of those files is a placeholder now. Replace it with the real component for its section in design/section-plan.json. Each component receives its copy as props (headline, subheadline, body, items, cta, eyebrow, note, as in site/src/copy.json)`,
          'Implement the composition exactly as specified: the placement, overlap, scale, background and typography it names, at desktop, tablet and mobile. Use bespoke layout for each section, and use the design system\'s properties, never hard-coded colours or fonts',
          'Render every string of copy exactly as given, unbroken in the HTML, so it can be verified. Line-splitting for animation happens at runtime, in JavaScript',
          'Assets: client or licensed images come from /<file> under site/public/. Authored assets are made here as detailed inline SVG or CSS, as the plan describes; they must look finished. Give each planned asset\'s outermost element data-asset="<asset id>"',
          'Motion: for each motion id a section uses, put data-motion="<motion id>" on the element that moves or responds, and implement the behaviour through site/src/lib/motion.js. Hover motions need a real visible change on hover',
          'Keep to the primary approach. Do not import libraries from any other approach',
          'Keep it fast: the largest image in the first screen loads eagerly with fetchpriority="high" and the others lazily, every image has width and height, and JavaScript for motion loads after the first paint. The performance gate fails over 2.5 s LCP',
          'Hero images stay small: aim under 60 KB for the first-screen image; prefer a tighter crop or stronger compression over a heavier file',
          'The verify command builds the site and renders it. Its output lists exactly what failed; fix that on the next attempt',
            'If the shared foundation (styles, components, lib, site/public) lacks something this page needs, build what you can inside these files and say what is missing in your evidence; do not edit shared files',
          ],
          verify: `${verify('site-build')} --page ${q(pagePlan.slug)}`,
        };
      }),
    ];
  },
};

// One build task per page, so pages are built in parallel.
export const pageTaskId = (slug) => `build-page-${slug === '/' ? 'home' : slug.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`;

// A placeholder for every planned section that has no component yet, written by the harness at no
// model cost, so the whole site builds while page tasks are still running. The full build check
// refuses any placeholder that remains.
export function writeStubs(dir, approach, plan) {
  for (const page of plan?.pages ?? []) {
    for (const x of page.sections) {
      const file = join(dir, 'site', 'src', 'sections', `${sectionUse(approach, x.id)}.astro`);
      if (existsSync(file)) continue;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `---\nconst { headline = '' } = Astro.props;\n---\n<section ${STUB_MARK}="${x.id}"><h2>{headline}</h2></section>\n`);
    }
  }
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

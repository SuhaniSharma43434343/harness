import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addTask, listTasks } from './board.mjs';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { ROOT, assertProjectExists } from './workspace.mjs';
import { FILES, readiness, stageById } from '../design/spec.mjs';
import app03 from '../approaches/app03.mjs';
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
// The craft guide: how well the work must be done, judged the way Awwwards judges. Every design stage reads it.
export const CRAFT = 'design/reference/craft/**';
const CRAFT_FILE = 'design/reference/craft/awwwards.md';

const SPEC_INPUTS = ['intake/brief.json', 'intake/material/**', 'research/positioning.json', 'research/summary.md', SCHEMA];
const SPEC = ['design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json'];

// What this business needs from its site, as acceptance lines for the stages that decide the look
// and the words. Empty when the brief has no industry playbook (an older brief).
export function businessAcceptance(brief, stage) {
  const b = brief.business;
  const lines = [];
  const known = (b?.uniqueFacts ?? []).filter((f) => !/^\(not provided/.test(f));
  if (known.length && ['research', 'direction', 'section-plan', 'copy'].includes(stage)) {
    const use = stage === 'direction' ? 'The concept must rest on one of these facts' : stage === 'copy' ? 'Use them in the headlines and proof lines, and register each as a claim with the owner as its source' : 'Build on them';
    lines.push(`What is true here that no competitor can claim, from the owner: ${known.join('; ')}. ${use}`);
  }
  if ((b?.visitorSources?.length || b?.visitorDevice) && ['direction', 'section-plan'].includes(stage)) {
    lines.push(`Visitors arrive from: ${(b.visitorSources ?? []).join(', ') || 'unknown'}; device: ${b.visitorDevice ?? 'unknown'}. Design the first screen for that arrival`);
  }
  const legal = (b?.legalLines ?? []).filter((l) => !/^\(none/.test(l));
  if (legal.length && stage === 'copy') lines.push(`Legal lines the copy must carry or respect: ${legal.join('; ')}`);
  if (!b?.primaryConversion) return lines;
  const label = b.primaryConversion.label;
  if (stage === 'research') {
    lines.push(
      `This is a ${b.industryId} business, and the site exists to make one thing happen: "${label}". Study how the best sites in this industry lead a visitor to that action, and say what to learn from each`,
    );
  }
  if (stage === 'section-plan') {
    lines.push(
      `The business exists to make one thing happen: "${label}". The first section of the home page is the hero, and it must carry this action as its first and most prominent button, with the other hero items below, all visible without scrolling on a phone`,
      `The home hero must show: ${b.heroMustHave.join('; ')}`,
      'Every page ends with, or contains, a clear route to the primary action, and the header keeps it one tap away on a phone',
    );
    const req = Object.entries(b.requiredSections ?? {});
    if (req.length) lines.push(`Sections this business needs, which the plan must include on these pages: ${req.map(([slug, s]) => `${slug}: ${s.join('; ')}`).join(' | ')}`);
  }
  if (stage === 'copy') {
    lines.push(
      `The home hero's call to action label is exactly "${label}". Secondary hero actions: ${(b.secondaryConversions ?? []).filter((s) => s.hero).map((s) => `"${s.label}"`).join(', ') || 'none'}. Use these labels as written; do not reword them`,
      'Owner answers in the brief\'s business.details that read "(not provided by the client)" or "(none named)" are unknown. Write around them; never invent a value, name, time, price or number',
    );
    if (b.compliance?.length) lines.push(`Rules for this industry: ${b.compliance.join('; ')}`);
  }
  if (stage === 'review') {
    lines.push(
      `Judge as a business owner would: does the home hero lead with "${label}" and carry everything in business.heroMustHave, does every page route to it, and would a visitor in this industry find the answers they look for? A hero that buries the primary action is a blocking finding against the section plan`,
    );
  }
  return lines;
}

// What the operator chose in the media step (brief.media): a 3D object and a video, each with its place.
// Returned per stage so the plan, the asset list and the build all use the same files.
export function mediaAcceptance(brief, stage) {
  const t = brief.media?.threeD;
  const v = brief.media?.video;
  const lines = [];
  const mid = t?.decision === 'chosen' ? `model-${t.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : null;
  const vid = v?.decision === 'chosen' ? `video-${v.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : null;
  if (stage === 'direction') {
    if (mid) lines.push(`The operator chose a 3D object ("${t.title}", for the idea of ${t.concept}). Treat it as one accent section inside the chosen approach, not as a change of approach: the approach does not change, and the object lives in one section`);
    if (vid) lines.push(`The operator supplied a ${v.role} video. Let the direction say how it supports the concept`);
  }
  if (stage === 'section-plan') {
    if (mid) lines.push(`Plan exactly one section, ${t.position}, that features the 3D object. Its assets list contains "${mid}", its pattern is one the approach allows, and its purpose says what the object does for the business (a reason to linger, not decoration). It is never in the home hero, and the main action stays visible beside or after it. Mobile shows the poster image instead of the live scene when the phone is weak`);
    if (vid && v.role === 'hero-loop') lines.push(`The home hero (the first section) uses the video "${vid}" as a silent looping background behind a dark scrim. Put "${vid}" in that section's assets and say where the scrim sits and how the headline and the main button stay at 4.5:1 contrast`);
    if (vid && v.role === 'story-clip') lines.push(`Plan one section on ${v.page}, after the first section, that plays the clip "${vid}" when the visitor taps it (${v.section}). Put "${vid}" in its assets. It never sits in the hero and never autoplays with sound`);
  }
  if (stage === 'asset-plan') {
    if (mid) lines.push(`Include the asset "${mid}": kind "3d", source "licensed", file "${t.file}", licence "${t.licence}", alt text describing the object, and a second asset note for its poster ${t.poster ?? '(drawn from the model)'}`);
    if (vid) lines.push(`Include the asset "${vid}": kind "video", source "${v.source === 'Supplied by the client' ? 'client' : 'licensed'}", file "${v.mp4}" (with the WebM "${v.webm}" and the poster "${v.poster}"), licence "${v.licence}"`);
  }
  if (stage === 'copy' && mid) lines.push(`The 3D section's copy invites the visitor to turn the object ("${t.title}"). Do not claim anything about the real product it resembles`);
  if (stage === 'build') {
    if (mid) lines.push(`3D: use the Scene3D section the harness copied to site/src/sections/APP-03/Scene3D.astro with model="/${t.file}" and poster="/${t.poster ?? 'models/poster.png'}". It lazy-loads after the page has painted, shows the poster for reduced motion, a weak device, slow network, no WebGL or a load failure, and works with keyboard. Give its outer element data-asset="${mid}". The files are already in site/public/`);
    if (vid) lines.push(`Video: write a poster-first block for "${vid}": <video muted loop playsinline preload="none" poster="/${v.poster}"> with a WebM source (/${v.webm}) then an MP4 source (/${v.mp4}); the poster is the first paint, the video loads only after the page has loaded and when it is near the viewport, and it stays on the poster for prefers-reduced-motion, Save-Data and slow networks. A visible pause button. ${v.role === 'hero-loop' ? 'It sits behind a dark gradient scrim so the headline and button keep 4.5:1 contrast' : v.sound ? 'It plays on tap with controls; the sound plays only after the tap, never on its own, and a visible mute button is shown' : 'It plays on tap with controls and the sound off'}. Give the element data-asset="${vid}". The files are already in site/public/`);
  }
  return lines;
}

// What the craft guide asks of each stage, in one or two lines the agent cannot skim past.
const craftLines = (stage) =>
  ({
    direction: [`Read ${CRAFT_FILE}. The concept must be something a competitor could not claim, and the direction names what it borrows from outside web design (print, packaging, signage, film titles, maps) and which one signature moment each page will have`],
    'design-system': [`Read ${CRAFT_FILE}. Display type is at least 6 times the body size on desktop, one moment of type may be poster-scale, one dominant colour with one sharp accent, and the visual-language rules name at least one device that breaks the grid`],
    'section-plan': [
      `Read ${CRAFT_FILE}. The home hero is never a centred headline over a photo with two buttons: give it a composition with scale contrast and at least one overlapping, bleeding, offset or cropped element`,
      'In at least a third of all sections, say in the composition what overlaps, bleeds off the edge, is offset or is cropped. Each page has one signature moment, named in a section\'s purpose',
      'Length: the home page has at least 7 sections (5 on a small site), each inner page at least 4, and each section has a different job from its neighbours',
    ],
    'motion-plan': [`Read ${CRAFT_FILE}. Define at least 5 motions of at least 3 different kinds, one of them scroll-linked (kind "scroll" or "pin") and one the signature moment. Each has a job; do not fade-up every element. Say what reduced motion shows for each`],
    copy: [`Read ${CRAFT_FILE}. Headlines use the owner's own facts and say something only this business can say. Short sentences, plain English, no stock phrases`],
  })[stage] ?? [];

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
      ...businessAcceptance(brief, 'research'),
    ],
  }),

  direction: (brief) => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/approach-decision.json', 'design/reference/methodologies/**', CRAFT],
    owns_files: ['design/direction.json', 'design/direction.md'],
    must_not_touch: ['intake/**', 'research/**', 'site/**', 'content/**'],
    acceptance: [
      ...craftLines('direction'),
      ...mediaAcceptance(brief, 'direction'),
      'Read all eight methodologies. Pick exactly one primaryApproach from those design/approach-decision.json selects, and in "rejected" say why each of the others does not fit this brief',
      'Treat the approach as a complete method: interpret every one of its dimensions for this business, without importing techniques from another approach. "combination" stays empty unless the methodology\'s compatibleWith allows it and you can argue the story needs it',
      'Write a "concept": one sentence, specific to this business, that could not describe a competitor. Everything else must serve it',
      'design/direction.md is the same direction as prose for the other agents: the concept, the personality, what the site must feel like, and what it must never do',
      ...businessAcceptance(brief, 'direction'),
      shape('direction'),
    ],
  }),

  'design-system': () => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/direction.md', 'design/directions.json', 'design/reference/methodologies/**', CRAFT],
    owns_files: ['design/design-system.json'],
    must_not_touch: ['design/directions.json', 'design/direction.json', 'site/**', 'content/**'],
    acceptance: [
      'Use the direction chosen at B2 in design/directions.json without changing it: its primary, accent, bg, surface, fg and muted colours and its display and body fonts. Add a secondary colour and say where each colour may be used',
      'Give a type hierarchy with at least five levels, each with a real size (use clamp for display), weight and line height, following the approach\'s typography',
      'Define the spacing scale, section rhythm, grid (columns, gutter, max width and how sections break it), borders, shadows, radius and surface treatments',
      'State 3 or more rules of the visual language: the specific recurring devices that make this site recognisable',
      'Give separate desktop, tablet and mobile rules',
      ...craftLines('design-system'),
      shape('designSystem'),
    ],
  }),

  'section-plan': (brief) => ({
    budget: { minutes: 25, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/reference/methodologies/**', CRAFT],
    owns_files: ['design/section-plan.json'],
    must_not_touch: ['design/direction.json', 'design/design-system.json', 'site/**', 'content/**'],
    acceptance: [
      `Plan every section of every page: ${brief.pages.map((p) => `${p.slug} (${p.title}: ${p.purpose})`).join('; ')}`,
      'Section ids are unique across the site. For each section give its purpose, pattern (from the primary approach\'s layout.patterns, or give a patternReason), exact composition, visual hierarchy, background, typography, the asset ids and motion ids it uses, and desktop, tablet and mobile behaviour',
      'A composition is specific enough to draw: where things sit, what overlaps, how large, how the grid is broken. "A section with a heading and text" fails',
      ...craftLines('section-plan'),
      ...mediaAcceptance(brief, 'section-plan'),
      'Do not default to cards. At most a quarter of sections may be card or grid layouts; no three neighbours may share a pattern; use at least four patterns',
      'Give each section (except a page\'s last) a transition: toNext says how it hands over to the section after it (a tone change, an overlap, a rule, a motion), and device notes any mobile difference',
      'Never state an operational fact the client did not give: no clock times, prices, durations or process steps beyond the client notes. Any you do use must already be a row in content/claims.json',
      'Asset and motion ids you name here are defined next in design/asset-plan.json and design/motion-plan.json',
      ...businessAcceptance(brief, 'section-plan'),
      shape('sectionPlan'),
    ],
  }),

  'motion-plan': () => ({
    budget: { minutes: 15, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/section-plan.json', 'design/reference/methodologies/**', CRAFT],
    owns_files: ['design/motion-plan.json'],
    must_not_touch: ['design/section-plan.json', 'site/**', 'content/**'],
    acceptance: [
      'Define every motion id the section plan uses, and no others. Each has a kind (scroll, pin, hover, micro, transition, ambient), a trigger, a behaviour and a purpose: what it makes clearer',
      'Include at least one hover interaction, plus loading behaviour, navigation behaviour, page transitions and what reduced motion shows',
      'Keep to the primary approach\'s animation and scrolling. If its methodology requires pinning, include a pin; if it forbids pinning, do not',
      ...craftLines('motion-plan'),
      shape('motionPlan'),
    ],
  }),

  'asset-plan': (brief) => ({
    budget: { minutes: 15, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/direction.json', 'design/section-plan.json', 'assets/public/**', 'assets/unsplash-photos.json'],
    owns_files: ['design/asset-plan.json'],
    must_not_touch: ['design/section-plan.json', 'site/**', 'content/**', 'assets/**'],
    acceptance: [
      'Define every asset id the section plan uses, and no others: its kind, a description someone could act on, its source and its alt text',
      'source "client" or "licensed" must name an existing file under assets/public/ (the path relative to that folder) and its licence. Use files that are already there; you cannot download new ones',
      'A licensed stock photo may only illustrate a kind of work. Its alt text describes what it shows; it must never name this client, say "our" or "finished", or stand for one of the client\'s own jobs',
      'Where no real file exists, use source "authored": a detailed inline SVG illustration, CSS artwork or shader the builder will make. Describe it so it looks made on purpose, with layers and depth. Never plan a generic placeholder',
      ...mediaAcceptance(brief, 'asset-plan'),
      shape('assetPlan'),
    ],
  }),

  copy: (brief) => ({
    budget: { minutes: 30, retries: 1 },
    inputs: [...SPEC_INPUTS, 'research/sources.json', 'design/direction.md', 'design/section-plan.json', CRAFT],
    owns_files: ['content/copy.json', 'content/claims.json'],
    must_not_touch: ['site/**', 'intake/**', 'research/**', 'design/**', 'content/pages/**'],
    acceptance: [
      `Write the real copy for every section in design/section-plan.json, in plan order, for ${brief.client.name}: eyebrow, headline, subheadline, body paragraphs, items and call-to-action labels as the section needs. Also the brand story, voice, navigation and footer`,
      `Each brief page has its title, a description and its call to action: ${brief.pages.map((p) => `${p.slug} "${p.cta}"`).join(', ')}`,
      'A headline says something, in this business\'s own voice; "Our services" fails. Write the way a good copywriter writes for this approach (see the direction). Use specifics from the brief and client material. Avoid stock phrases and do not open headlines the same way',
      "A stock or licensed photo is never described as this client's own work: captions and alt text say what it shows, not which job it came from",
      'State only facts found in the brief, client material or research. Every number, year, time, price, duration, process step, guarantee or award goes in content/claims.json as {"claims": [{"text", "source"}]}, with a source id from research/sources.json — quote the source line as you write, not afterwards. If a section needs a fact you do not have (an ingredient, a method, an opening day), write around it rather than inventing it',
      ...craftLines('copy'),
      ...mediaAcceptance(brief, 'copy'),
      ...businessAcceptance(brief, 'copy'),
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
  mkdirSync(join(target, 'craft'), { recursive: true });
  cpSync(join(ROOT, 'registry', 'craft', 'awwwards.md'), join(target, 'craft', 'awwwards.md'));
  if (approach) {
    const skill = join(ROOT, 'skills', approach.toLowerCase().replace('-', ''));
    if (existsSync(skill)) cpSync(skill, join(target, 'skill'), { recursive: true });
  }
}

// Puts the chosen 3D model and video into the site: the Scene3D section for a model (the APP-03 recipes,
// used as an accent, not as the site's approach) and the files under site/public/.
function placeMedia(dir, brief) {
  const siteDir = join(dir, 'site');
  const copyTree = (rel) => {
    const from = join(dir, 'assets', 'public', rel);
    if (!existsSync(from)) return;
    mkdirSync(join(siteDir, 'public', dirname(rel)), { recursive: true });
    cpSync(from, join(siteDir, 'public', rel), { recursive: true });
  };
  const t = brief.media?.threeD;
  if (t?.decision === 'chosen') {
    if (!existsSync(join(siteDir, 'src', 'sections', 'APP-03', 'Scene3D.astro'))) app03.apply(siteDir, { projectDir: dir, install: false });
    copyTree(t.file);
    if (t.poster) copyTree(t.poster);
  }
  const v = brief.media?.video;
  if (v?.decision === 'chosen') for (const f of [v.mp4, v.webm, v.poster]) copyTree(f);
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
        inputs: [...SPEC_INPUTS, ...SPEC, 'design/directions.json', 'content/copy.json', 'design/reference/methodologies/**', CRAFT],
        owns_files: [FILES.review],
        must_not_touch: [...SPEC, 'content/**', 'site/**'],
        acceptance: [
          'Read the whole specification as one piece of work, and judge what a checker cannot: does each section serve the concept, is the chosen approach followed as a complete method with nothing borrowed from another, does the copy sound like this particular business, would two sections look the same, can a builder implement each section without guessing',
          'Judge the CURRENT plan and the CURRENT copy together. Where they disagree with each other (the plan quotes or stages text the copy no longer contains, or vice versa), the finding goes against the stage that is out of date - usually section-plan - never against the build, and never by asking for removed text back',
          'A finding is "blocking" only if building the specification as written would give a wrong or generic site: a section that does not serve the concept, a borrowed technique, two sections that would look alike, copy that could be any business, a contradiction with no sensible reading, or a section with no real layout. Each blocking finding names the stage that owns it and exactly what must change',
          'Everything smaller is a "note", not blocking: where a small label goes, a detail the design system already settles, a wording slip, a value a competent builder would resolve from the rest of the specification. The builder reads your notes, so spell out how to resolve each. Do not send a stage back to polish it',
          'verdict "ready" if there are no blocking findings, even with notes. Otherwise verdict "changes"',
          `Read ${CRAFT_FILE}. Score the specification 1 to 10 for Design, Usability, Creativity and Content as Awwwards would. A score under 7 on any is a blocking finding naming the stage that owns it and the exact change. A centred hero, equal cards and fade-up motion on everything is a 4`,
          ...businessAcceptance(brief, 'review'),
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
    placeMedia(dir, brief);
    const direction = readJson(join(dir, FILES.direction));
    const approaches = [direction.primaryApproach, ...direction.combination.map((c) => c.approach)];
    copyReference(dir, direction.primaryApproach);
    const specInputs = [...SPEC, FILES.review, 'design/reference/methodologies/**', 'design/reference/skill/**', CRAFT, 'content/copy.json'];
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
          'Keep to the primary approach. Do not import libraries from any other approach (the operator-chosen 3D accent below is the one exception: it uses the Scene3D section the harness already added)',
          ...mediaAcceptance(brief, 'build'),
          'Keep it fast: the largest image in the first screen loads eagerly with fetchpriority="high" and the others lazily, every image has width and height, and JavaScript for motion loads after the first paint. The performance gate fails over 2.5 s LCP',
          'Ship only what the pages reference: never copy the whole asset folder into site/public. Any image rendered under 300 px wide gets its own small file (a -thumb variant or sized copy), not the full-size original. Every file you add to site/public needs a row in assets/register.json',
          'Hero images stay small: aim under 60 KB for the first-screen image; prefer a tighter crop or stronger compression over a heavier file',
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

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addTask, listTasks } from './board.mjs';
import { withErrorRules } from './error-memory.mjs';
import { ConfigMissing, PermissionDenied } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { loadProject } from './project.mjs';
import { ROOT, assertProjectExists, writeJsonAtomic } from './workspace.mjs';
import { FILES, readiness, sectionUse, stageById, WORKFLOW_VERSION, workflowVersion } from '../design/spec.mjs';
import { STUB_MARK } from '../qa/visual.mjs';
import app03 from '../approaches/app03.mjs';
import { scaffoldSite } from '../site/scaffold.mjs';
import { atmosphereCss } from '../site/atmosphere.mjs';

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
const CRUX_SCHEMA = 'design/reference/crux.schema.json';

// The Truth Doc lines of the research contract (workflow 2): the facts every later stage is held to.
// The harness renders them as research/truth-doc.md, and the operator confirms them before visual work.
const TRUTH_DOC = [
  'research/positioning.json "onliness": the one thing only this business can claim ("Only we ... for ... who ..."), with its source. If the client has not said it, give a "gap": the question to ask them',
  'research/positioning.json "boundaries": what the product or service is ("whatItIs") and what it is not ("whatItIsNot"): the offers, places, people or promises the business does not make. Each line names its source, or "assumption"',
  'research/positioning.json "personas": one per audience in the brief, with the same segment name: what they want, what they need, and the one action the site asks of them ("desiredAction"), each sourced',
  'research/crux.json "buyerQuestions": the real questions buyers ask before they buy, at least one in each of the They Ask, You Answer Big 5: pricing (costs), problems (risks, what goes wrong), comparisons (against alternatives), reviews (what others say) and best (best-in-class guides), plus edge cases about the product. Each has the source where the business already answers it, or a "gap" saying what the client must tell us. Never answer one by inventing',
  'For each competitor in research/positioning.json, say what to learn from it ("learn") and what to avoid ("avoid"). Where a browser is available, describe what each site looks like ("visual": layout, type, imagery, navigation) and keep screenshots under research/screenshots/',
];
const shape = (name) => `The file must match the "${name}" definition in ${SCHEMA}`;
// The craft guide: how well the work must be done, judged the way Awwwards judges. Every design stage reads it.
export const CRAFT = 'design/reference/craft/**';
const CRAFT_FILE = 'design/reference/craft/awwwards.md';
const LIB = 'design/reference/craft/patterns.json';
const TECH = 'design/reference/craft/techniques.json';
const BENCH = 'design/reference/craft/benchmarks.json';

const SPEC_INPUTS = ['intake/brief.json', 'intake/material/**', 'research/positioning.json', 'research/crux.json', 'research/summary.md', SCHEMA];
const SPEC = ['design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json'];

// What this business needs from its site, as acceptance lines for the stages that decide the look
// and the words. Empty when the brief has no industry playbook (an older brief).
export function businessAcceptance(brief, stage) {
  const b = brief.business;
  const lines = [];
  const truths = (brief.truths ?? []).map((t) => t.text);
  if (truths.length && ['direction', 'copy'].includes(stage)) {
    lines.push(`What is true here that no competitor can claim, from the owner: ${truths.join('; ')}. ${stage === 'direction' ? 'The concept must rest on one of these facts' : 'Use them in the headlines and proof lines, and register each as a claim with the owner as its source'}`);
  }
  if ((b?.visitorSources?.length || b?.visitorDevice) && ['direction', 'section-plan'].includes(stage)) {
    lines.push(`Visitors arrive from: ${(b.visitorSources ?? []).join(', ') || 'unknown'}; device: ${b.visitorDevice ?? 'unknown'}. Design the first screen for that arrival`);
  }
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

// Workflow 2, visual style first and the six-step hierarchy: contract lines for the stages that lock
// the identity before copy, plan each page as a hierarchy, and tag every section's media.
const VISUAL_FIRST = {
  direction: [
    'Lock the identity now, before B2 and before any copy, in "identity": "logo" (how the logo or mark is integrated: placement, scale, how it meets the type and the grid; say if it is a temporary wordmark), "navigation" (the navigation bar\'s own style: shape, position, how it behaves on scroll and on a phone, never a plain row of links), "buttons" (shape, weight, how primary and secondary differ, what hover, press and focus do) and "signature" (the one move a visitor will remember). Each in a full sentence, specific to this industry: an auto-parts shop and a law firm must not get the same answer',
    'Avoid both machine-made extremes. Not decoration everywhere: purple-violet gradients, glass and soft shadows as the whole language, rounded cards everywhere. And not crude brutalism: square flat boxes, three flat colours, no depth, no light, 90s forms. A premium site has depth, light and texture that come from its concept',
    `Decide the art direction in "artDirection", read ${LIB} and ${TECH} first: "visualConcept" (the one visual idea, from this brand's world), "storytelling" (how the pages unfold as a story), "typography" (the hierarchy, the scale contrast and the one display moment), "layout" (the composition system: grid, asymmetry, overlap, negative space), "hero", "navigation" and "footer" (each an "archetype" id from the pattern library for its category, or "custom" with a "reason", and a "description" of what it looks like: placement, scale, layering), "transitions" (how sections hand over), "imageTreatment" (how photos are art-directed: duotone, mask, crop, frame, grain, light), "gallery", "background" ("effect" and "technique"), "shader" and "threeD" (each decided: "use" true or false, "why", and when used the "technique" id, "where" and its "fallback"), "icons" (style, stroke, size) and "microInteractions" (at least three, each with what it confirms)`,
    'The hero is never "headline left, photo right" and never "centred headline over a photo with two buttons" (the patterns split-headline-photo and centred-over-photo). Choose effects for the concept, not to look complicated, and keep them within the approach\'s script budget',
  ],
  'design-system': [
    'Build the identity as components in "components": "navigation" (style, desktop, mobile, scroll) and "buttons" (shape, primary, secondary, and states: hover, active, focus, and disabled if used). They follow design/direction.json identity; the shape says what makes these buttons this brand\'s',
    'Define the "atmosphere", all from the B2 colours and their tints: "surfaces" (base, raised, sunken, and "glass" with its fill, blur, border and its one "use"), "borders" (subtle, strong, glow), "radius" (sm, md, lg: a scale, not one value), "elevation" (low, mid, high CSS shadows, tinted with the palette, never pure black), "gradients" (up to three, each a mesh, radial, linear or conic gradient whose stops are B2 colours or mixes of them, with its use), "lighting" (where light falls: a radial glow behind the hero, a rim light on cards), "texture" (grain, noise, paper or none, with an opacity up to 0.2) and "motion" (easeOut, easeSpring, and fast, base and slow durations). Depth comes from at least two of elevation, light, layered surfaces and texture',
    'The harness writes the atmosphere as CSS custom properties (site/src/styles/atmosphere.css): --surface-1..3, --surface-glass, --glass-blur, --border-subtle, --border-glow, --gradient-<name>, --light-radial, --radius-sm|md|lg, --elevation-1..3, --ease-out, --dur-*. The builder styles the site with them',
  ],
  'section-plan': [
    'Give every page a "flow": "primary" for the home page and each landing or product page, "supporting" for pages that help a decision, "utility" for legal and practical text. Where the site has a path per visitor type (Residential or Commercial, Student or Parent), give each path\'s page its "audienceView" and plan the flow between them',
    'Every section names "hierarchyStep" and "contentBucket". A primary page runs all six steps in order: 1 what the product is and is not (from the boundaries in research/positioning.json), 2 what the visitor wants and needs (the personas), 3 the risk or cost of not acting, 4 the advantages, 5 why it is better than the alternatives (from the competitor research), 6 deep decision FAQs that lead into the call to action. A supporting page never steps back. Utility sections use "none"',
    'A section draws on a crux bucket that has facts. If its bucket is empty in research/crux.json, plan around the gap and say so in its purpose; never plan a section that would need invented content',
    'Every section names its "media": "photo", "video", "custom-authored" (SVG, CSS art or a shader made for the site), "x-factor-tool" (a calculator, audience switcher, comparison or deep FAQ the visitor uses) or "none". No floating orbs, blobs or random 3D: every visual has a job',
    `Describe how every section LOOKS in "visual", using ${LIB}: "archetype" (a pattern id, or "custom"), "focalPoint" (what the eye lands on first), "layers" (back: background effect or light; mid: imagery; front: type and controls), "imageTreatment", "interaction" (what hover, scroll or tap does), "transitionIn" (how it arrives) and "mobileComposition" (how it recomposes on a phone, not just stacks). Not "a product gallery with three cards" but, for example: an asymmetric gallery, one large featured product on the left two-thirds, two smaller supporting products stacked on the right, specifications floating over the featured image on a glass chip, a hover that lifts the image and shifts its light, a crossfade between products, and on a phone a swipeable row with the featured product first`,
    'Neighbouring sections never share an archetype, at most one section per page is a card or grid archetype, and the home hero uses the archetype design/direction.json artDirection.hero chose. Treat hero, navigation, products, gallery, testimonials, call to action, FAQ and footer each as a designed composition',
    'Plan the navigation and footer in "chrome": "navigation" and "footer", each with its "archetype" (the one the art direction chose), "composition", "mobile" and "behaviour" (on scroll, on open, on hover)',
  ],
  'asset-plan': [
    'Every section whose media is "photo" lists a photo asset, "video" a video, and "custom-authored" an svg, illustration, css-art, shader or frames asset. No 3D asset unless the media step chose one',
    'Every photo has a "treatment" that follows design/direction.json artDirection.imageTreatment: duotone in the palette, a mask or shaped crop, a frame, grain, a light leak. A stock photo with no treatment looks like stock',
  ],
  'motion-plan': [
    `A motion may name its "technique": a technique id from ${TECH} (for example gsap-scrolltrigger, motion-one, css-scroll-timeline, view-transitions, three-scene, spline-embed, glsl-shader, svg-draw). Together the named techniques stay within the approach's script budget; prefer CSS when it does the job. Every motion says what reduced motion shows`,
  ],
  copy: [
    'Write each section for its hierarchy step. Step 6 sections are deep decision FAQs: at least five real buyer questions from research/crux.json buyerQuestions (price, compatibility, edge cases), each answered in full in 25 words or more, then the call to action. An unanswered buyer question is not answered by guessing: leave it out and keep it as a gap',
  ],
};

// Workflow 2, the anti-slop gate: the Design Manager reads the plan, the copy and the media together
// before anything is built, against the Avoiding AI Slop checklist, and answers the five litmus questions.
const SLOP_REVIEW = [
  'Judge the plan, the copy (content/copy.json), the media prompts (design/media-prompts.json) and the media check (design/media-review.json) together, as one site, before any of it is built',
  'Each of these is a blocking finding against the stage that owns it: everything is a card; the same three-card section; repeated rounded rectangles; purple gradients; random floating orbs or decorative 3D; typography without personality; generic centred headings; cramped sections with no room to breathe; the same layout repeated across neighbouring sections; the same hero structure every project has (headline left with a photo right, or centred over a photo); random AI graphics; stock images with no visual concept; animation with no purpose; the same three-layer text stack in every section; generic headlines with no marketing voice; a hero with no memorable focal point or hook; no user flow between sections and pages; rounded corners, shadows and glass used everywhere; harsh brutalist boxes, three flat colours with no depth, light or texture, and crude 90s forms; more decoration than intention; a mobile layout that is only the desktop stacked',
  'Demand, and send back when missing: distinct section compositions; strong visual hierarchy; brand-specific storytelling; intentional negative space; premium imagery with a treatment; creative navigation and footer; meaningful interaction; one consistent art direction (design/direction.json artDirection and design/design-system.json atmosphere) carried into every section\'s "visual"',
  'Answer the six litmus questions in "litmus", each "yes" or "no" with a note: couldBeAnyCompany (could this site belong to any company?), worksWithoutDecoration (with the effects switched off, by reduced motion or no WebGL, do the structure and hierarchy still stand? This does not ask for a site without effects), artDirected (do depth, light, imagery and motion all come from one concept?), everySectionHasAReason (does every section have a clear reason to exist in the six-step hierarchy?), claimsRealAndSourced (are all claims real and sourced?), rhythmAndPointOfView (does the page have rhythm, hierarchy and a memorable point of view?). Any failing answer (yes to the first, no to the others) means verdict "changes", with a blocking finding naming the stage and the exact change',
];

const MEDIA_STAGES = {
  'media-prompts': () => ({
    budget: { minutes: 20, retries: 1 },
    inputs: [...SPEC_INPUTS, 'design/directions.json', 'design/direction.json', 'design/direction.md', 'design/design-system.json', 'design/section-plan.json', 'design/asset-plan.json', CRAFT],
    owns_files: ['design/media-prompts.json'],
    must_not_touch: ['design/direction.json', 'design/design-system.json', 'design/section-plan.json', 'design/asset-plan.json', 'content/**', 'site/**', 'intake/**', 'research/**'],
    acceptance: [
      'You write with the Creative Director\'s eye. Read the B2 direction (design/directions.json, the chosen one, and design/direction.md) and the design system first: every prompt is locked to that look',
      'design/media-prompts.json "styleLock" states the look every prompt shares: palette (the B2 colours by name), light, lens, grain and mood, in a sentence or two',
      'For every section whose media is "photo" or "video", write one prompt for each photo or video asset it uses: the subject, the place, the light, the composition and the crop, as this real business would be photographed, in 25 words or more. Give its "aspect" (such as 3:2) and, for a video, "durationSeconds"',
      'Each prompt has a "negative": AI artefacts, warped hands or text, plastic skin, uncanny faces, off-brand colours, stock-photo cliches. Never ask for orbs, blobs, purple light or decorative 3D, and never show the client\'s product, people or premises as if they were real photographs of them',
    ],
  }),
  'media-review': () => ({
    budget: { minutes: 15, retries: 1 },
    inputs: ['design/directions.json', 'design/direction.md', 'design/design-system.json', 'design/asset-plan.json', 'design/media-prompts.json', 'assets/public/**'],
    owns_files: ['design/media-review.json'],
    must_not_touch: ['design/asset-plan.json', 'design/media-prompts.json', 'content/**', 'site/**', 'assets/**'],
    acceptance: [
      'Open every photo and video file the asset plan uses (source "client" or "licensed", under assets/public/) with the Read tool and look at it. For a video, open its poster image or a frame extracted from it (an image beside it, or one you extract with ffmpeg into assets/public/), never the video file itself',
      'design/media-review.json has one item per file: the asset id, "inspected" (the image you opened, relative to the project folder), "verdict" pass or reject, and the "issues"',
      'Reject AI artefacts (warped hands, melted text, extra limbs), uncanny or plastic people, blurred or low-resolution files, images that are off the B2 palette and mood, and stock pictures that would pass as the client\'s own work. Say exactly what is wrong; a rejected file sends the asset plan back',
    ],
  }),
};

// Each stage's contract. A contract states what good looks like, because it is the agent's brief.
const STAGE_TASKS = {
  research: (brief) => ({
    budget: { minutes: 25, retries: 1 },
    inputs: ['intake/brief.json', 'intake/facts.json', 'intake/material/**', SCHEMA, CRUX_SCHEMA],
    owns_files: ['research/summary.md', 'research/sources.json', 'research/positioning.json', 'research/crux.json'],
    must_not_touch: ['intake/**', 'content/**', 'site/**'],
    acceptance: [
      `research/summary.md describes ${brief.client.name}'s business, audience and goals, and what the site must do for them, in plain prose of at least a few paragraphs`,
      'Every claim in the summary names a source id from research/sources.json, or is marked "(assumption)"',
      'research/sources.json is {"sources": [{"id", "title", "kind", "ref"}]}; the brief and intake facts count as sources (kind "client", ref their path)',
      `research/positioning.json states the business, audience insights, objectives and this business's unique positioning. ${shape('positioning')}`,
      'research/crux.json sorts every fact about the business into five buckets: about (story, team, mission, values, promise; put first what nobody else can claim), whatWeDo (services, capabilities, process), ourWork (case studies, proof, metrics, client logos), resourceHub (tools, FAQs, guides, downloads) and reachUs (calls to action, contact points). Each item names its source id from research/sources.json, or "assumption"',
      'A bucket with nothing real in it stays empty and lists in "gaps" what is missing, as a question for the client. Never fill a bucket by inventing proof, people or figures',
      `research/crux.json matches ${CRUX_SCHEMA}`,
      ...TRUTH_DOC,
      'Use WebSearch and WebFetch to study at least two real competitors and three real, well-designed sites worth learning from. For each, say what specifically to learn: a layout, a type treatment, a way of telling the story. If the web is unavailable, say so in researchLimits and do not invent URLs',
      'Do not state a fact about the business that is not in the brief or client material',
      ...businessAcceptance(brief, 'research'),
      truthsLine(brief),
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
      ...(brief?.truths?.length ? [`The concept rests on one of the facts only this business can claim (intake/brief.json truths): ${brief.truths.map((t) => `"${t.text}"`).join(', ')}. Say in whyThisApproach which one, and why`] : []),
      'design/direction.md is the same direction as prose for the other agents: the concept, the personality, what the site must feel like, and what it must never do',
      ...businessAcceptance(brief, 'direction'),
      ...VISUAL_FIRST['direction'],
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
      ...VISUAL_FIRST['design-system'],
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
      'Give every section a funnel stage, so each page takes its visitor from awareness (the hook) through interest (how it works, the benefits) and desire (proof) to action (a low-friction call to action). The home page opens with awareness; every page with a journey ends on an action; a stage steps back only after a call to action. Use "none" for utility sections such as legal text',
      'Build each page from research/crux.json: a section draws on a bucket that has real facts. Where a bucket is empty, plan around its gap instead of a section that would need invented content',
      'Plan for each audience in intake/brief.json, not a generic visitor. Where an audience gives wants, proof and action, the pages it lands on answer what it wants, show the proof it needs, and end on its action. When audiences want different things, give each its own view: a dedicated page or path from the home page, or a section that switches between them',
      ...(brief.jobs?.length ? [`Every page gives a visitor these jobs in one tap: ${brief.jobs.map((j) => `"${j}"`).join(', ')}. Say on each page where each one sits: the header, a call to action that stays in view, or the footer`] : []),
      ...(brief.audience.some((a) => a.arrivesFrom?.length || a.mood) ? ['Where an audience says where it arrives from or its mood, plan the first screen it lands on for that: arriving from a social post or a QR code means a phone and a cold start; a worried visitor needs reassurance before a sales pitch'] : []),
      'Asset and motion ids you name here are defined next in design/asset-plan.json and design/motion-plan.json',
      ...businessAcceptance(brief, 'section-plan'),
      ...VISUAL_FIRST['section-plan'],
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
      ...VISUAL_FIRST['motion-plan'],
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
      ...VISUAL_FIRST['asset-plan'],
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
      'Write each section for its funnel stage in design/section-plan.json, using the facts sorted in research/crux.json. A gap stays a gap: no invented proof, testimonials or figures',
      'Where an audience in intake/brief.json names its action, the call to action that serves it uses that action in plain words',
      ...(brief.contentRules?.length ? [`Follow the brief's content rules. ${brief.contentRules.map((r) => `${r.rule === 'never' ? 'Never' : 'Always'} on ${r.pages.includes('*') ? (r.rule === 'never' ? 'any page' : 'every page') : r.pages.join(', ')}: "${r.text}"`).join('. ')}. The copy check refuses copy that breaks them; an "always" line may sit in the footer when it is on every page`] : []),
      'State only facts found in the brief, client material or research. Every number, year, time, price, duration, process step, guarantee or award goes in content/claims.json as {"claims": [{"text", "source"}]}, with a source id from research/sources.json — quote the source line as you write, not afterwards. If a section needs a fact you do not have (an ingredient, a method, an opening day), write around it rather than inventing it',
      ...craftLines('copy'),
      ...mediaAcceptance(brief, 'copy'),
      ...businessAcceptance(brief, 'copy'),
      ...VISUAL_FIRST['copy'],
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
// A fix keeps what is right in the file. A fresh fix rewrites it: the file was written for an earlier
// direction (the approach changed, or the operator asked), so patching it keeps the wrong plan.
const KEEP = 'Keep what is already right in the file, and change only what these findings need';
const FRESH = 'Rewrite this file from scratch for the current design/direction.json and its approach. The file on disk was written for an earlier direction: keep nothing from it unless a finding above says so, and check every line against the current direction, section plan and approach';
export function specTask(project, stageId, brief, { fix, problems = [], fresh = false } = {}) {
  const stage = stageById(stageId);
  const id = fix ? `${stage.task}-fix-${fix}` : stage.task;
  const t = (STAGE_TASKS[stageId] ?? MEDIA_STAGES[stageId])(brief);
  return {
    ...base(project, id),
    id,
    agent: stage.agent,
    ...t,
    acceptance: fix ? [...problems.map((p) => `Fix: ${p}`), fresh ? FRESH : KEEP, ...t.acceptance] : t.acceptance,
    verify: verify(stageId),
  };
}

// Makes the methodologies and schema readable by a worker, which stays inside the project folder.
function copyReference(dir, approach) {
  const target = join(dir, 'design', 'reference');
  mkdirSync(target, { recursive: true });
  cpSync(join(ROOT, 'schemas', 'design-spec.schema.json'), join(target, 'design-spec.schema.json'));
  cpSync(join(ROOT, 'schemas', 'crux.schema.json'), join(target, 'crux.schema.json'));
  cpSync(join(ROOT, 'registry', 'methodologies'), join(target, 'methodologies'), { recursive: true });
  mkdirSync(join(target, 'craft'), { recursive: true });
  for (const f of ['awwwards.md', 'patterns.json', 'techniques.json', 'benchmarks.json']) cpSync(join(ROOT, 'registry', 'craft', f), join(target, 'craft', f));
  if (approach) {
    const skill = join(ROOT, 'skills', approach.toLowerCase().replace('-', ''));
    if (existsSync(skill)) cpSync(skill, join(target, 'skill'), { recursive: true });
  }
}

// Workflow 2: the design system's atmosphere becomes site/src/styles/atmosphere.css, replacing the
// starter's neutral defaults, before the foundation is built.
function writeAtmosphere(dir) {
  const system = existsSync(join(dir, FILES.designSystem)) ? readJson(join(dir, FILES.designSystem)) : null;
  if (workflowVersion(dir) < 2 || !system?.atmosphere) return;
  mkdirSync(join(dir, 'site', 'src', 'styles'), { recursive: true });
  writeFileSync(join(dir, 'site', 'src', 'styles', 'atmosphere.css'), atmosphereCss(system.atmosphere));
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

// Track 4A (copy) and Track 4B (media prompts) start together once the section and asset plans are done.
const AFTER_PLANS = ['section-plan', 'asset-plan'];

// The licence register needs only the asset plan, which is finished before the copy, so it runs
// alongside the copy task and while the operator reviews the copy at B3. The asset phase then
// has nothing left to wait for.
const assetRegister = (project) => (
    {
      ...base(project, 'asset-register'),
      id: 'asset-register',
      agent: 'asset-rights',
      inputs: ['intake/brief.json', 'design/directions.json', 'design/asset-plan.json', 'assets/public/**', 'assets/unsplash-photos.json'],
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
    }
);

const PLANS = {
  RESEARCH: stageTask('research'),
  // Workflow 2: the direction waits for the operator's approach choice, and is held to it.
  APPROACH_SELECTION: (project, brief, { dir }) => {
    if (workflowVersion(dir) < 2) return [specTask(project, 'direction', brief)];
    const choice = existsSync(join(dir, FILES.approachChoice)) ? readJson(join(dir, FILES.approachChoice)) : null;
    if (!choice) return [];
    const t = specTask(project, 'direction', brief);
    return [{ ...t, inputs: [...t.inputs, FILES.approachChoice], acceptance: [`The operator chose ${choice.approach} (${choice.name}) at the approach pause: "${choice.note}". It is the primaryApproach; interpret it as a complete method, and say why the others were not chosen`, ...t.acceptance] }];
  },

  UX_DESIGN_SYSTEM: (project, brief) => {
    const tasks = ['design-system', 'section-plan', 'motion-plan', 'asset-plan'].map((s) => specTask(project, s, brief));
    tasks[1].depends_on = ['design-system'];
    tasks[2].depends_on = ['section-plan'];
    tasks[3].depends_on = ['section-plan'];
    return tasks;
  },

  CONTENT: (project, brief, { dir }) => {
    if (workflowVersion(dir) < 2) return [specTask(project, 'copy', brief), assetRegister(project)];
    return [{ ...specTask(project, 'copy', brief), depends_on: AFTER_PLANS }, { ...specTask(project, 'media-prompts', brief), depends_on: AFTER_PLANS }, assetRegister(project)];
  },

  ASSETS_LICENSING: (project, brief, { dir }) => [assetRegister(project), ...(workflowVersion(dir) >= 2 ? [specTask(project, 'media-review', brief)] : [])],

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
        inputs: [...SPEC_INPUTS, ...SPEC, 'design/directions.json', 'content/copy.json', 'design/reference/methodologies/**', CRAFT, ...(workflowVersion(dir) >= 2 ? [FILES.mediaPrompts, FILES.mediaReview] : [])],
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
          ...(workflowVersion(dir) >= 2 ? SLOP_REVIEW : []),
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
    writeAtmosphere(dir);
    const direction = readJson(join(dir, FILES.direction));
    const approaches = [direction.primaryApproach, ...direction.combination.map((c) => c.approach)];
    copyReference(dir, direction.primaryApproach);
    const specInputs = [...SPEC, FILES.review, 'design/reference/methodologies/**', 'design/reference/skill/**', CRAFT, 'content/copy.json'];
    const plan = readJson(join(dir, FILES.sectionPlan));
    writeStubs(dir, direction.primaryApproach, plan);
    const siteFile = join(dir, 'site', 'src', 'site.json');
    const siteForms = Object.entries((existsSync(siteFile) ? readJson(siteFile) : null)?.forms ?? {});
    const never = ['content/**', 'design/**', 'intake/**', 'research/**', 'site/src/content/**', 'site/dist/**', 'site/node_modules/**'];
    return rebuildStale(project, [
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
          'Under workflow 2, build the Header as design/section-plan.json chrome.navigation and the Footer as chrome.footer describe, and mark each outer element with data-archetype="<its archetype>". Keep site/src/styles/atmosphere.css as the harness wrote it and style buttons, surfaces, cards and panels with its variables (radius, elevation, glass, glow, gradients, light, grain) and the utilities in global.css (.surface-raised, .glass, .glow-border, .mesh-bg, .radial-light, .grain, .lift). The primary button\'s radius and depth are design-system components.buttons; do not flatten or square what the system did not',
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
          'Under workflow 2, build each section as its "visual" says: the archetype, the focal point, the three layers (background effect or light, imagery, type and controls), the image treatment, the interaction, the entrance and the phone composition. Give each section\'s outer element data-archetype="<visual.archetype>". Nothing may cover a heading or a line of body text. If a planned effect cannot be built within the budget, use its fallback and say so in your report; never drop it silently',
          'Render every string of copy exactly as given, unbroken in the HTML, so it can be verified. Line-splitting for animation happens at runtime, in JavaScript',
          'Assets: client or licensed images come from /<file> under site/public/. Authored assets are made here as detailed inline SVG or CSS, as the plan describes; they must look finished. Give each planned asset\'s outermost element data-asset="<asset id>"',
          'Motion: for each motion id a section uses, put data-motion="<motion id>" on the element that moves or responds, and implement the behaviour through site/src/lib/motion.js. Hover motions need a real visible change on hover',
          'Keep to the primary approach. Do not import libraries from any other approach (the operator-chosen 3D accent below is the one exception: it uses the Scene3D section the harness already added)',
          ...mediaAcceptance(brief, 'build'),
          'Keep it fast: the largest image in the first screen loads eagerly with fetchpriority="high" and the others lazily, every image has width and height, and JavaScript for motion loads after the first paint. The performance gate fails over 2.5 s LCP',
          'Hero images stay small: aim under 60 KB for the first-screen image; prefer a tighter crop or stronger compression over a heavier file',
          'The verify command builds the site and renders it. Its output lists exactly what failed; fix that on the next attempt',
            'If the shared foundation (styles, components, lib, site/public) lacks something this page needs, build what you can inside these files and say what is missing in your evidence; do not edit shared files',
            ...formContract(siteForms),
          ],
          verify: `${verify('site-build')} --page ${q(pagePlan.slug)}`,
        };
      }),
    ], opts);
  },
};

// A build task finished before the specification last changed (a stage sent back, a new approach,
// a new B2 or B3) built an older design, so it is planned again as a rebuild: a fix task of the same
// task, told to replace the earlier work. Without this the board's finished tasks keep their ids and
// the new design is never built. Page rebuilds wait for the foundation's rebuild.
function rebuildStale(project, tasks, opts) {
  const events = ledger.read(project, opts);
  const changes = events.filter((e) => (e.type === 'note' && ['design_returned', 'approach_chosen'].includes(e.data?.event)) || (e.type === 'approval' && ['B2', 'B3'].includes(e.data?.approval))).map((e) => e.seq);
  if (!changes.length) return tasks;
  const lastChange = Math.max(...changes);
  const board = listTasks(project, opts);
  const family = (id) => board.filter((t) => t.id === id || t.id.startsWith(`${id}-fix-`));
  const doneAt = (id) => Math.max(-1, ...events.filter((e) => e.type === 'task_status' && e.data?.to === 'done' && (e.data.task === id || e.data.task.startsWith(`${id}-fix-`))).map((e) => e.seq));
  const renamed = new Map();
  const out = tasks.map((t) => {
    const at = doneAt(t.id);
    if (at < 0 || at > lastChange) return t;
    const n = Math.max(0, ...family(t.id).map((x) => Number(/-fix-(\d+)$/.exec(x.id)?.[1] ?? 0))) + 1;
    const id = `${t.id}-fix-${n}`;
    renamed.set(t.id, id);
    return { ...t, id, idempotency_key: `${project}:${id}:v1`, acceptance: ['Rebuild: the specification changed after this was built (a new direction, plans or copy). Build it again from the current files, replacing the earlier work; nothing from the earlier build is approved', ...t.acceptance] };
  });
  return out.map((t) => ({ ...t, depends_on: t.depends_on.map((d) => renamed.get(d) ?? d) }));
}

// How to build a form, for every page of a site that has forms. The page a form sits on is the
// section plan's call (site.json's page is only the starter's first guess), so each page task
// gets the contract and applies it to any section that collects input. The address is never
// invented: it is site.json's action, or the form plugin's endpoint (installed at deploy; the
// forms gate tests the form against a stand-in for it). A form never claims what it did not send.
export const formAction = (id) => `/api/form?form=${encodeURIComponent(id)}`;
function formContract(forms) {
  if (!forms.length) return [];
  const list = forms.map(([id, f]) => `"${id}" (${f.purpose}; action ${f.action ? `"${f.action}"` : `"${formAction(id)}", the form plugin's endpoint, because the brief has no destination yet`})`).join(', ');
  return [`Forms: a section on this page that collects input is one of the site's forms in site/src/site.json: ${list}. Build it from its entry there, keeping data-forge-form="<its id>", its fields, required marks and a .form-status element (site/src/sections/APP-01/Form.astro shows the behaviour). Use exactly that action; never invent another address or post to the page's own URL. Submit with fetch POST: an empty required field is stopped before sending, a 2xx answer shows the success state, anything else shows the error state. Never show success without sending`];
}

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
    // A project whose research is planned now follows the current workflow's rules from here on.
    if (t.id === 'research') writeJsonAtomic(join(dir, FILES.workflow), { version: WORKFLOW_VERSION, plannedAt: new Date().toISOString() });
    added.push(addTask(project, withErrorRules(project, t, opts), opts));
  }
  if (added.length) ledger.append(project, { actor, type: 'note', data: { event: 'planned', phase: current, tasks: added.map((t) => t.id) } }, opts);
  return added;
}

export const PLANNED_PHASES = Object.keys(PLANS);

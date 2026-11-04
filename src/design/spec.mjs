import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { check } from '../core/schemas.mjs';
import { isClaim } from '../gates/claims.mjs';
import { ROOT } from '../core/workspace.mjs';
import { toMarkdown, pageFile } from '../site/content.mjs';
import { tokensFromDirection } from '../site/tokens.mjs';

// The design specification: the files that must exist, complete and consistent, before anyone
// writes site code. Each stage has one check that returns a list of problems in plain words. The
// schema covers shape; these checks cover what a schema cannot: real content, cross-file
// references, one approach followed as a whole, and generic output.

const read = (dir, file) => {
  const path = join(dir, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

export const FILES = {
  positioning: 'research/positioning.json',
  decision: 'design/approach-decision.json',
  directions: 'design/directions.json',
  direction: 'design/direction.json',
  designSystem: 'design/design-system.json',
  sectionPlan: 'design/section-plan.json',
  motionPlan: 'design/motion-plan.json',
  assetPlan: 'design/asset-plan.json',
  copy: 'content/copy.json',
  review: 'design/review.json',
  brief: 'intake/brief.json',
};

export function loadMethodology(id) {
  return JSON.parse(readFileSync(join(ROOT, 'registry', 'methodologies', `${id}.json`), 'utf8'));
}

export const loadMethodologies = () =>
  readdirSync(join(ROOT, 'registry', 'methodologies'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'registry', 'methodologies', f), 'utf8')));

// Loads one file for a check: returns [data, problems], where a missing or invalid file is a problem.
function load(dir, key, schema) {
  const file = FILES[key];
  const data = read(dir, file);
  if (data === null) return [null, [`${file} is missing`]];
  if (data === undefined) return [null, [`${file} is not valid JSON`]];
  if (!schema) return [data, []];
  const r = check(schema, data);
  return [r.valid ? data : null, r.errors.map((e) => `${file}: ${e}`)];
}

// The phrases that mark copy as machine filler. Matching whole sentences would miss most of it,
// so this lists the stock openings and buzzwords a human editor would strike.
const GENERIC_COPY = [
  /\bunlock (your|the)\b/i,
  /\belevate your\b/i,
  /\bseamless(ly)?\b/i,
  /\bin today'?s\b/i,
  /\bwe are passionate\b/i,
  /\bwelcome to\b/i,
  /\bone-stop\b/i,
  /\bcutting[- ]edge\b/i,
  /\bworld[- ]class\b/i,
  /\bnext[- ]level\b/i,
  /\btailored solutions?\b/i,
  /\byour trusted partner\b/i,
  /\bgame[- ]chang/i,
  /\bwhy choose us\b/i,
  /\bour services\b$/i,
  /\babout us\b$/i,
  /\bget started today\b/i,
  /\blorem ipsum\b/i,
  /\[(insert|add|your)[^\]]*\]/i,
  /\b(todo|tbd|placeholder|coming soon)\b/i,
];
// Section headlines that only label the section and say nothing.
const LABEL_HEADLINE = /^(services|our services|about|about us|features|our work|projects|gallery|testimonials|reviews|faq|faqs|contact|contact us|hero|why us|why choose us|how it works|get in touch)$/i;

const CARD_PATTERNS = /card|grid|tile/;
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

// The operational-fact patterns a section plan may not invent: clock times, am/pm hours, prices
// and durations. Deliberately narrower than the claims gate, so layout numbers (a 3:2 crop,
// 8.5rem, 6% grain, 16:9) never match.
const OPERATIONAL = [
  /\b\d{1,2}:[0-5]\d(?:\s*(?:am|pm))?\b/gi,
  /(?<![:\d])\b\d{1,2}\s*(?:am|pm)\b/gi,
  /(?:₹|\brs\.?\s?)\s?\d(?:[\d,.]*\d)?/gi,
  /\b\d[\d,.]*\s*(?:minutes?|mins?|hours?|days?|weeks?|months?|years?)\b/gi,
];
export function operationalClaims(section) {
  const text = [section.purpose, section.composition, section.hierarchy].join(' ');
  const hits = [];
  for (const re of OPERATIONAL) for (const m of text.matchAll(re)) hits.push(m[0].trim());
  return [...new Set(hits)];
}

export function copyStrings(section) {
  const out = [];
  for (const key of ['eyebrow', 'headline', 'subheadline', 'note']) if (section[key]) out.push(section[key]);
  for (const b of section.body ?? []) out.push(b);
  for (const it of section.items ?? []) out.push(...[it.title, it.text, it.meta].filter(Boolean));
  if (section.cta?.label) out.push(section.cta.label);
  return out;
}

const normaliseText = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const pascal = (id) => id.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
export const sectionUse = (approach, id) => `${approach}/${pascal(id)}`;
export const pagesOf = (plan) => plan?.pages ?? [];
export const sectionsOf = (plan) => pagesOf(plan).flatMap((p) => p.sections.map((s) => ({ ...s, slug: p.slug })));

export const CHECKS = {
  research(dir) {
    const [p, problems] = load(dir, 'positioning', 'positioning');
    if (!p) return problems;
    if (p.differentiators.length < 2) problems.push('research/positioning.json: name at least two real differentiators');
    if (!p.researchLimits) {
      if (p.references.length < 3) problems.push('research/positioning.json: list at least three design references with URLs, or say in researchLimits why that was not possible');
      if (p.competitors.length < 2) problems.push('research/positioning.json: list at least two competitors, or say in researchLimits why that was not possible');
    }
    for (const r of p.references) if (!/^https?:\/\//.test(r.url)) problems.push(`research/positioning.json: reference "${r.name}" needs a full URL`);
    if (GENERIC_COPY.some((g) => g.test(p.positioning))) problems.push('research/positioning.json: the positioning uses stock phrases; say what is actually different about this business');
    return problems;
  },

  direction(dir) {
    const [d, problems] = load(dir, 'direction', 'designDirection');
    if (!d) return problems;
    const [decision] = load(dir, 'decision');
    const selected = new Set((decision?.decisions ?? []).filter((x) => x.selected).map((x) => x.approach));
    if (!decision) problems.push('design/approach-decision.json is missing');
    else if (!selected.has(d.primaryApproach)) problems.push(`${d.primaryApproach} is not selected for this brief; choose from ${[...selected].join(', ')}`);
    const method = loadMethodology(d.primaryApproach);
    const rejected = new Set(d.rejected.map((r) => r.approach));
    const combined = new Set(d.combination.map((c) => c.approach));
    for (const m of loadMethodologies()) {
      if (m.id !== d.primaryApproach && !rejected.has(m.id) && !combined.has(m.id)) problems.push(`design/direction.json: say why ${m.id} was rejected, so all 8 approaches are analysed`);
    }
    for (const c of d.combination) {
      if (!method.compatibleWith.some((x) => x.approach === c.approach)) problems.push(`design/direction.json: ${d.primaryApproach} does not combine with ${c.approach} (see registry/methodologies/${d.primaryApproach}.json)`);
      if (decision && !selected.has(c.approach)) problems.push(`design/direction.json: ${c.approach} is not selected for this brief, so it cannot be combined`);
    }
    if (d.interpretation.philosophy.trim() === method.philosophy.trim()) problems.push('design/direction.json: the philosophy repeats the methodology word for word; interpret it for this business');
    if (words(d.concept) < 8) problems.push('design/direction.json: the concept must be a real idea in a full sentence');
    return problems;
  },

  'design-system'(dir) {
    const [s, problems] = load(dir, 'designSystem', 'designSystem');
    if (!s) return problems;
    const decision = read(dir, FILES.directions);
    const chosen = decision?.status === 'chosen' ? decision.directions.find((x) => x.id === decision.chosen) : null;
    if (!chosen) return [...problems, 'design/directions.json has no chosen direction (B2)'];
    const tokens = tokensFromDirection(chosen);
    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    for (const [role, token] of [['primary', 'primary'], ['accent', 'accent'], ['background', 'bg'], ['surface', 'surface'], ['text', 'fg'], ['muted', 'muted']]) {
      if (!same(s.color[role], tokens.color[token])) problems.push(`design/design-system.json: color.${role} must be the B2 token ${tokens.color[token]}, not ${s.color[role]}`);
    }
    if (!s.typography.display.includes(tokens.font.display.family)) problems.push(`design/design-system.json: the display face must be the B2 choice, ${tokens.font.display.family}`);
    if (!s.typography.body.includes(tokens.font.body.family)) problems.push(`design/design-system.json: the body face must be the B2 choice, ${tokens.font.body.family}`);
    if (s.visualLanguage.length < 3) problems.push('design/design-system.json: describe at least three rules of the visual language');
    if (same(s.responsive.desktop, s.responsive.mobile)) problems.push('design/design-system.json: mobile rules must differ from desktop rules');
    return problems;
  },

  'section-plan'(dir) {
    const [plan, problems] = load(dir, 'sectionPlan', 'sectionPlan');
    if (!plan) return problems;
    const [brief] = load(dir, 'brief');
    const [direction] = load(dir, 'direction', 'designDirection');
    const [motion] = load(dir, 'motionPlan');
    const [assets] = load(dir, 'assetPlan');
    // Operational specifics in a plan (clock times, prices, durations) end up on the page, so they
    // are claims and need a registered source like any other. Layout numbers (3:2 crops, rem sizes,
    // percentages) are not matched. This is the write-time firewall for the invented-times class.
    const registered = (read(dir, 'content/claims.json')?.claims ?? []).map((x) => normaliseText(x.text));
    const coveredClaim = (said) => registered.some((r) => said.includes(r) || r.includes(said));
    const method = direction ? loadMethodology(direction.primaryApproach) : null;
    const slugs = new Set(pagesOf(plan).map((p) => p.slug));
    for (const p of brief?.pages ?? []) if (!slugs.has(p.slug)) problems.push(`design/section-plan.json: page ${p.slug} has no sections`);
    // A made-up page would be published. The header and footer belong to the design system.
    for (const slug of slugs) if (brief && !brief.pages.some((p) => p.slug === slug)) problems.push(`design/section-plan.json: ${slug} is not a page in the brief; only plan the brief's pages`);
    const seen = new Set();
    for (const page of pagesOf(plan)) {
      let run = 0;
      let last = null;
      for (const s of page.sections) {
        if (seen.has(s.id)) problems.push(`design/section-plan.json: section id ${s.id} is used twice; ids are unique across the site`);
        seen.add(s.id);
        if (method && !method.layout.patterns.includes(s.pattern) && !(s.patternReason?.length > 20)) problems.push(`${s.id}: pattern "${s.pattern}" is not part of ${method.id} (${method.layout.patterns.join(', ')}); use one of those or give a patternReason`);
        if (words(s.composition) < 12) problems.push(`${s.id}: composition is too vague; give the exact layout (columns, placement, overlap, scale)`);
        if (words(s.hierarchy) < 5) problems.push(`${s.id}: hierarchy is too vague; say what is seen first, second and third`);
        if (s.responsive.mobile.trim() === s.responsive.desktop.trim()) problems.push(`${s.id}: mobile behaviour must differ from desktop`);
        for (const hit of operationalClaims(s)) {
          if (!coveredClaim(normaliseText(hit))) problems.push(`${s.id}: "${hit.slice(0, 60)}" states an operational fact (a time, price or duration) with no matching row in content/claims.json; use only facts from the client notes, with a claim row`);
        }
        if (s.transition && words(s.transition.toNext) < 3) problems.push(`${s.id}: transition.toNext must say how this section hands over to the next`);
        run = s.pattern === last ? run + 1 : 1;
        last = s.pattern;
        if (run === 3) problems.push(`${page.slug}: three sections in a row use "${s.pattern}"; vary the rhythm`);
        for (const a of s.assets) if (assets && !assets.assets?.some((x) => x.id === a)) problems.push(`${s.id}: asset "${a}" is not in design/asset-plan.json`);
        for (const m of s.motion) if (motion && !motion.motions?.some((x) => x.id === m)) problems.push(`${s.id}: motion "${m}" is not in design/motion-plan.json`);
      }
      if (!page.sections.some((s) => s.assets.length)) problems.push(`${page.slug}: no section has a visual asset`);
    }
    const all = sectionsOf(plan);
    const cards = all.filter((s) => CARD_PATTERNS.test(s.pattern)).length;
    if (all.length && cards / all.length > 0.25) problems.push(`design/section-plan.json: ${cards} of ${all.length} sections are card or grid layouts; at most a quarter may be`);
    if (new Set(all.map((s) => s.pattern)).size < Math.min(4, all.length)) problems.push('design/section-plan.json: use at least four different layout patterns across the site');
    return problems;
  },

  'motion-plan'(dir) {
    const [m, problems] = load(dir, 'motionPlan', 'motionPlan');
    if (!m) return problems;
    const [direction] = load(dir, 'direction', 'designDirection');
    const [plan] = load(dir, 'sectionPlan');
    const kinds = new Set(m.motions.map((x) => x.kind));
    if (!kinds.has('hover')) problems.push('design/motion-plan.json: define at least one hover interaction');
    if (direction) {
      const method = loadMethodology(direction.primaryApproach);
      if (method.signals.required.includes('pinned') && !kinds.has('pin')) problems.push(`design/motion-plan.json: ${method.id} needs at least one pinned scene (kind "pin")`);
      if (method.signals.forbidden.includes('pinned') && !direction.combination.length && kinds.has('pin')) problems.push(`design/motion-plan.json: ${method.id} does not pin sections; its scrolling is: ${method.scrolling}`);
    }
    const used = new Set(sectionsOf(plan).flatMap((s) => s.motion));
    if (plan) for (const x of m.motions) if (!used.has(x.id)) problems.push(`design/motion-plan.json: motion ${x.id} is not used by any section`);
    for (const x of m.motions) if (words(x.purpose) < 4) problems.push(`design/motion-plan.json: motion ${x.id} needs a purpose: what does it make clearer?`);
    return problems;
  },

  'asset-plan'(dir) {
    const [a, problems] = load(dir, 'assetPlan', 'assetPlan');
    if (!a) return problems;
    const [plan] = load(dir, 'sectionPlan');
    const used = new Set(sectionsOf(plan).flatMap((s) => s.assets));
    if (plan) for (const x of a.assets) if (!used.has(x.id)) problems.push(`design/asset-plan.json: asset ${x.id} is not used by any section`);
    for (const x of a.assets) {
      if (x.source !== 'authored' && !x.licence) problems.push(`design/asset-plan.json: asset ${x.id} needs a licence`);
      if (x.source !== 'authored' && !x.file) problems.push(`design/asset-plan.json: asset ${x.id} needs a file path under assets/public/`);
      if (words(x.description) < 5) problems.push(`design/asset-plan.json: describe asset ${x.id} so someone could make or find it`);
    }
    return problems;
  },

  'asset-files'(dir) {
    const [a, problems] = load(dir, 'assetPlan', 'assetPlan');
    if (!a) return problems;
    for (const x of a.assets) {
      if (x.source === 'authored') continue;
      if (!x.file || !existsSync(join(dir, 'assets', 'public', x.file))) problems.push(`asset ${x.id}: assets/public/${x.file ?? '(no file)'} is missing; the operator must supply it, or the plan must change`);
    }
    return problems;
  },

  copy(dir) {
    const [c, problems] = load(dir, 'copy', 'siteCopy');
    if (!c) return problems;
    const [plan] = load(dir, 'sectionPlan');
    const [brief] = load(dir, 'brief');
    const planned = new Map(sectionsOf(plan).map((s) => [s.id, s]));
    const written = new Map(c.pages.flatMap((p) => p.sections.map((s) => [s.id, { ...s, slug: p.slug }])));
    for (const id of planned.keys()) if (!written.has(id)) problems.push(`content/copy.json: section ${id} has no copy`);
    for (const id of written.keys()) if (plan && !planned.has(id)) problems.push(`content/copy.json: section ${id} is not in the section plan`);
    const headlines = new Map();
    let total = 0;
    for (const s of written.values()) {
      const text = copyStrings(s);
      total += text.join(' ').split(/\s+/).length;
      if (LABEL_HEADLINE.test(s.headline.trim())) problems.push(`${s.id}: the headline "${s.headline}" only labels the section; write what it means for this client`);
      const key = s.headline.trim().toLowerCase();
      if (headlines.has(key)) problems.push(`${s.id}: the headline repeats ${headlines.get(key)}`);
      headlines.set(key, s.id);
      for (const t of text) {
        const hit = GENERIC_COPY.find((g) => g.test(t));
        if (hit) problems.push(`${s.id}: stock phrase in "${t.slice(0, 70)}"`);
      }
      if (text.length < 2) problems.push(`${s.id}: a headline alone is not enough; add supporting copy`);
    }
    const openings = new Map();
    for (const s of written.values()) {
      const open = s.headline.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ');
      openings.set(open, (openings.get(open) ?? 0) + 1);
    }
    for (const [open, n] of openings) if (n >= 3 && written.size >= 5) problems.push(`content/copy.json: ${n} headlines start with "${open}"; vary them`);
    const pages = c.pages.length || 1;
    if (total / pages < 80) problems.push(`content/copy.json: about ${Math.round(total / pages)} words a page is too thin`);
    // Every checkable claim is registered with a real source, before anything is built. The claims
    // gate applies the same rule to the built pages.
    const claims = read(dir, 'content/claims.json');
    const sources = new Set((read(dir, 'research/sources.json')?.sources ?? []).map((x) => x.id));
    const registered = (claims?.claims ?? []).map((x) => normaliseText(x.text));
    for (const x of claims?.claims ?? []) if (!sources.has(x.source)) problems.push(`content/claims.json: "${String(x.text).slice(0, 60)}" cites ${x.source}, which is not in research/sources.json`);
    for (const s of written.values()) {
      for (const t of copyStrings(s)) {
        if (!isClaim(t)) continue;
        const said = normaliseText(t);
        if (!registered.some((r) => said.includes(r) || r.includes(said))) problems.push(`${s.id}: "${t.slice(0, 70)}" makes a claim that is not in content/claims.json with a source`);
      }
    }
    const name = brief?.client?.name;
    if (name && !JSON.stringify(c).includes(name)) problems.push(`content/copy.json: never names ${name}`);
    for (const p of brief?.pages ?? []) if (!c.pages.some((x) => x.slug === p.slug)) problems.push(`content/copy.json: page ${p.slug} is missing`);
    return problems;
  },

  review(dir) {
    const [r, problems] = load(dir, 'review', 'designReview');
    if (!r) return problems;
    const blocking = r.findings.filter((f) => f.severity === 'blocking');
    if (r.verdict === 'ready' && blocking.length) problems.push('design/review.json: the verdict is ready, but there are blocking findings');
    return problems;
  },
};

// Stage order: where each stage's work is done, and the task that does it.
export const STAGES = [
  { id: 'research', phase: 'RESEARCH', task: 'research', agent: 'research-strategy', owns: ['research/**'], label: 'Research and positioning' },
  { id: 'direction', phase: 'APPROACH_SELECTION', task: 'direction', agent: 'design-manager', owns: ['design/direction.json', 'design/direction.md'], label: 'Design direction' },
  { id: 'design-system', phase: 'UX_DESIGN_SYSTEM', task: 'design-system', agent: 'creative-director', owns: ['design/design-system.json'], label: 'Design system' },
  { id: 'section-plan', phase: 'UX_DESIGN_SYSTEM', task: 'section-plan', agent: 'creative-director', owns: ['design/section-plan.json'], label: 'Section layouts and responsive behaviour' },
  { id: 'motion-plan', phase: 'UX_DESIGN_SYSTEM', task: 'motion-plan', agent: 'creative-director', owns: ['design/motion-plan.json'], label: 'Animation and interaction' },
  { id: 'asset-plan', phase: 'UX_DESIGN_SYSTEM', task: 'asset-plan', agent: 'creative-director', owns: ['design/asset-plan.json'], label: 'Visual asset requirements' },
  { id: 'copy', phase: 'CONTENT', task: 'copy', agent: 'content-ux', owns: ['content/copy.json', 'content/claims.json'], label: 'Actual section content' },
  { id: 'asset-files', phase: 'ASSETS_LICENSING', task: null, agent: 'asset-rights', owns: ['assets/register.json'], label: 'Asset files on hand' },
];

export const stageById = (id) => STAGES.find((s) => s.id === id);

// A blocked stage task no longer counts once a later fix task for that stage has finished: the
// fix task did its work, and the stage's own check decides whether the result is good.
export function isSuperseded(task, tasks) {
  const m = task.id.match(/^(.*?)(?:-fix-(\d+))?$/);
  const n = Number(m[2] ?? 0);
  return tasks.some((t) => {
    const f = t.id.match(/^(.*)-fix-(\d+)$/);
    return f && f[1] === m[1] && Number(f[2]) > n && t.status === 'done';
  });
}

// readiness(dir, { upTo }) => { ready, stages: [{ id, label, phase, ok, problems }] }
// The Design Manager's completeness check. upTo limits it to stages at or before a phase's work.
export function readiness(dir, { only } = {}) {
  const stages = STAGES.filter((s) => !only || only.includes(s.id)).map((s) => {
    const problems = CHECKS[s.id](dir);
    return { id: s.id, label: s.label, phase: s.phase, ok: problems.length === 0, problems };
  });
  return { ready: stages.every((s) => s.ok), stages };
}

// Turns content/copy.json into the locked page files the site and the content gates read: each
// planned section becomes a frontmatter entry naming its bespoke component, in the plan's order,
// and every string is repeated as a body block so the content-parity gate checks it is on the page.
export function writeLockedPages(dir) {
  const copy = read(dir, FILES.copy);
  const plan = read(dir, FILES.sectionPlan);
  const direction = read(dir, FILES.direction);
  if (!copy || !plan || !direction) return [];
  const files = [];
  // Only planned pages exist: a page dropped from the plan must not stay published.
  const pagesDir = join(dir, 'content', 'pages');
  const planned = new Set(plan.pages.map((p) => pageFile(p.slug)));
  if (existsSync(pagesDir)) for (const f of readdirSync(pagesDir)) if (f.endsWith('.md') && !planned.has(f)) rmSync(join(pagesDir, f));
  plan.pages.forEach((page, order) => {
    const written = copy.pages.find((p) => p.slug === page.slug);
    if (!written) return;
    const sections = page.sections.map((planned) => {
      const text = written.sections.find((s) => s.id === planned.id) ?? { id: planned.id };
      return { use: sectionUse(direction.primaryApproach, planned.id), ...text };
    });
    const body = sections.flatMap((s) => copyStrings(s)).join('\n\n');
    const file = join(dir, 'content', 'pages', pageFile(page.slug));
    mkdirSync(dirname(file), { recursive: true });
    const data = { title: written.title, description: written.description, order, status: 'locked', cta: written.cta, sections };
    writeFileSync(file, toMarkdown({ data, body: `${body}\n` }));
    files.push(file);
  });
  return files;
}

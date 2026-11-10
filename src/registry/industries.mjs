import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigInvalid, ConfigMissing, SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';
import { getField } from './condition.mjs';

const REGISTRY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'registry');

// Industry playbooks (registry/industries/*.json): what each kind of business needs from its
// site. Intake detects the industry from the owner's own words, then asks the questions that
// industry cares about, recommends its page set for the chosen tier, and records the one action
// the whole site is built to make happen (the primary conversion).

export const FALLBACK_INDUSTRY = 'general-business';
const TIERS = ['S', 'M', 'L'];
const LEVEL = { S: 0, M: 1, L: 2 };

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SchemaInvalid(`${file} is not valid JSON`, { hint: err.message });
  }
}

// Checks what the schema cannot see: ids point at things that exist.
function checkPlaybook(pb, file) {
  const errors = [];
  const conv = new Set(pb.conversions.map((c) => c.id));
  if (!conv.has(pb.primaryDefault)) errors.push(`primaryDefault ${pb.primaryDefault} is not one of the conversions`);
  for (const id of pb.secondaryDefault) if (!conv.has(id)) errors.push(`secondaryDefault ${id} is not one of the conversions`);
  if (pb.secondaryDefault.includes(pb.primaryDefault)) errors.push('secondaryDefault repeats the primary action');
  const trust = new Set((pb.trustSignals ?? []).map((t) => t.id));
  for (const id of pb.trustDefault ?? []) if (!trust.has(id)) errors.push(`trustDefault ${id} is not one of the trust signals`);
  if (!pb.pages.some((p) => p.slug === '/')) errors.push('the pages must include the home page (/)');
  for (const tier of TIERS) {
    if (!pb.pages.some((p) => p.level === tier) && tier === 'S') errors.push('the pages must have tier S pages');
  }
  const slugs = pb.pages.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length) errors.push('a page slug appears twice');
  for (const slug of Object.keys(pb.requiredSections)) if (!slugs.includes(slug)) errors.push(`requiredSections names ${slug}, which is not a page`);
  const keys = pb.questions.map((q) => q.key);
  if (new Set(keys).size !== keys.length) errors.push('a question key appears twice');
  for (const q of pb.questions) {
    const needsOptions = q.kind === 'single' || q.kind === 'multi';
    if (needsOptions && !q.options) errors.push(`question ${q.key} is ${q.kind} and needs options`);
    if (!needsOptions && q.options) errors.push(`question ${q.key} is ${q.kind} and must not have options`);
    const values = (q.options ?? []).map((o) => o.value);
    if (q.kind === 'single' && !values.includes(q.recommendation)) errors.push(`question ${q.key}: the recommendation is not one of its options`);
    if (q.kind === 'multi' && (!Array.isArray(q.recommendation) || q.recommendation.some((v) => !values.includes(v)))) errors.push(`question ${q.key}: the recommendation must be a list of its options`);
  }
  // The hero must be able to show the primary action and the hero secondaries without crowding.
  if (pb.conversions.filter((c) => c.hero).length > 4) errors.push('no more than four conversions may be marked hero');
  if (errors.length) throw new ConfigInvalid(`${file} is inconsistent`, { hint: errors.join('; '), details: errors });
}

// loadIndustries(root?) => Playbook[]. Reads and validates registry/industries/*.json. A registry
// with no industries folder has none, which keeps every older registry working.
export function loadIndustries(root = REGISTRY_DIR) {
  const dir = join(root, 'industries');
  if (!existsSync(dir)) return [];
  const playbooks = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const pb = assertValid('industryPlaybook', readJson(join(dir, f)), `registry/industries/${f}`);
      if (f !== `${pb.id}.json`) throw new ConfigInvalid(`registry/industries/${f} holds ${pb.id}`, { hint: `Rename it to ${pb.id}.json` });
      checkPlaybook(pb, `registry/industries/${f}`);
      return pb;
    });
  const ids = playbooks.map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new ConfigInvalid('Two industry playbooks share an id');
  if (playbooks.length && !ids.includes(FALLBACK_INDUSTRY)) {
    throw new ConfigMissing(`The industry playbooks need a ${FALLBACK_INDUSTRY} playbook as the fallback`);
  }
  return playbooks;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// detectIndustry(text, playbooks) => { id, keyword } | null
// Matches whole words in the owner's description of the business. The longest matching keyword
// wins, so "real estate agent" beats "estate". No match returns null (the fallback applies).
export function detectIndustry(text, playbooks) {
  const hay = String(text ?? '').toLowerCase();
  let best = null;
  for (const pb of playbooks) {
    for (const kw of pb.keywords) {
      if (!new RegExp(`(^|[^a-z0-9])${escapeRe(kw.toLowerCase())}([^a-z0-9]|$)`).test(hay)) continue;
      if (!best || kw.length > best.keyword.length) best = { id: pb.id, keyword: kw };
    }
  }
  return best;
}

// The pages a playbook recommends for a tier: S pages for S, S and M for M, all for L.
export function pagesFor(pb, tier) {
  const level = LEVEL[tier] ?? LEVEL.M;
  return pb.pages.filter((p) => LEVEL[p.level] <= level).map(({ level: _l, ...page }) => page);
}

const conversionOptions = (pb) => pb.conversions.map((c) => ({ value: c.id, label: c.label }));

// Compiles a playbook into ordinary question-bank entries. They all wait for round 2 (the
// industry is detected from round 1's answers) and apply only when business.industryId is this
// industry, so they take the place of the generic business questions for the same fields.
export function playbookQuestions(pb) {
  const askWhen = { field: 'business.industryId', op: 'eq', value: pb.id };
  const base = (extra) => ({ appliesTo: { projectTypes: 'all', tiers: TIERS }, askWhen, round: 2, ...extra });
  const out = [];

  out.push(
    base({ id: `q-${pb.id}-goals`, fills: ['goals'], prompt: pb.goals.prompt, ...(pb.goals.why && { why: pb.goals.why }), kind: 'text', weight: 10, recommendation: { value: pb.goals.recommendation, reason: pb.goals.reason } }),
    base({ id: `q-${pb.id}-audience`, fills: ['audience'], prompt: pb.audience.prompt, ...(pb.audience.why && { why: pb.audience.why }), kind: 'text', weight: 9, recommendation: { value: pb.audience.recommendation, reason: pb.audience.reason } }),
    base({
      id: `q-${pb.id}-primary`,
      fills: ['business.primaryAction'],
      prompt: `What is the one action that earns you the most, the one every visitor should be led to?`,
      why: 'The home hero, every page\'s call to action and the main form are built around this action.',
      kind: 'single',
      options: conversionOptions(pb),
      weight: 10,
      recommendation: { value: pb.primaryDefault, reason: `The action ${pb.name.toLowerCase()} sites are built around.` },
    }),
    base({
      id: `q-${pb.id}-secondary`,
      fills: ['business.secondaryActions'],
      prompt: 'Which other actions should visitors also be able to take, right beside it in the hero?',
      why: 'Visitors who are not ready for the main action still need a way to stay in touch.',
      kind: 'multi',
      options: conversionOptions(pb),
      weight: 8,
      recommendation: { value: pb.secondaryDefault, reason: 'The secondary actions that usually sit beside the primary one.' },
    }),
  );

  if (pb.trustSignals?.length) {
    out.push(
      base({
        id: `q-${pb.id}-trust`,
        fills: ['business.trustSignals'],
        prompt: 'Which proof can you honestly show on the site?',
        why: 'Visitors look for proof before they act. Only proof you supply is used; nothing is invented.',
        kind: 'multi',
        options: pb.trustSignals.map((t) => ({ value: t.id, label: t.label })),
        weight: 7,
        recommendation: { value: pb.trustDefault ?? [], reason: 'The proof visitors check first.' },
      }),
    );
  }

  for (const tier of TIERS) {
    out.push(
      base({
        id: `q-${pb.id}-pages-${tier.toLowerCase()}`,
        fills: ['pages'],
        prompt: 'Which pages do you need? A short list of page names is enough.',
        why: `This is the set a ${pb.name.toLowerCase()} site needs at tier ${tier}; each page has its own job and call to action.`,
        kind: 'text',
        appliesTo: { projectTypes: 'all', tiers: [tier] },
        weight: 10,
        recommendation: { value: pagesFor(pb, tier), reason: `The ${pagesFor(pb, tier).length} pages a ${pb.name.toLowerCase()} site needs at tier ${tier}, each with its call to action.` },
      }),
    );
  }

  out.push(
    base({
      id: `q-${pb.id}-forms`,
      fills: ['features.forms'],
      prompt: 'Which forms should visitors fill in, and where should each one go?',
      why: 'Each form is placed on the page that needs it and wired to the primary action.',
      kind: 'text',
      weight: 8,
      recommendation: { value: pb.forms, reason: `The forms a ${pb.name.toLowerCase()} site usually needs, sent through the form plugin.` },
    }),
  );

  for (const q of pb.questions) {
    out.push(
      base({
        id: `q-${pb.id}-${q.key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
        fills: [`business.details.${q.key}`],
        prompt: q.prompt,
        ...(q.why && { why: q.why }),
        kind: q.kind,
        ...(q.options && { options: q.options }),
        weight: q.weight ?? 6,
        round: q.round ?? 2,
        recommendation: { value: q.recommendation, reason: q.reason },
      }),
    );
  }
  return out;
}

// resolveBusiness(playbook, view) => the brief.business fields that come from the playbook and
// the owner's answers: the primary and secondary conversions with their labels, what the hero
// must show, and the sections each page needs. Pure.
export function resolveBusiness(pb, view = {}) {
  if (!pb) return undefined;
  const byId = new Map(pb.conversions.map((c) => [c.id, c]));
  const primaryId = getField(view, 'business.primaryAction') ?? pb.primaryDefault;
  const primary = byId.get(primaryId) ?? byId.get(pb.primaryDefault);
  const secondaryIds = getField(view, 'business.secondaryActions') ?? pb.secondaryDefault;
  const secondary = secondaryIds
    .filter((id) => id !== primary.id && byId.has(id))
    .map((id) => {
      const c = byId.get(id);
      return { id: c.id, label: c.label, kind: c.kind, hero: Boolean(c.hero) };
    });
  const trustIds = getField(view, 'business.trustSignals') ?? pb.trustDefault ?? [];
  const trustLabels = trustIds.map((id) => pb.trustSignals?.find((t) => t.id === id)?.label).filter(Boolean);
  const heroMustHave = [
    `The primary action "${primary.label}" as the first and most prominent button`,
    ...secondary.filter((s) => s.hero).map((s) => `The secondary action "${s.label}" (${s.kind}) beside it, visible without scrolling on a phone`),
    ...(trustLabels.length ? [`A proof line drawn from: ${trustLabels.join('; ')}. Use only what the client has supplied`] : []),
    ...pb.heroMustHave,
  ];
  return {
    industryId: pb.id,
    primaryConversion: { id: primary.id, label: primary.label, kind: primary.kind },
    secondaryConversions: secondary,
    heroMustHave,
    ...(pb.contentNeeds?.length && { contentNeeds: pb.contentNeeds }),
    requiredSections: pb.requiredSections,
    ...(pb.compliance?.length && { compliance: pb.compliance }),
  };
}

// storyOf(view) => what the owner said about their visitors, their proof and their limits (the
// brief's business section), whether or not a playbook applies. Pure.
export function storyOf(view = {}) {
  const out = {};
  for (const key of ['visitorSources', 'visitorDevice']) {
    const v = getField(view, `business.${key}`);
    if (v !== undefined && v !== null && !(Array.isArray(v) && !v.length)) out[key] = v;
  }
  return out;
}

// deriveIndustry(facts, playbooks, opts?) => Facts
// Pure. Once the owner has described the business, records which playbook applies as an inferred
// fact (an assumption, listed in the brief), unless an answer already settled it. No keyword
// match gives the fallback playbook, for a business project only.
export function deriveIndustry(facts, playbooks, { now } = {}) {
  if (!playbooks.length) return facts;
  const byField = new Map((facts.facts ?? []).map((f) => [f.field, f]));
  const settled = (f) => f && (f.status === 'known' || f.status === 'inferred');
  if (settled(byField.get('business.industryId'))) return facts;
  const industry = byField.get('client.industry');
  if (!settled(industry)) return facts;
  const type = byField.get('projectType');
  const hit = detectIndustry(industry.value, playbooks);
  let id = hit?.id;
  let reason = hit ? `The industry "${industry.value}" matches the ${playbooks.find((p) => p.id === id).name} playbook (keyword "${hit.keyword}")` : undefined;
  if (!id && settled(type) && type.value === 'business') {
    id = FALLBACK_INDUSTRY;
    reason = `No specific playbook matches "${industry.value}", so the general business playbook applies`;
  }
  if (!id) return facts;
  const fact = {
    field: 'business.industryId',
    status: 'inferred',
    value: id,
    source: { kind: 'default', ref: 'registry/industries' },
    assumption: true,
    reason,
    ...(now && { recordedAt: now.toISOString() }),
  };
  return assertValid('facts', { ...facts, facts: [...facts.facts, fact] });
}

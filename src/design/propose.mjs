import { SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';
import { contrastChecks, mix, tokensFromDirection } from '../site/tokens.mjs';
import { loadDesignCatalog } from './catalog.mjs';
import { blocking, checkDesignRules } from './rules.mjs';

// Tone words in briefs, mapped to the catalog's vocabulary.
const SYNONYMS = {
  friendly: 'warm', welcoming: 'warm', elegant: 'refined', luxury: 'premium', luxurious: 'premium', modern: 'minimal',
  clean: 'minimal', calm: 'minimal', fun: 'playful', energetic: 'playful', professional: 'trustworthy', reliable: 'trustworthy',
  confident: 'bold', striking: 'bold', precise: 'technical', engineered: 'technical', simple: 'clear', honest: 'trustworthy',
};
const TYPE_TAGS = {
  business: ['trustworthy', 'clear'],
  launch: ['bold'],
  showroom: ['refined', 'premium'],
  portfolio: ['minimal', 'editorial'],
  event: ['bold', 'playful'],
  nonprofit: ['warm', 'trustworthy'],
  flagship: ['premium', 'bold'],
};
const LAYOUTS = {
  editorial: ['editorial', 'refined', 'warm'],
  grid: ['technical', 'clear', 'trustworthy'],
  split: ['bold', 'clear'],
  immersive: ['premium', 'bold'],
  minimal: ['minimal', 'refined'],
  modular: ['playful', 'technical'],
};

function wanted(brief) {
  const w = new Map();
  for (const t of brief.brand.tone) {
    const tag = SYNONYMS[t.toLowerCase()] ?? t.toLowerCase();
    w.set(tag, (w.get(tag) ?? 0) + 2);
  }
  for (const tag of TYPE_TAGS[brief.projectType] ?? []) w.set(tag, (w.get(tag) ?? 0) + 1);
  return w;
}

const score = (tags, w) => tags.reduce((s, t) => s + (w.get(t) ?? 0), 0);
const byScore = (a, b) => b.score - a.score || a.key.localeCompare(b.key);

function avoided(brief, ...names) {
  const avoid = (brief.brand.avoid ?? []).map((a) => a.toLowerCase()).filter(Boolean);
  return names.some((n) => avoid.some((a) => n.toLowerCase().includes(a)));
}

// Ranked font pairs: a display face and a body face that suit the tone. Pairs that mix
// categories (serif with sans) get a small bonus, so the directions differ in type, not only in colour.
function rankPairs(fonts, w, brief) {
  const ok = fonts.filter((f) => !avoided(brief, f.family));
  const pairs = [];
  for (const display of ok) {
    for (const body of ok.filter((f) => f.body)) {
      if (display.family === body.family && display.category !== 'sans') continue;
      const mixBonus = display.category !== body.category ? 1 : 0;
      pairs.push({ display, body, key: `${display.family}/${body.family}`, score: score(display.tags, w) * 2 + score(body.tags, w) + mixBonus });
    }
  }
  return pairs.sort(byScore);
}

// A palette from the client's own colours: neutrals from the best catalog palette, the client's
// colours as primary and accent, darkened step by step until they pass contrast.
function clientPalette(colours, base) {
  const fit = (hex) => {
    for (let t = 0; t <= 1; t += 0.05) {
      const c = mix(hex, base.mode === 'dark' ? '#ffffff' : '#000000', t);
      const tokens = { ...base.tokens, primary: c };
      try {
        tokensFromDirection(stub(base.mode, tokens));
        return c;
      } catch {
        // keep darkening
      }
    }
    return base.tokens.primary;
  };
  const primary = fit(colours[0]);
  const tokens = { ...base.tokens, primary, accent: colours[1] ? fit(colours[1]) : base.tokens.accent };
  return { id: 'client', name: 'Client colours', mode: base.mode, tags: [], tokens };
}

const FONT = { family: 'Inter', category: 'sans', source: 'fontsource', licence: 'OFL-1.1' };
const stub = (mode, tokens) => ({ id: 'dir-check', colour: { mode, tokens }, typography: { display: FONT, body: FONT, scaleRatio: 1.25 }, motionIntensity: 0, layout: 'grid' });

const fontRef = (f) => ({ family: f.family, category: f.category, source: 'fontsource', licence: f.licence, weights: f.weights });

// proposeDirections(brief, decision, opts?) => Promise<DesignDecision>
// Deterministic: the same brief gives the same directions. It ranks the catalog's palettes,
// font pairs and layouts against the brief's tone and project type, and builds count (3 to 5)
// directions that never share a palette, a display face or a layout. The client's own colours,
// when the brief has them, lead the first direction. Everything returned passes the schema and
// checkDesignRules; the Creative Director can then refine names and wording before B2.
export async function proposeDirections(brief, decision, { count = 3, catalog = loadDesignCatalog() } = {}) {
  const n = Math.min(5, Math.max(3, count));
  const w = wanted(brief);
  const noDark = (brief.brand.avoid ?? []).some((a) => /dark/i.test(a));
  let palettes = catalog.palettes
    .filter((p) => !(noDark && p.mode === 'dark') && !avoided(brief, p.name, p.id))
    .map((p) => ({ ...p, key: p.id, score: score(p.tags, w) }))
    .sort(byScore);
  const colours = brief.brand.existingAssets?.colours ?? [];
  if (colours.length) palettes = [{ ...clientPalette(colours, palettes.find((p) => p.mode === 'light') ?? palettes[0]), key: 'client', score: 99 }, ...palettes];

  const pairs = rankPairs(catalog.fonts, w, brief);
  const layouts = Object.entries(LAYOUTS)
    .map(([layout, tags]) => ({ layout, key: layout, score: score(tags, w) }))
    .sort(byScore)
    .map((l) => l.layout);
  if (palettes.length < n) throw new SchemaInvalid(`Only ${palettes.length} palettes are left after the brief's avoid list; ${n} are needed`);

  const selected = decision?.decisions.filter((d) => d.selected).map((d) => d.approach) ?? ['APP-01'];
  const goal = brief.goals[0]?.statement;
  const usedDisplay = new Set();
  const usedPairs = new Set();
  const directions = [];
  for (let i = 0; i < n; i++) {
    const palette = palettes[i];
    const pair = pairs.find((p) => !usedDisplay.has(p.display.family) && !usedPairs.has(p.key)) ?? pairs.find((p) => !usedPairs.has(p.key));
    usedDisplay.add(pair.display.family);
    usedPairs.add(pair.key);
    const layout = layouts[i % layouts.length];
    const bold = w.has('bold') || w.has('premium');
    const scaleRatio = layout === 'minimal' || layout === 'grid' ? 1.2 : bold ? 1.333 : 1.25;
    const motion = i === n - 1 && brief.brand.motionIntensity > 0 ? brief.brand.motionIntensity - 1 : brief.brand.motionIntensity;
    const id = `dir-${palette.id}`;
    const direction = {
      id,
      name: `${palette.name}, ${layout}`,
      rationale: `${pair.display.family} with ${pair.body.family} and the ${palette.name.toLowerCase()} palette suit a ${brief.brand.tone.join(', ')} tone; a ${layout} layout${goal ? ` built around "${goal}"` : ''}.`,
      typography: { display: fontRef(pair.display), body: fontRef(pair.body), scaleRatio },
      colour: { mode: palette.mode, tokens: { ...palette.tokens }, contrast: [] },
      motionIntensity: motion,
      layout,
      approaches: selected,
      renders: { desktop: `design/renders/${id}-desktop.png`, mobile: `design/renders/${id}-mobile.png` },
    };
    const tokens = tokensFromDirection(direction);
    direction.colour.contrast = contrastChecks(tokens.color)
      .filter((c) => ['fg', 'muted', 'primary'].includes(c.fg) && ['bg', 'surface'].includes(c.bg))
      .map(({ fg, bg, ratio, use }) => ({ fg, bg, ratio, use }));
    directions.push(direction);
  }

  const record = assertValid('designDecision', { project: brief.project, schemaVersion: '0.1.0', status: 'proposed', directions });
  const problems = blocking(checkDesignRules(record, brief, { catalog }));
  if (problems.length) {
    throw new SchemaInvalid('The proposed directions break the design rules', { hint: problems.map((f) => f.message).join('; '), details: problems });
  }
  return record;
}

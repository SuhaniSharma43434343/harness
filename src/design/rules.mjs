import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../core/schemas.mjs';
import { contrastChecks, tokensFromDirection } from '../site/tokens.mjs';
import { fontPair, loadDesignCatalog, paletteFamily } from './catalog.mjs';

const OPEN = new Set(['OFL-1.1', 'Apache-2.0', 'MIT']);

// checkDesignRules(decision, brief, opts?) => Finding[]
// The T17 rule set. proposeDirections runs it on what it proposes, and the P4 and P5 exit
// gates run it on what the Creative Director hands in. It never throws for a rule failure:
// each failure is a finding with a severity, the direction it is about and a message.
// opts.dir is the project folder; with it, the desktop and mobile renders must exist.
export function checkDesignRules(decision, brief, { dir, catalog = loadDesignCatalog() } = {}) {
  const findings = [];
  const add = (id, severity, message, location) => findings.push({ id, severity, message, ...(location ? { location } : {}) });

  for (const e of check('designDecision', decision).errors) add('schema', 'critical', e);
  const directions = Array.isArray(decision?.directions) ? decision.directions : [];
  if (directions.length < 3) add('too-few', 'critical', `${directions.length} direction(s); P4 needs at least 3`);

  const ids = directions.map((d) => d.id);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) add('duplicate-id', 'serious', `Direction id ${id} is used twice`, id);
  if (decision?.status === 'chosen' && !ids.includes(decision.chosen)) {
    add('chosen-unknown', 'critical', `The chosen direction ${decision.chosen} is not one of the directions`);
  }

  const byFamily = new Map(catalog.fonts.map((f) => [f.family, f]));
  const avoid = (brief?.brand?.avoid ?? []).map((a) => a.toLowerCase());
  const keys = new Map();

  for (const d of directions) {
    const where = d.id;
    for (const role of ['display', 'body']) {
      const font = d.typography?.[role];
      if (!font) continue;
      const known = byFamily.get(font.family);
      if (font.source === 'fontsource' && known && known.licence !== font.licence) {
        add('font-licence', 'serious', `${font.family} is ${known.licence}, not ${font.licence}`, `${where}.typography.${role}`);
      }
      if (!OPEN.has(font.licence) && font.licence !== 'system' && font.licence !== 'client-licensed') {
        add('font-licence', 'critical', `${font.family} has licence ${font.licence}, which needs a licence record and B4`, `${where}.typography.${role}`);
      }
      if (font.licence === 'client-licensed' && font.source !== 'client-supplied') {
        add('font-licence', 'serious', `${font.family} is client-licensed but not client-supplied`, `${where}.typography.${role}`);
      }
      if (avoid.some((a) => a && font.family.toLowerCase().includes(a))) add('avoided', 'serious', `${font.family} is on the brief's avoid list`, where);
    }

    if (d.colour?.tokens) {
      // Re-check contrast from the colours themselves, not from the ratios the direction claims.
      try {
        const tokens = tokensFromDirection(d);
        const computed = new Map(contrastChecks(tokens.color).map((c) => [`${c.fg}/${c.bg}`, c.ratio]));
        for (const claim of d.colour.contrast ?? []) {
          const real = computed.get(`${claim.fg}/${claim.bg}`);
          if (real !== undefined && Math.abs(real - claim.ratio) > 0.1) {
            add('contrast-claim', 'moderate', `${claim.fg} on ${claim.bg} claims ${claim.ratio}:1 but is ${real}:1`, where);
          }
        }
      } catch (err) {
        for (const c of err.details ?? []) add('contrast', 'serious', `${c.fg} on ${c.bg} is ${c.ratio}:1, needs ${c.min}:1`, where);
        if (!err.details) add('contrast', 'serious', err.message, where);
      }
      if (avoid.includes(d.colour.mode)) add('avoided', 'serious', `A ${d.colour.mode} direction, but the brief avoids ${d.colour.mode}`, where);
    }

    if (brief?.brand && typeof d.motionIntensity === 'number' && d.motionIntensity > brief.brand.motionIntensity) {
      add('motion', 'moderate', `Motion ${d.motionIntensity} is above the brief's ${brief.brand.motionIntensity}`, where);
    }

    if (d.typography && d.colour?.tokens) {
      const key = `${fontPair(d.typography)} + ${paletteFamily(d.colour, catalog.palettes)}`;
      if (keys.has(key)) add('not-distinct', 'serious', `${where} and ${keys.get(key)} share the font pair and palette family (${key})`, where);
      else keys.set(key, where);
    }

    if (dir && d.renders) {
      for (const view of ['desktop', 'mobile']) {
        if (!existsSync(join(dir, d.renders[view]))) add('render-missing', 'serious', `No ${view} render at ${d.renders[view]}`, where);
      }
    }
  }
  return findings;
}

export const blocking = (findings) => findings.filter((f) => f.severity === 'critical' || f.severity === 'serious');

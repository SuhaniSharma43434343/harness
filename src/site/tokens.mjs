import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';
import { ROOT } from '../core/workspace.mjs';

export const STARTER_DIR = join(ROOT, 'starters', 'astro-base');
export const DEFAULT_TOKENS = Object.freeze(JSON.parse(readFileSync(join(STARTER_DIR, 'src/styles/tokens.json'), 'utf8')));

// Generic CSS families for each font category in the design decision.
const GENERIC = {
  serif: 'Georgia, serif',
  slab: 'Rockwell, "Roboto Slab", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Consolas, monospace',
  script: 'cursive',
};

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

// Mixes `b` into `a` by `t` (0 to 1).
export function mix(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  return (
    '#' +
    [1, 3, 5]
      .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, '0'))
      .join('')
  );
}

// Text colour for a filled background: the first brand colour that reaches 4.5:1, else
// whichever candidate contrasts most.
function textOn(bg, ...candidates) {
  return (
    candidates.find((c) => contrastRatio(c, bg) >= 4.5) ??
    candidates.reduce((best, c) => (contrastRatio(c, bg) > contrastRatio(best, bg) ? c : best))
  );
}

// The pairs the starter actually renders, with the minimum each use needs.
export function contrastChecks(color) {
  const pairs = [
    ['fg', 'bg', 'body'],
    ['muted', 'bg', 'body'],
    ['link', 'bg', 'body'],
    ['fg', 'surface', 'body'],
    ['onPrimary', 'primary', 'body'],
    ['onAccent', 'accent', 'body'],
    ['primary', 'bg', 'ui'],
  ];
  return pairs.map(([fg, bg, use]) => {
    const ratio = contrastRatio(color[fg], color[bg]);
    const min = use === 'body' ? 4.5 : 3;
    return { fg, bg, use, ratio, min, pass: ratio >= min };
  });
}

function fontToken(font) {
  const generic = GENERIC[font.category] ?? GENERIC.sans;
  if (font.source === 'system') {
    const stack = font.family === 'system-ui' ? GENERIC.sans : `${quote(font.family)}, ${generic}`;
    return { family: font.family, stack, ...(font.weights && { weights: font.weights }) };
  }
  const token = { family: font.family, stack: `${quote(font.family)}, ${generic}`, weights: font.weights ?? [400, 700] };
  if (font.source === 'fontsource') token.package = `@fontsource/${font.family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return token;
}

const quote = (family) => (/^[a-z-]+$/.test(family) ? family : `"${family}"`);

// Design direction (one entry of design/directions.json) -> tokens.json for the site.
// Derives the colours the direction does not name (surface, border, text on buttons, links)
// and throws SchemaInvalid if a pair the site renders fails WCAG contrast.
export function tokensFromDirection(direction) {
  const c = direction.colour.tokens;
  const color = { ...c };
  color.surface ??= mix(c.bg, c.fg, 0.04);
  color.border ??= mix(c.bg, c.fg, 0.18);
  color.onPrimary ??= textOn(c.primary, c.bg, c.fg, '#ffffff', '#000000');
  color.onAccent ??= textOn(c.accent, c.bg, c.fg, '#ffffff', '#000000');
  color.link ??= contrastRatio(c.primary, c.bg) >= 4.5 ? c.primary : c.fg;

  const tokens = {
    schemaVersion: DEFAULT_TOKENS.schemaVersion,
    source: direction.id,
    mode: direction.colour.mode === 'dark' ? 'dark' : 'light',
    color,
    font: { display: fontToken(direction.typography.display), body: fontToken(direction.typography.body) },
    type: { ...DEFAULT_TOKENS.type, scaleRatio: direction.typography.scaleRatio },
    space: DEFAULT_TOKENS.space,
    radius: direction.layout === 'minimal' || direction.layout === 'editorial' ? '0.25rem' : DEFAULT_TOKENS.radius,
    motion: { intensity: direction.motionIntensity },
  };
  return assertTokens(tokens, `tokens from ${direction.id}`);
}

// Schema check plus the contrast pairs. Returns the tokens.
export function assertTokens(tokens, label = 'tokens') {
  assertValid('tokens', tokens, label);
  const failed = contrastChecks(tokens.color).filter((c) => !c.pass);
  if (failed.length) {
    const list = failed.map((c) => `${c.fg} on ${c.bg} is ${c.ratio}:1, needs ${c.min}:1`);
    throw new SchemaInvalid(`${label} fail colour contrast`, { hint: list.join('; '), details: failed });
  }
  return tokens;
}

// src/styles/fonts.css: one @import per Fontsource weight, so only the weights in use ship.
export function fontsCss(tokens) {
  const lines = ['/* Written by the harness from the design tokens: one @import per Fontsource font. */'];
  const seen = new Set();
  for (const font of [tokens.font.display, tokens.font.body]) {
    if (!font.package) continue;
    for (const w of font.weights ?? [400]) {
      const line = `@import '${font.package}/${w}.css';`;
      if (!seen.has(line)) lines.push(line), seen.add(line);
    }
  }
  return lines.join('\n') + '\n';
}

// Fontsource packages the site needs as dependencies, pinned by the caller.
export const fontPackages = (tokens) => [...new Set([tokens.font.display.package, tokens.font.body.package].filter(Boolean))];

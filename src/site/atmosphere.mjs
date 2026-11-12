import { mix } from './tokens.mjs';

// The atmosphere: the surfaces, borders, radius, depth, gradients, light, texture and motion a site is
// built with (design/design-system.json "atmosphere", workflow 2). The harness writes it as CSS custom
// properties in site/src/styles/atmosphere.css, so the builder uses one set of values and cannot
// quietly drop them; the design-fidelity gate checks they reach the page.

// The variables every site has. The starter ships neutral values for them, so a workflow 1 site, which
// has no atmosphere, renders as it always did.
export const ATMOSPHERE_VARS = ['--surface-1', '--surface-2', '--surface-3', '--surface-glass', '--glass-blur', '--glass-border', '--border-subtle', '--border-strong', '--border-glow', '--radius-sm', '--radius-md', '--radius-lg', '--elevation-1', '--elevation-2', '--elevation-3', '--light-radial', '--grain-opacity', '--ease-out', '--ease-spring', '--dur-fast', '--dur-base', '--dur-slow'];

const gradientCss = (g) => {
  const stops = g.stops.join(', ');
  if (g.kind === 'radial') return `radial-gradient(circle at 30% 20%, ${stops})`;
  if (g.kind === 'conic') return `conic-gradient(from 180deg at 50% 50%, ${stops}, ${g.stops[0]})`;
  if (g.kind === 'mesh') {
    // A mesh gradient: one soft radial bloom per stop, laid over each other.
    const spots = ['20% 20%', '80% 10%', '70% 80%', '15% 85%', '50% 50%'];
    return g.stops.map((c, i) => `radial-gradient(at ${spots[i]}, ${c} 0px, transparent 55%)`).join(', ');
  }
  return `linear-gradient(135deg, ${stops})`;
};

// atmosphereCss(atmosphere) => the CSS file's text.
export function atmosphereCss(a) {
  const v = {
    '--surface-1': a.surfaces.raised, '--surface-2': a.surfaces.sunken, '--surface-3': a.surfaces.base,
    '--surface-glass': a.surfaces.glass.fill, '--glass-blur': a.surfaces.glass.blur, '--glass-border': a.surfaces.glass.border,
    '--border-subtle': a.borders.subtle, '--border-strong': a.borders.strong, '--border-glow': a.borders.glow,
    '--radius-sm': a.radius.sm, '--radius-md': a.radius.md, '--radius-lg': a.radius.lg,
    '--elevation-1': a.elevation.low, '--elevation-2': a.elevation.mid, '--elevation-3': a.elevation.high,
    '--light-radial': `radial-gradient(60% 50% at 50% 0%, ${a.borders.glow}, transparent 70%)`,
    '--grain-opacity': String(a.texture.kind === 'none' ? 0 : a.texture.opacity),
    '--ease-out': a.motion.easeOut, '--ease-spring': a.motion.easeSpring ?? a.motion.easeOut,
    '--dur-fast': a.motion.fast, '--dur-base': a.motion.base, '--dur-slow': a.motion.slow,
  };
  for (const g of a.gradients) v[`--gradient-${g.name}`] = gradientCss(g);
  const lines = Object.entries(v).map(([k, val]) => `  ${k}: ${val};`);
  return [
    '/* Written by forge from design/design-system.json "atmosphere". Do not edit: change the design system. */',
    `/* Lighting: ${String(a.lighting).replace(/\*\//g, '')} */`,
    ':root {', ...lines, '}', '',
  ].join('\n');
}

// Colour helpers for the checks.
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(...rgb(a).map((x, i) => x - rgb(b)[i]));
const isZero = (len) => /^0(px|rem|em|%)?$/.test(String(len).trim());
const isNone = (shadow) => /^none$/i.test(String(shadow).trim());

// A gradient stop is on-brand when it is one of the B2 colours, or a mix of two of them (tints and
// shades included, by mixing with the background or the text colour).
export function onBrand(hex, palette, tolerance = 36) {
  const colours = [...new Set(palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase()))];
  for (const a of colours) {
    if (dist(hex, a) <= tolerance) return true;
    for (const b of colours) for (let t = 0.1; t < 1; t += 0.1) if (dist(hex, mix(a, b, t)) <= tolerance) return true;
  }
  return false;
}

// atmosphereProblems(atmosphere, palette) => problems. The balanced depth rule: refused when it is crude
// brutalism (square, flat, no depth at all) and when it is decoration everywhere; otherwise depth must
// come from at least two sources, and every gradient stays in the B2 colours.
export function atmosphereProblems(a, palette) {
  const where = 'design/design-system.json: atmosphere';
  if (!a) return [`${where} is missing: define the surfaces, borders, radius, elevation, gradients, lighting, texture and motion, from the B2 colours`];
  const problems = [];
  const square = ['sm', 'md', 'lg'].every((k) => isZero(a.radius[k]));
  const flat = ['low', 'mid', 'high'].every((k) => isNone(a.elevation[k]));
  const layered = new Set([a.surfaces.base, a.surfaces.raised, a.surfaces.sunken].map((c) => c.toLowerCase())).size >= 2;
  const textured = a.texture.kind !== 'none' && a.texture.opacity > 0;
  const lit = a.gradients.length > 0;
  if (square && flat && !lit && !textured) problems.push(`${where} is crude brutalism: square corners, no depth, no light and no texture. Give it a radius scale, elevation, and a gradient or texture that come from the concept`);
  const sources = [!flat, lit, layered, textured].filter(Boolean).length;
  if (sources < 2) problems.push(`${where} has depth from only ${sources} source${sources === 1 ? '' : 's'}; use at least two of elevation, gradients or light, layered surfaces and texture`);
  if (a.gradients.length > 3) problems.push(`${where} has ${a.gradients.length} gradients; more than three is decoration, not a system`);
  if (/\b(every|all|everything|each)\b/i.test(a.surfaces.glass.use)) problems.push(`${where}: glass on every surface is decoration; give it one job (for example the floating navigation)`);
  const blur = parseFloat(a.surfaces.glass.blur);
  if (blur > 32) problems.push(`${where}: a ${blur}px glass blur is heavy for phones; keep it at 32px or under`);
  for (const g of a.gradients) {
    const off = g.stops.filter((s) => !onBrand(s, palette));
    if (off.length) problems.push(`${where}: gradient "${g.name}" uses ${off.join(', ')}, which is not one of the B2 colours or a mix of them`);
  }
  return problems;
}

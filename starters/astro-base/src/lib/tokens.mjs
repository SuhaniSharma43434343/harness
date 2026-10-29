// Turns src/styles/tokens.json into CSS custom properties. Plain JavaScript with no
// dependencies, so the harness tests can import it directly.

// Motion intensity 0 to 3 (brief.brand.motionIntensity) mapped to a duration and a distance.
const MOTION = [
  { duration: 0, distance: 0 },
  { duration: 150, distance: 4 },
  { duration: 250, distance: 12 },
  { duration: 400, distance: 24 },
];

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const round = (n) => Math.round(n * 1000) / 1000;

export function tokensToCss(tokens) {
  const vars = [];
  for (const [name, value] of Object.entries(tokens.color)) vars.push([`--color-${kebab(name)}`, value]);
  vars.push(['--font-display', tokens.font.display.stack], ['--font-body', tokens.font.body.stack]);
  vars.push(['--weight-display', String(tokens.font.display.weights?.at(-1) ?? 700)]);

  // A modular type scale: --step-0 is the body size, each step multiplies by the ratio.
  const { base, scaleRatio, lineHeight } = tokens.type;
  for (let i = -2; i <= 5; i++) vars.push([`--step-${i < 0 ? `n${-i}` : i}`, `${round(base * scaleRatio ** i)}rem`]);
  vars.push(['--line-height', String(lineHeight)], ['--measure', tokens.type.measure ?? '68ch']);
  vars.push(['--space', tokens.space ?? '1rem'], ['--radius', tokens.radius]);

  const motion = MOTION[tokens.motion.intensity] ?? MOTION[0];
  vars.push(['--motion-duration', `${motion.duration}ms`], ['--motion-distance', `${motion.distance}px`]);

  const body = vars.map(([k, v]) => `  ${k}: ${v};`).join('\n');
  return (
    `:root {\n  color-scheme: ${tokens.mode === 'dark' ? 'dark' : 'light'};\n${body}\n}\n` +
    '@media (prefers-reduced-motion: reduce) {\n  :root { --motion-duration: 0ms; --motion-distance: 0px; }\n}\n'
  );
}

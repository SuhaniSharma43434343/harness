import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { check } from '../../src/core/schemas.mjs';
import { ForgeError } from '../../src/core/errors.mjs';
import { tokensToCss } from '../../starters/astro-base/src/lib/tokens.mjs';
import {
  DEFAULT_TOKENS,
  assertTokens,
  contrastChecks,
  contrastRatio,
  fontPackages,
  fontsCss,
  tokensFromDirection,
} from '../../src/site/tokens.mjs';

const decision = JSON.parse(readFileSync(new URL('../../fixtures/schemas/valid/design-decision.json', import.meta.url), 'utf8'));
const direction = (overrides = {}) => ({ ...structuredClone(decision.directions[0]), ...overrides });

test('contrast ratios match WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.equal(contrastRatio('#767676', '#ffffff'), 4.54);
});

test('the starter default tokens are valid and pass every contrast pair', () => {
  assert.deepEqual(check('tokens', DEFAULT_TOKENS).errors, []);
  for (const c of contrastChecks(DEFAULT_TOKENS.color)) assert.ok(c.pass, `${c.fg} on ${c.bg}: ${c.ratio}`);
});

test('every direction in the design-decision fixture becomes valid tokens', () => {
  for (const d of decision.directions) {
    const tokens = tokensFromDirection(d);
    assert.equal(tokens.source, d.id);
    assert.equal(tokens.motion.intensity, d.motionIntensity);
    assert.equal(tokens.type.scaleRatio, d.typography.scaleRatio);
    for (const key of ['bg', 'fg', 'primary', 'accent', 'muted']) assert.equal(tokens.color[key], d.colour.tokens[key]);
  }
});

test('derived colours give readable text on buttons and links', () => {
  const tokens = tokensFromDirection(
    direction({ colour: { mode: 'light', tokens: { bg: '#ffffff', fg: '#111111', primary: '#d97706', accent: '#0b3d91', muted: '#555555' }, contrast: [] } }),
  );
  assert.equal(tokens.color.onPrimary, '#111111', 'dark text on an orange button');
  assert.equal(tokens.color.link, '#111111', 'a primary under 4.5:1 is not used for link text');
  assert.ok(contrastRatio(tokens.color.onAccent, tokens.color.accent) >= 4.5);
});

test('tokens that fail body contrast are refused with the failing pairs', () => {
  const bad = direction({ colour: { mode: 'light', tokens: { bg: '#ffffff', fg: '#999999', primary: '#1d4ed8', accent: '#b45309', muted: '#555555' }, contrast: [] } });
  assert.throws(
    () => tokensFromDirection(bad),
    (err) => err instanceof ForgeError && err.code === 'SCHEMA_INVALID' && /fg on bg/.test(err.hint),
  );
  assert.throws(() => assertTokens({ ...DEFAULT_TOKENS, radius: 'big' }), /tokens schema/);
});

test('Fontsource fonts become a dependency and one import per weight', () => {
  const d = direction();
  d.typography.display = { family: 'Space Grotesk', category: 'sans', source: 'fontsource', licence: 'OFL-1.1', weights: [700] };
  d.typography.body = { family: 'Inter', category: 'sans', source: 'fontsource', licence: 'OFL-1.1', weights: [400, 700] };
  const tokens = tokensFromDirection(d);
  assert.deepEqual(fontPackages(tokens), ['@fontsource/space-grotesk', '@fontsource/inter']);
  assert.match(tokens.font.display.stack, /^"Space Grotesk", /);
  const css = fontsCss(tokens);
  for (const line of ["@import '@fontsource/space-grotesk/700.css';", "@import '@fontsource/inter/400.css';", "@import '@fontsource/inter/700.css';"]) {
    assert.ok(css.includes(line), line);
  }
  assert.equal(fontPackages(DEFAULT_TOKENS).length, 0, 'system fonts need no package');
});

test('tokensToCss emits custom properties, a type scale and reduced-motion overrides', () => {
  const css = tokensToCss(DEFAULT_TOKENS);
  assert.match(css, /--color-bg: #ffffff;/);
  assert.match(css, /--color-on-primary: #ffffff;/);
  assert.match(css, /--step-0: 1\.125rem;/);
  assert.match(css, /--step-1: 1\.406rem;/);
  assert.match(css, /--step-n1: 0\.9rem;/);
  assert.match(css, /--motion-duration: 150ms;/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*--motion-duration: 0ms/);
  assert.match(tokensToCss({ ...DEFAULT_TOKENS, motion: { intensity: 0 } }), /--motion-duration: 0ms;/);
});

test('a primary colour under 3:1 against the background is refused', () => {
  const pale = direction({ colour: { mode: 'light', tokens: { bg: '#ffffff', fg: '#111111', primary: '#ffd60a', accent: '#0b3d91', muted: '#555555' }, contrast: [] } });
  assert.throws(() => tokensFromDirection(pale), (err) => /primary on bg/.test(err.hint));
});

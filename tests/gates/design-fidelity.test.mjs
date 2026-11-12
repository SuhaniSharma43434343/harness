// The design gates. A site can pass every technical gate and still be a template: these check it
// against the approved specification, in a real browser. The pages here are hand-written, so
// each test shows exactly what the gate sees. Skipped, with the reason, without a browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runGate } from '../../src/gates/index.mjs';
import { distHash } from '../../src/qa/visual.mjs';
import { launchBrowser } from '../../src/tools/load.mjs';

let browser;
let skip = false;
try {
  browser = await launchBrowser();
} catch (err) {
  skip = `Playwright and Chromium are not available (${err.message})`;
}
after(() => browser?.close());

const section = (id, pattern, assets, motion) => ({
  id, purpose: 'p', pattern, composition: 'c', hierarchy: 'h', background: 'b', typography: 't', assets, motion, responsive: { desktop: 'd', tablet: 't', mobile: 'm' },
});
const SPEC = {
  'design/direction.json': { primaryApproach: 'APP-01', combination: [] },
  'design/design-system.json': { typography: { display: 'Georgia', body: 'Verdana' } },
  'design/section-plan.json': { pages: [{ slug: '/', sections: [section('promise', 'full-bleed', ['beam'], ['rise']), section('proof', 'editorial-split', [], ['glow'])] }] },
  'design/motion-plan.json': { motions: [{ id: 'rise', kind: 'scroll' }, { id: 'glow', kind: 'hover' }] },
  'design/asset-plan.json': { assets: [{ id: 'beam', kind: 'svg' }] },
  'content/copy.json': { pages: [{ slug: '/', sections: [{ id: 'promise', headline: 'The price we quote is the price you pay' }, { id: 'proof', headline: 'They told us what it would cost' }] }] },
};

// A page that follows the specification: full-bleed, real asset, working motion, the right fonts.
const GOOD = `<!doctype html><html lang="en"><head><title>t</title><style>
body{margin:0;font-family:Verdana}h1,h2{font-family:Georgia}
[data-section]{min-height:600px;display:block}
#rise{transition:transform .2s}.in#rise{transform:translateY(-20px)}
#glow{transition:background-color .1s}#glow:hover{background-color:rgb(200,0,0)}
</style></head><body>
<div data-section="promise"><h1>The price we quote is the price you pay</h1><p>Text</p><a href="#proof" style="display:inline-block;padding:12px 20px;background:#222;color:#fff">Book a visit</a>
<svg data-asset="beam" width="300" height="300"><rect width="300" height="300"/></svg><div style="height:1000px"></div>
<div id="rise" data-motion="rise">Rises</div></div>
<div style="height:900px"></div>
<div data-section="proof" style="padding-left:300px;background:#eee"><h2>They told us what it would cost</h2><p>Words</p>
<a id="glow" data-motion="glow" href="#">Hover</a></div>
<script>addEventListener('scroll',()=>{const r=document.getElementById('rise');if(scrollY>0)r.classList.add('in');else r.classList.remove('in')});</script>
</body></html>`;

function project(html, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-design-'));
  for (const [f, data] of Object.entries({ ...SPEC, ...extra })) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), JSON.stringify(data));
  }
  mkdirSync(join(dir, 'site', 'dist'), { recursive: true });
  writeFileSync(join(dir, 'site', 'dist', 'index.html'), html);
  return dir;
}
const fidelity = (dir) => runGate('design-fidelity', join(dir, 'site'), { projectDir: dir, browser });
const ids = (r) => r.findings.map((f) => f.id);

test('a site that follows its specification passes, with a screenshot per section', { skip }, async () => {
  const dir = project(GOOD);
  const r = await fidelity(dir);
  assert.deepEqual(r.findings, []);
  assert.equal(r.status, 'pass');
  assert.ok(existsSync(join(dir, 'evidence/visual/home-desktop-promise.jpg')));
  assert.ok(existsSync(join(dir, 'evidence/visual/home-mobile-proof.jpg')));
});

test('a site with no specification fails: there is nothing to be faithful to', { skip }, async () => {
  const dir = project(GOOD);
  writeFileSync(join(dir, 'design/section-plan.json'), '');
  const noPlan = mkdtempSync(join(tmpdir(), 'forge-design-'));
  mkdirSync(join(noPlan, 'site', 'dist'), { recursive: true });
  writeFileSync(join(noPlan, 'site', 'dist', 'index.html'), GOOD);
  const r = await fidelity(noPlan);
  assert.equal(r.status, 'fail');
  assert.deepEqual(ids(r), ['no-design-spec']);
});

test('missing sections, headlines and assets are named', { skip }, async () => {
  let html = GOOD.replace('The price we quote is the price you pay', 'Welcome to our website').replace('data-asset="beam"', '');
  html = html.replace(/<div data-section="proof"[\s\S]*?<\/a><\/div>/, '');
  const r = await fidelity(project(html));
  for (const want of ['copy-missing', 'asset-missing', 'section-missing']) assert.ok(ids(r).includes(want), want);
  assert.equal(r.status, 'fail');
});

test('motion that does not respond is caught, and so is motion that is not there', { skip }, async () => {
  const dead = GOOD.replace('#glow:hover{background-color:rgb(200,0,0)}', '').replace(/<script>[\s\S]*?<\/script>/, '');
  const r = await fidelity(project(dead));
  const messages = r.findings.filter((f) => f.id === 'motion-dead').map((f) => f.message);
  assert.ok(messages.some((m) => /rise/.test(m)), 'scroll');
  assert.ok(messages.some((m) => /glow/.test(m)), 'hover');
  const none = await fidelity(project(GOOD.replace('data-motion="rise"', '')));
  assert.ok(none.findings.some((f) => /no element has this data-motion/.test(f.message)));
});

test('the wrong fonts, a placeholder and a broken image are caught', { skip }, async () => {
  const html = GOOD.replace('font-family:Verdana', 'font-family:Arial').replace('h1,h2{font-family:Georgia}', '').replace('<p>Text</p>', '<p>Text</p><div data-placeholder="art"></div><img src="/nope.jpg" width="200" height="200" alt="x">');
  const r = await fidelity(project(html));
  for (const want of ['font-mismatch', 'placeholder-art', 'image-broken']) assert.ok(ids(r).includes(want), want);
});

test('generic output is caught: a stack of card grids reads as a template', { skip }, async () => {
  const cards = (id, head) => `<div data-section="${id}" style="max-width:1000px;margin:auto"><h2>${head}</h2><div style="display:flex;gap:10px">${[1, 2, 3].map(() => '<div style="width:300px;height:200px;border:1px solid #ccc">Card</div>').join('')}</div></div>`;
  const plan = { pages: [{ slug: '/', sections: ['a', 'b', 'c'].map((i) => section(i, 'asymmetric', [], [])) }] };
  const copy = { pages: [{ slug: '/', sections: ['a', 'b', 'c'].map((id) => ({ id, headline: `Headline ${id}` })) }] };
  const html = `<!doctype html><html lang="en"><body style="font-family:Verdana"><style>h2{font-family:Georgia}</style>${['a', 'b', 'c'].map((i) => cards(i, `Headline ${i}`)).join('')}</body></html>`;
  const r = await fidelity(project(html, { 'design/section-plan.json': plan, 'content/copy.json': copy }));
  for (const want of ['card-monotony', 'repeated-layout', 'text-only']) assert.ok(ids(r).includes(want), want);
});

test('the chosen approach is checked as a whole: pinning in APP-01 and none in APP-02', { skip }, async () => {
  const pinned = GOOD.replace('<div id="rise"', '<div class="pin-spacer"></div><div id="rise"');
  assert.ok(ids(await fidelity(project(pinned))).includes('approach-mixed'));
  const r = await fidelity(project(GOOD, { 'design/direction.json': { primaryApproach: 'APP-02', combination: [] } }));
  assert.ok(ids(r).includes('approach-missing'));
});

test('a stock photo presented as the client\'s own work is caught; a plain description is not', { skip }, async () => {
  const assets = { assets: [{ id: 'beam', kind: 'svg', source: 'authored' }, { id: 'photo', kind: 'photo', source: 'licensed', file: 'images/kitchen.jpg' }] };
  const page = (caption) => GOOD.replace('<p>Text</p>', `<p>Text</p><figure><img src="/images/kitchen.jpg" alt="A kitchen with a wooden island" width="100" height="100"><figcaption>${caption}</figcaption></figure>`);
  const bad = await fidelity(project(page('The Munjoy Hill kitchen, finished in 5 weeks.'), { 'design/asset-plan.json': assets }));
  assert.ok(ids(bad).includes('stock-as-client-work'));
  const fine = await fidelity(project(page('A kitchen with a wooden island.'), { 'design/asset-plan.json': assets }));
  assert.ok(!ids(fine).includes('stock-as-client-work'));
});

test('text hidden under reduced motion is caught', { skip }, async () => {
  const html = GOOD.replace('</style>', '@media (prefers-reduced-motion: reduce){[data-section] h2{opacity:0}}</style>');
  assert.ok(ids(await fidelity(project(html))).includes('reduced-motion-hidden'));
});

test('the visual review gate needs a current review of this very build', async () => {
  const dir = project(GOOD);
  const gate = () => runGate('visual-review', join(dir, 'site'), { projectDir: dir });
  assert.deepEqual(ids(await gate()), ['no-visual-review']);

  const scores = { distinctiveness: 4, composition: 4, typography: 4, contentFit: 4, specFidelity: 4 };
  const review = { buildHash: distHash(join(dir, 'site', 'dist')), verdict: 'pass', approachPreserved: true, scores, findings: [] };
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const save = (r) => writeFileSync(join(dir, 'reports/visual-review.json'), JSON.stringify(r));
  save(review);
  assert.equal((await gate()).status, 'pass');

  save({ ...review, scores: { ...scores, distinctiveness: 2 } });
  assert.ok(ids(await gate()).includes('low-distinctiveness'));
  save({ ...review, approachPreserved: false });
  assert.ok(ids(await gate()).includes('approach-not-preserved'));
  save({ ...review, findings: [{ id: 'template-hero', severity: 'serious', section: 'promise', message: 'It looks like a template hero', evidence: 'x.jpg' }] });
  assert.ok(ids(await gate()).includes('template-hero'));

  save(review);
  writeFileSync(join(dir, 'site', 'dist', 'index.html'), `${GOOD}<!-- changed -->`);
  assert.deepEqual(ids(await gate()), ['stale-visual-review']);
  assert.ok(readFileSync(join(dir, 'site', 'dist', 'index.html'), 'utf8').includes('changed'));
});

test('the first screen needs a call to action: advice for an older project, a defect under workflow 2', { skip }, async () => {
  const noAction = GOOD.replace(/<a href="#proof"[^>]*>Book a visit<\/a>/, '');
  assert.notEqual(noAction, GOOD);
  const old = await fidelity(project(noAction));
  assert.deepEqual(old.findings.filter((f) => f.id === 'hero-no-action').map((f) => f.severity), ['moderate', 'moderate']);
  assert.equal(old.status, 'pass', 'advice does not block an older project');
  const v2 = await fidelity(project(noAction, { 'design/reference/workflow.json': { version: 2 } }));
  assert.deepEqual(v2.findings.filter((f) => f.id === 'hero-no-action').map((f) => f.location), ['/ @ desktop', '/ @ mobile']);
  assert.equal(v2.status, 'fail');
});

test('sections with no room to breathe, and a page where every section has the same spacing, are reported', { skip }, async () => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  const plan = { pages: [{ slug: '/', sections: ids.map((id) => section(id, 'statement', [], [])) }] };
  const copy = { pages: [{ slug: '/', sections: ids.map((id) => ({ id, headline: `Heading ${id}` })) }] };
  const html = `<!doctype html><html lang="en"><head><title>t</title><style>
body{margin:0;font-family:Verdana}h1,h2{font-family:Georgia;margin:0}p{margin:0}
[data-section]{display:block;padding:0;height:300px;overflow:hidden}
</style></head><body><a href="#one" style="display:inline-block;padding:12px">Start</a>
${ids.map((id) => `<div data-section="${id}"><h2>Heading ${id}</h2><p style="height:260px">Text</p><p>End</p></div>`).join('')}
</body></html>`;
  const r = await fidelity(project(html, { 'design/section-plan.json': plan, 'content/copy.json': copy }));
  const cramped = r.findings.filter((f) => f.id === 'cramped-section');
  assert.equal(cramped.length, 5, JSON.stringify(r.findings.map((f) => f.id)));
  assert.match(cramped[0].message, /Section one has no room to breathe: 0px above its content and 0px below/);
  assert.match(r.findings.find((f) => f.id === 'flat-rhythm').message, /Every section on \/ has the same spacing \(0px above its content\)/);
  // The good fixture breathes and varies.
  const good = await fidelity(project(GOOD));
  assert.ok(!good.findings.some((f) => ['cramped-section', 'flat-rhythm', 'hero-no-action'].includes(f.id)));
});

// Workflow 2: the built site carries the design system's atmosphere and the plan's art direction.
const ATMO = {
  surfaces: { base: '#f7f5f0', raised: '#ffffff', sunken: '#efece5', glass: { fill: 'rgba(255, 255, 255, 0.7)', blur: '14px', border: 'rgba(0, 0, 0, 0.1)', use: 'The navigation pill' } },
  borders: { subtle: '#e2ded5', strong: '#1f1b16', glow: 'rgba(47, 107, 90, 0.35)' },
  radius: { sm: '6px', md: '14px', lg: '28px' },
  elevation: { low: '0 1px 2px rgba(0,0,0,.08)', mid: '0 8px 24px rgba(0,0,0,.1)', high: '0 24px 60px rgba(0,0,0,.14)' },
  gradients: [], lighting: 'A radial light behind the hero', texture: { kind: 'grain', opacity: 0.05 },
  motion: { easeOut: 'ease-out', fast: '150ms', base: '300ms', slow: '600ms' },
};
const artSpec = () => {
  const plan = structuredClone(SPEC['design/section-plan.json']);
  plan.pages[0].sections[0].visual = { archetype: 'type-behind-subject', layers: { back: 'A radial light from the top', mid: 'm', front: 'f' } };
  plan.pages[0].sections[1].visual = { archetype: 'pull-quote-portrait', layers: { back: 'The plain page', mid: 'm', front: 'f' } };
  plan.chrome = { navigation: { archetype: 'floating-glass-pill' }, footer: { archetype: 'cropped-wordmark-footer' } };
  return { 'design/section-plan.json': plan, 'design/design-system.json': { ...SPEC['design/design-system.json'], atmosphere: ATMO }, 'design/reference/workflow.json': { version: 2 } };
};
const ATMO_CSS = ':root{--radius-md:14px;--surface-1:#ffffff;--elevation-2:0 8px 24px rgba(0,0,0,.1)}';

test('workflow 2: a build that drops the atmosphere, squares the button, flattens the light and loses the archetypes is flagged', { skip }, async () => {
  const flat = GOOD.replace('<body>', '<body><header><a href="/" style="display:inline-block;padding:12px 20px;background:#222;color:#fff;border-radius:0">Book</a></header>');
  const r = await fidelity(project(flat, artSpec()));
  const ids = new Set(r.findings.map((f) => f.id));
  assert.ok(ids.has('atmosphere-missing'), JSON.stringify(r.findings.map((f) => f.id)));
  assert.ok(r.findings.some((f) => f.id === 'art-drift' && /primary button is square/.test(f.message)));
  assert.ok(r.findings.some((f) => f.id === 'art-drift' && /Section promise is planned with "A radial light from the top" behind it, but renders a flat colour/.test(f.message)));
  assert.ok(r.findings.some((f) => f.id === 'art-drift' && /Section proof is planned as "pull-quote-portrait" but is marked with no data-archetype/.test(f.message)));
  assert.ok(r.findings.some((f) => f.id === 'chrome-drift' && /header is planned as "floating-glass-pill"/.test(f.message)));
  assert.equal(r.status, 'fail');
});

test('workflow 2: a build that carries the atmosphere and the archetypes passes those checks', { skip }, async () => {
  const good = GOOD
    .replace('</style>', `${ATMO_CSS}[data-section="promise"]{background-image:radial-gradient(circle at 50% 0%, #e2ded5, transparent 70%)}</style>`)
    .replace('<div data-section="promise">', '<div data-section="promise" data-archetype="type-behind-subject">')
    .replace('<div data-section="proof"', '<div data-section="proof" data-archetype="pull-quote-portrait"')
    .replace('<a href="#proof" style="display:inline-block;padding:12px 20px;background:#222;color:#fff">', '<a href="#proof" style="display:inline-block;padding:12px 20px;background:#222;color:#fff;border-radius:14px">')
    .replace('<body>', '<body><header data-archetype="floating-glass-pill"><a href="/two">Two</a></header>')
    .replace('</body>', '<footer data-archetype="cropped-wordmark-footer"><p>Harbor</p></footer></body>');
  const r = await fidelity(project(good, artSpec()));
  assert.deepEqual(r.findings.filter((f) => ['atmosphere-missing', 'art-drift', 'chrome-drift'].includes(f.id)), []);
  // A workflow 1 project is never asked for any of it.
  const old = await fidelity(project(GOOD));
  assert.ok(!old.findings.some((f) => ['atmosphere-missing', 'art-drift', 'chrome-drift'].includes(f.id)));
});

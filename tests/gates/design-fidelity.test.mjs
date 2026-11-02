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
<div data-section="promise"><h1>The price we quote is the price you pay</h1><p>Text</p>
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

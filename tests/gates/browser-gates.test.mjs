// T22: the routes, accessibility, forms, responsive and performance gates. Like the content
// gates, each passes the known-good site, fails the blank one and catches its seeded defects.
//
// They need the browser test tools (scripts/setup.sh --with-test-tools). Without Playwright and
// Chromium the browser tests are skipped and say so, and the gate itself must report 'error'.
// Real Lighthouse runs take minutes, so they only run with FORGE_SLOW_TESTS=1; the performance
// logic is tested with a fake adapter either way.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Unavailable } from '../../src/core/errors.mjs';
import { listDefects, materializeFixture } from '../../src/gates/fixtures.mjs';
import { runGate, runGates } from '../../src/gates/index.mjs';
import { resolvePath, serveSite } from '../../src/gates/serve.mjs';
import { launchBrowser, loadTool } from '../../src/tools/load.mjs';

const BROWSER_GATES = ['routes', 'accessibility', 'forms', 'interactions', 'responsive'];

let browser;
let skip = false;
let skipAxe = false;
try {
  browser = await launchBrowser();
} catch (err) {
  skip = `Playwright and Chromium are not available (${err.message}): run scripts/setup.sh --with-test-tools`;
}
try {
  await loadTool('axe-core');
} catch {
  skipAxe = 'axe-core is not installed: run scripts/setup.sh --with-test-tools';
}
const skipLighthouse = process.env.FORGE_SLOW_TESTS ? (await loadTool('lighthouse').then(() => false, () => 'lighthouse is not installed')) : 'set FORGE_SLOW_TESTS=1 to run Lighthouse';
after(() => browser?.close());

const skipFor = (gate) => skip || (gate === 'accessibility' && skipAxe);

for (const gate of BROWSER_GATES) {
  test(`${gate}: passes the known-good site`, { skip: skipFor(gate) }, async () => {
    const { siteDir } = materializeFixture('known-good');
    const r = await runGate(gate, siteDir, { browser, screenshots: false });
    assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  });

  test(`${gate}: fails the blank site`, async () => {
    const { siteDir } = materializeFixture('blank');
    const r = await runGate(gate, siteDir, { browser });
    assert.equal(r.status, 'fail');
  });

  for (const defect of listDefects().filter((d) => d.gate === gate)) {
    test(`${gate}: catches ${defect.id} as ${defect.finding}`, { skip: skipFor(gate) }, async () => {
      const { siteDir } = materializeFixture(defect.id);
      const r = await runGate(gate, siteDir, { browser, screenshots: false });
      assert.equal(r.status, 'fail');
      assert.ok(r.findings.some((f) => f.id === defect.finding), `expected ${defect.finding}, got ${r.findings.map((f) => f.id).join(', ')}`);
    });
  }
}

test('a browser gate without a browser is an error, never a pass', async () => {
  const { siteDir } = materializeFixture('known-good');
  const missing = { launch: async () => { throw new Unavailable('playwright is not installed'); } };
  const r = await runGate('routes', siteDir, { adapters: { playwright: missing } });
  assert.equal(r.status, 'error');
  assert.equal(r.error.code, 'UNAVAILABLE');
});

test('responsive writes a screenshot of every page at every width', { skip }, async () => {
  const { dir, siteDir } = materializeFixture('known-good');
  const r = await runGate('responsive', siteDir, { browser });
  assert.equal(r.evidence.length, 3 * 6);
  assert.ok(readdirSync(join(dir, 'evidence/gates/responsive')).includes('home-360.png'));
});

test('forms: a form whose endpoint fails must show the error state', { skip }, async () => {
  const { siteDir } = materializeFixture('known-good');
  const { writeFileSync, readFileSync } = await import('node:fs');
  const js = join(siteDir, 'dist/_astro/form.js');
  writeFileSync(js, readFileSync(js, 'utf8').replace("show('error', 'Sorry, your message could not be sent. Please try again.');", "show('success', 'Thanks');"));
  const r = await runGate('forms', siteDir, { browser });
  assert.ok(r.findings.some((f) => f.id === 'no-error-state'));
});

test('forms: a submit button the browser cannot click is a finding on its page, not a gate error', { skip }, async () => {
  const { siteDir } = materializeFixture('known-good');
  const { writeFileSync, readFileSync } = await import('node:fs');
  const dist = join(siteDir, 'dist');
  const pages = readdirSync(dist, { recursive: true }).map(String).filter((f) => f.endsWith('.html') && readFileSync(join(dist, f), 'utf8').includes('<form'));
  assert.ok(pages.length, 'the known-good site has a form');
  for (const f of pages) writeFileSync(join(dist, f), readFileSync(join(dist, f), 'utf8').replace('</head>', '<style>form [type=submit]{display:none}</style></head>'));
  const r = await runGate('forms', siteDir, { browser });
  assert.notEqual(r.status, 'error');
  const found = r.findings.filter((f) => f.id === 'form-unusable');
  assert.ok(found.length, 'the hidden button is reported');
  assert.ok(found.every((f) => /^\/\S* \(/.test(f.location)), 'with the page route, so the right page goes back to its builder');
});

test('runGates shares one browser across the browser gates', { skip: skip || skipAxe }, async () => {
  const { siteDir } = materializeFixture('known-good');
  const results = await runGates(siteDir, { gates: BROWSER_GATES, screenshots: false });
  assert.deepEqual(results.map((r) => [r.gate, r.status]), BROWSER_GATES.map((g) => [g, 'pass']));
});

// Performance with a fake Lighthouse: one slow run among three does not fail a page (median).
const fakeLighthouse = (byRoute) => ({
  audit: async (url) => {
    const route = new URL(url).pathname;
    const runs = byRoute[route] ?? byRoute['*'];
    return runs.shift?.() ?? runs;
  },
});
const good = { score: 0.98, lcp: 1200, cls: 0.01, tbt: 30, fcp: 900 };

test('performance: medians of three runs against the budgets', async () => {
  const { siteDir } = materializeFixture('known-good');
  const pass = await runGate('performance', siteDir, { adapters: { lighthouse: fakeLighthouse({ '/': [good, { ...good, tbt: 900 }, good], '*': good }) } });
  assert.equal(pass.status, 'pass', JSON.stringify(pass.findings));
  assert.equal(pass.metrics['/ tbt'], 30);

  const slow = { ...good, score: 0.6, lcp: 4100, cls: 0.3, tbt: 800 };
  const fail = await runGate('performance', siteDir, { adapters: { lighthouse: fakeLighthouse({ '/services': [slow, slow, good], '*': good }) } });
  assert.equal(fail.status, 'fail');
  assert.deepEqual(fail.findings.map((f) => f.id).sort(), ['cls', 'lcp', 'score', 'tbt']);
  assert.ok(fail.findings.every((f) => f.location === '/services'));
});

test('performance: the JavaScript budget is checked on the whole build', async () => {
  const { siteDir } = materializeFixture('known-good');
  const r = await runGate('performance', siteDir, { thresholds: { jsBytes: 10 }, adapters: { lighthouse: fakeLighthouse({ '*': good }) } });
  assert.ok(r.findings.some((f) => f.id === 'js-budget'));
});

test('performance: a Lighthouse runtime error is a gate error', async () => {
  const { siteDir } = materializeFixture('known-good');
  const r = await runGate('performance', siteDir, { adapters: { lighthouse: fakeLighthouse({ '*': { ...good, runtimeError: 'NO_FCP' } }) } });
  assert.equal(r.status, 'error');
});

for (const name of ['known-good', 'performance-blocking-script']) {
  test(`performance with real Lighthouse: ${name}`, { skip: skip || skipLighthouse, timeout: 600_000 }, async () => {
    const { siteDir } = materializeFixture(name);
    const r = await runGate('performance', siteDir, { thresholds: { maxPages: 1 } });
    if (name === 'known-good') assert.equal(r.status, 'pass', JSON.stringify(r.findings));
    else assert.ok(r.findings.some((f) => f.id === 'tbt'), JSON.stringify(r.findings));
  });
}

test('the static server maps clean URLs to the directory build and answers 404 with the 404 page', async () => {
  const { siteDir } = materializeFixture('known-good');
  const dist = join(siteDir, 'dist');
  assert.equal(resolvePath(dist, '/services'), join(dist, 'services/index.html'));
  assert.equal(resolvePath(dist, '/services/'), join(dist, 'services/index.html'));
  assert.equal(resolvePath(dist, '/../../etc/passwd'), null);
  const server = await serveSite(dist);
  try {
    assert.equal((await fetch(`${server.url}/contact`)).status, 200);
    const missing = await fetch(`${server.url}/nope`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /<html/);
    assert.equal((await fetch(`${server.url}/api/quote`, { method: 'POST' })).status, 405);
  } finally {
    await server.close();
  }
});

test('interactions: working widgets pass, so the gate only flags controls that do nothing', { skip }, async () => {
  const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const siteDir = join(mkdtempSync(join(tmpdir(), 'forge-widgets-')), 'site');
  mkdirSync(join(siteDir, 'dist'), { recursive: true });
  writeFileSync(join(siteDir, 'dist', 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Widgets</title></head>
<body>
  <main>
    <h1>Every widget here works</h1>
    <button id="t" type="button" aria-expanded="false" aria-controls="panel" style="min-width:48px;min-height:48px">Toggle</button>
    <div id="panel" hidden><p>Revealed.</p></div>
    <details><summary>More detail</summary><p>Opened.</p></details>
    <div role="tablist">
      <button id="tabA" role="tab" aria-selected="true" aria-controls="pA" style="min-width:48px;min-height:48px">A</button>
      <button id="tabB" role="tab" aria-selected="false" aria-controls="pB" style="min-width:48px;min-height:48px">B</button>
    </div>
    <div id="pA"><p>Panel A</p></div><div id="pB" hidden><p>Panel B</p></div>
    <button id="openBtn" type="button" aria-haspopup="dialog" style="min-width:48px;min-height:48px">Open dialog</button>
    <dialog id="dlg"><p>Hello.</p></dialog>
    <div class="carousel" style="width:200px">
      <div id="track" style="display:flex;overflow-x:auto;width:200px"><div style="min-width:200px">One</div><div style="min-width:200px">Two</div></div>
      <button class="next" id="nextB" type="button" style="min-width:48px;min-height:48px">Next</button>
    </div>
  </main>
  <script>
    const el = (id) => document.getElementById(id);
    el('t').addEventListener('click', () => { const open = el('t').getAttribute('aria-expanded') === 'true'; el('t').setAttribute('aria-expanded', String(!open)); el('panel').hidden = open; });
    for (const tab of [el('tabA'), el('tabB')]) tab.addEventListener('click', () => {
      for (const x of [el('tabA'), el('tabB')]) x.setAttribute('aria-selected', String(x === tab));
      el('pA').hidden = tab !== el('tabA'); el('pB').hidden = tab !== el('tabB');
    });
    el('openBtn').addEventListener('click', () => el('dlg').showModal());
    el('nextB').addEventListener('click', () => { el('track').scrollBy(200, 0); });
  </script>
</body></html>`);
  const r = await runGate('interactions', siteDir, { browser });
  assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  assert.deepEqual({ ...r.metrics, navChecks: 0 }, { toggles: 1, details: 1, tabs: 1, dialogs: 1, carousels: 1, navChecks: 0 });
});

test('interactions: real-world patterns produce no false verdicts', { skip, timeout: 120_000 }, async () => {
  // Three confirmed review findings, pinned: (1) a navbar link carrying aria-expanded navigates
  // - a working link, never 'toggle-dead', never a gate error; (2) a sticky modal with no
  // Escape handler must not vouch for a DEAD second opener, nor block the working carousel
  // below it; (3) at phone width, a search button sitting before the hamburger must not turn a
  // working menu into a critical 'nav-unreachable'.
  const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const siteDir = join(mkdtempSync(join(tmpdir(), 'forge-realworld-')), 'site');
  mkdirSync(join(siteDir, 'dist', 'two'), { recursive: true });
  writeFileSync(join(siteDir, 'dist', 'two', 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Two</title></head>
<body><main><h1>Second page</h1><p><a href="/">Back</a></p></main></body></html>`);
  writeFileSync(join(siteDir, 'dist', 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Patterns</title>
<style>
  @media (max-width: 480px) { nav a { display: none } nav.open a { display: block } }
  .overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 9 }
  .overlay.show { display: block }
  button { min-width: 48px; min-height: 48px }
</style></head>
<body>
  <header>
    <a href="/">Patterns</a>
    <button id="searchBtn" type="button" aria-label="Search">S</button>
    <button id="menuBtn" type="button" aria-label="Open menu" aria-expanded="false">M</button>
    <nav id="mainNav">
      <a href="/two" aria-expanded="false">Products</a>
      <a href="/">Home</a>
    </nav>
  </header>
  <main>
    <h1>Real-world patterns</h1>
    <button id="open1" type="button" data-modal-open>Open sticky dialog</button>
    <div id="sticky" class="overlay" role="dialog" aria-label="Sticky"><div><p>No escape handler here.</p><button id="x1" type="button">X</button></div></div>
    <button id="open2" type="button" data-modal-open>Dead opener</button>
    <div class="carousel" style="width:200px">
      <div id="track" style="display:flex;overflow-x:auto;width:200px"><div style="min-width:200px">One</div><div style="min-width:200px">Two</div></div>
      <button class="next" id="nextB" type="button">Next</button>
    </div>
  </main>
  <script>
    const el = (id) => document.getElementById(id);
    el('menuBtn').addEventListener('click', () => {
      const open = el('menuBtn').getAttribute('aria-expanded') === 'true';
      el('menuBtn').setAttribute('aria-expanded', String(!open));
      el('mainNav').classList.toggle('open', !open);
    });
    el('open1').addEventListener('click', () => el('sticky').classList.add('show'));
    el('x1').addEventListener('click', () => el('sticky').classList.remove('show'));
    el('nextB').addEventListener('click', () => { el('track').scrollBy(200, 0); });
  </script>
</body></html>`);
  const r = await runGate('interactions', siteDir, { browser });
  const ids = r.findings.map((f) => f.id).sort();
  // Exactly one true finding: the dead opener. No false toggle-dead for the navigating link,
  // no carousel-dead from the sticky overlay, no nav-unreachable, and never a gate error.
  assert.equal(r.status, 'fail');
  assert.deepEqual(ids, ['modal-dead'], JSON.stringify(r.findings, null, 2));
  assert.ok(r.findings[0].message.includes('Dead opener'), r.findings[0].message);
});

test('every browser plugin has a valid manifest', async () => {
  const { assertValid } = await import('../../src/core/schemas.mjs');
  const { readFileSync } = await import('node:fs');
  for (const id of ['playwright', 'axe-core', 'lighthouse']) {
    const file = new URL(`../../src/plugins/${id}/plugin.json`, import.meta.url);
    assert.ok(existsSync(file), id);
    assertValid('plugin', JSON.parse(readFileSync(file, 'utf8')), id);
  }
});

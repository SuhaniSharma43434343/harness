// Build tests for the starter template (T18): every sample brief scaffolds into a site that
// Astro builds, with one route per brief page, working internal links, a call to action on
// every page and JavaScript inside the APP-01 budget.
//
// They need the starter's dependencies (scripts/setup.sh installs them). Without them the
// tests are skipped, and say so. Set FORGE_SKIP_BUILD_TESTS=1 to skip them on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSite, initialScripts, JS_BUDGET_BYTES, siteReport } from '../../src/site/build.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { STARTER_DIR } from '../../src/site/tokens.mjs';
import { newProject } from '../unit/helpers.mjs';
import { linkModules } from './approach-helpers.mjs';

const MODULES = join(STARTER_DIR, 'node_modules');
const skip = process.env.FORGE_SKIP_BUILD_TESTS
  ? 'FORGE_SKIP_BUILD_TESTS is set'
  : !existsSync(join(MODULES, 'astro'))
    ? 'starter dependencies are not installed: run scripts/setup.sh (or npm ci in starters/astro-base)'
    : false;

const SAMPLES = new URL('../../samples/briefs/', import.meta.url);
const TYPES = readdirSync(SAMPLES).map((f) => f.replace('.json', ''));

// Scaffolds a project and links the starter's installed dependencies instead of reinstalling.
function scaffold(brief) {
  const { project, opts } = newProject(brief.project);
  const r = scaffoldSite(project, { brief, ...opts });
  linkModules(r.siteDir);
  return r;
}

const routeFile = (dist, route) => join(dist, route === '/' ? 'index.html' : `${route.slice(1)}/index.html`);

for (const type of TYPES) {
  test(`the ${type} sample brief builds into a complete site`, { skip }, () => {
    const brief = JSON.parse(readFileSync(new URL(`${type}.json`, SAMPLES), 'utf8'));
    const { siteDir } = scaffold(brief);
    const build = buildSite(siteDir);
    assert.ok(build.ok, build.output.slice(-2000));

    const report = siteReport(build.dist);
    assert.deepEqual(report.routes, brief.pages.map((p) => p.slug).sort());
    assert.ok(existsSync(join(build.dist, '404.html')));
    assert.ok(report.jsBytes <= JS_BUDGET_BYTES, `${report.jsBytes} bytes of JavaScript`);

    for (const page of brief.pages) {
      const html = readFileSync(routeFile(build.dist, page.slug), 'utf8');
      assert.match(html, new RegExp(`<html lang="${brief.client.languages?.[0] ?? 'en'}"`));
      assert.equal(html.match(/<h1[\s>]/g)?.length, 1, `${page.slug} has one h1`);
      assert.match(html, /<title>[^<]+<\/title>/);
      assert.match(html, /<meta name="description" content="[^"]+"/);
      assert.match(html, /--color-bg: #/, 'tokens are inlined as custom properties');
      assert.ok(html.includes(page.cta), `${page.slug} shows its call to action "${page.cta}"`);
      assert.match(html, /href="#main"/, 'skip link');

      // Every internal link points at a built route, and every anchor at an element on that page.
      for (const [, href] of html.matchAll(/<a [^>]*href="([^"]+)"/g)) {
        if (/^(https?:|mailto:|tel:)/.test(href)) continue;
        const [path, hash] = href.split('#');
        const target = path === '' ? page.slug : path;
        assert.ok(target === '/' || report.routes.includes(target), `${page.slug} links to ${href}`);
        if (hash) {
          const targetHtml = readFileSync(routeFile(build.dist, target), 'utf8');
          assert.match(targetHtml, new RegExp(`id="${hash}"`), `${page.slug} links to #${hash}`);
        }
      }
    }

    for (const form of brief.features?.forms ?? []) {
      const page = readFileSync(join(siteDir, 'src/site.json'), 'utf8');
      const { page: slug } = JSON.parse(page).forms[form.id];
      const html = readFileSync(routeFile(build.dist, slug), 'utf8');
      assert.match(html, new RegExp(`data-forge-form="${form.id}"`));
      for (const [, id] of html.matchAll(/<input[^>]* id="([^"]+)"/g)) assert.match(html, new RegExp(`<label for="${id}"`), `label for ${id}`);
    }
  });
}

test('a page that uses a missing section fails the build and names the file', { skip }, () => {
  const brief = JSON.parse(readFileSync(new URL('launch.json', SAMPLES), 'utf8'));
  const { siteDir } = scaffold(brief);
  const file = join(siteDir, 'src/content/pages/index.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('APP-01/Prose', 'APP-03/Scene'));
  const build = buildSite(siteDir);
  assert.equal(build.ok, false);
  assert.match(build.output, /src\/sections\/APP-03\/Scene\.astro does not exist/);
});

test('a starter build passes the SEO gate once the site URL is set', { skip }, async () => {
  const { runGate } = await import('../../src/gates/index.mjs');
  const brief = JSON.parse(readFileSync(new URL('business.json', SAMPLES), 'utf8'));
  const { siteDir } = scaffold(brief);
  const siteFile = join(siteDir, 'src/site.json');
  writeFileSync(siteFile, JSON.stringify({ ...JSON.parse(readFileSync(siteFile, 'utf8')), url: 'https://example.com' }, null, 2));
  const build = buildSite(siteDir);
  assert.ok(build.ok, build.output.slice(-2000));
  const r = await runGate('seo', siteDir);
  assert.equal(r.status, 'pass', JSON.stringify(r.findings, null, 2));
  assert.deepEqual(r.findings.filter((f) => f.id.startsWith('sitemap')), []);
});

// The CSS a built page loads: its linked stylesheets and its inline <style> blocks.
function pageCss(dist, html) {
  const linked = [...html.matchAll(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return [...linked, ...inline].join('\n');
}

// The five x-factor tools (a savings calculator, an audience switcher, a lead magnet in a
// dialog, deep FAQs and a comparison matrix) on one page of a sample site, built once and
// shared by the tests below.
const XFACTOR_PAGE = `---
title: "Tools"
description: "Work out your savings, find your path, get the guide and compare your options."
nav: false
cta: { label: "Join the waitlist", href: "/#waitlist" }
sections:
  - use: "APP-01/Hero"
  - use: "APP-01/SavingsCalculator"
    heading: "What could you save?"
    intro: "Put in your own numbers."
    inputs:
      - { name: "hours", label: "Hours spent on admin each week", unit: "hours", value: 5, min: 0, max: 80, step: 0.5 }
      - { name: "rate", label: "What an hour of your time is worth", unit: "GBP", value: 40, min: 0, step: 1 }
    formula: [["hours", "rate", 52, 0.5]]
    result: { label: "Estimated saving a year", prefix: "£" }
    note: "Assumes the tool halves the time you spend on admin."
  - use: "APP-01/AudienceViewSwitcher"
    heading: "Who is it for?"
    views:
      - { label: "Residential", heading: "For your home", text: "Quiet installs and one visit.", points: ["Fixed price"], cta: { label: "Home options", href: "/specs" } }
      - { label: "Commercial", heading: "For your business", text: "Out-of-hours work and site reports.", cta: { label: "Business options", href: "/specs" } }
  - use: "APP-01/LeadMagnetModal"
    form: "guide"
    heading: "The buyer's guide"
    text: "Twelve pages on what to ask before you buy."
    button: "Get the free guide"
  - use: "APP-01/DeepFaqAccordion"
    heading: "Everything you wanted to ask"
    items:
      - { q: "How long does it take?", a: ["Most installs take one day.", "Larger sites take two, and we tell you before we start."] }
      - { q: "What does it cost?", a: "It depends on the size of the job; the calculator above gives a first idea." }
  - use: "APP-01/ComparisonMatrix"
    heading: "How we compare"
    caption: "Us against the usual alternatives"
    columns: ["Us", "A typical agency", "Doing it yourself"]
    highlight: 0
    rows:
      - { feature: "Fixed price", values: [true, false, true] }
      - { feature: "Time to launch", values: ["2 weeks", "3 months", "It depends"] }
      - { feature: "Support after launch", values: [true, "Paid extra", false] }
---
`;

const X_FACTOR = ['SavingsCalculator', 'AudienceViewSwitcher', 'LeadMagnetModal', 'DeepFaqAccordion', 'ComparisonMatrix'];

let xfactor;
function xfactorSite() {
  if (xfactor) return xfactor;
  const brief = JSON.parse(readFileSync(new URL('launch.json', SAMPLES), 'utf8'));
  const { siteDir } = scaffold(brief);
  writeFileSync(join(siteDir, 'src/content/pages/tools.md'), XFACTOR_PAGE);
  xfactor = { siteDir, build: buildSite(siteDir) };
  return xfactor;
}

const inlineScripts = (html) => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());

test('the five x-factor tools build on one page inside the JavaScript budget', { skip }, () => {
  const { build } = xfactorSite();
  assert.ok(build.ok, build.output.slice(-2000));
  const report = siteReport(build.dist);
  assert.ok(report.routes.includes('/tools'));
  assert.ok(report.jsBytes <= JS_BUDGET_BYTES, `${report.jsBytes} bytes of JavaScript`);

  const html = readFileSync(routeFile(build.dist, '/tools'), 'utf8');
  // The calculator explains itself without JavaScript: the default inputs' result is in the page.
  assert.match(html, /<output[^>]*>£5,200<\/output>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /<dialog[^>]*>/);
  assert.match(html, /action="\/api\/form\?form=guide"/);
  assert.equal(html.match(/<details[\s>]/g)?.length, 2);
  assert.match(html, /<table[\s\S]*<caption[^>]*>Us against the usual alternatives<\/caption>/);
  assert.match(html, /<th[^>]*scope="col"/);
  assert.match(html, /<th[^>]*scope="row"/);
  for (const [, id] of html.matchAll(/<input[^>]* id="([^"]+)"/g)) assert.match(html, new RegExp(`<label[^>]* for="${id}"`), `label for ${id}`);

  // The tools' own scripts (what this page loads that the home page does not) stay under 2 KB each.
  const own = new Set(initialScripts(build.dist, 'tools/index.html'));
  for (const f of initialScripts(build.dist, 'index.html')) own.delete(f);
  const homeInline = new Set(inlineScripts(readFileSync(routeFile(build.dist, '/'), 'utf8')));
  const scripts = [...[...own].map((f) => readFileSync(join(build.dist, f), 'utf8')), ...inlineScripts(html).filter((s) => !homeInline.has(s))];
  assert.ok(scripts.length > 0, 'the tools page ships its scripts');
  for (const s of scripts) assert.ok(Buffer.byteLength(s) <= X_FACTOR.length * 2048, `${Buffer.byteLength(s)} bytes`);
  for (const name of X_FACTOR) {
    const src = readFileSync(join(STARTER_DIR, 'src/sections/APP-01', `${name}.astro`), 'utf8');
    const script = src.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
    // Comments and indentation do not ship; what is left is close to the built size.
    const code = script.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
    assert.ok(Buffer.byteLength(code) <= 2048, `${name}'s script is ${Buffer.byteLength(code)} bytes`);
    // Styled only with the tokens: no hard-coded colours or font families.
    const css = src.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    assert.ok(css, `${name} has styles`);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|font-family:(?!\s*var\()/i, `${name} uses only token custom properties`);
  }
});

test('the x-factor tools pass the accessibility and interactions gates', { skip }, async () => {
  const { runGate } = await import('../../src/gates/index.mjs');
  const { siteDir, build } = xfactorSite();
  assert.ok(build.ok, build.output.slice(-2000));
  const a11y = await runGate('accessibility', siteDir);
  assert.equal(a11y.status, 'pass', JSON.stringify(a11y.findings, null, 2));
  const ui = await runGate('interactions', siteDir, { thresholds: { minTapPx: 44 } });
  assert.equal(ui.status, 'pass', JSON.stringify(ui.findings, null, 2));
  assert.deepEqual(ui.findings.filter((f) => f.message.includes('/tools')), [], 'no tool control is under 44px');
  assert.ok(ui.metrics.tabs >= 1 && ui.metrics.details >= 2 && ui.metrics.dialogs >= 1, JSON.stringify(ui.metrics));
});

test('the x-factor tools work by keyboard and fit a phone screen', { skip }, async () => {
  const { serveSite } = await import('../../src/gates/serve.mjs');
  const { launchBrowser } = await import('../../src/tools/load.mjs');
  const { build } = xfactorSite();
  assert.ok(build.ok, build.output.slice(-2000));
  const server = await serveSite(build.dist);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${server.url}/tools`, { waitUntil: 'load' });

    // Calculator: a new value updates the announced result.
    await page.fill('input[name="hours"]', '10');
    assert.equal((await page.textContent('.calc output')).trim(), '£10,400');

    // Switcher: arrow keys move between views, and only the selected view's panel shows.
    const tabs = page.locator('[role="tab"]');
    await tabs.first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'tab');
    assert.equal(await page.locator('[role="tabpanel"]:visible').count(), 1);
    assert.match(await page.locator('[role="tabpanel"]:visible').textContent(), /For your business/);
    await page.keyboard.press('Home');
    assert.equal(await tabs.first().getAttribute('aria-selected'), 'true');

    // Lead magnet: the button opens a modal dialog, Escape closes it and focus goes back.
    const opener = page.locator('[aria-haspopup="dialog"]');
    await opener.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').open), true);
    assert.equal(await page.evaluate(() => document.querySelector('dialog').contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.querySelector('dialog').open), false);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-haspopup')), 'dialog');

    // Phone width: no horizontal page scroll, and the matrix still labels every cell.
    await page.setViewportSize({ width: 360, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal page scroll at 360px');
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.matrix tbody td')].every((td) => td.dataset.label)));
  } finally {
    await browser.close();
    await server.close();
  }
});

test('each page loads only the CSS of the sections it shows', { skip }, () => {
  const brief = JSON.parse(readFileSync(new URL('business.json', SAMPLES), 'utf8'));
  const { siteDir } = scaffold(brief);
  const build = buildSite(siteDir);
  assert.ok(build.ok, build.output.slice(-2000));
  const css = (route) => pageCss(build.dist, readFileSync(routeFile(build.dist, route), 'utf8'));
  // The projects page shows a gallery and the contact page does not; no page uses the testimonials.
  assert.match(css('/projects'), /\.gallery\[data-astro-cid/);
  assert.doesNotMatch(css('/contact'), /\.gallery\[data-astro-cid/);
  for (const page of brief.pages) assert.doesNotMatch(css(page.slug), /\.quotes\[data-astro-cid/, `${page.slug} carries no unused section's CSS`);
  // Every page still gets the layout's own CSS.
  for (const page of brief.pages) assert.match(css(page.slug), /--color-bg/);
});

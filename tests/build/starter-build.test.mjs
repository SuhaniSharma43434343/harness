// Build tests for the starter template (T18): every sample brief scaffolds into a site that
// Astro builds, with one route per brief page, working internal links, a call to action on
// every page and JavaScript inside the APP-01 budget.
//
// They need the starter's dependencies (scripts/setup.sh installs them). Without them the
// tests are skipped, and say so. Set FORGE_SKIP_BUILD_TESTS=1 to skip them on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSite, JS_BUDGET_BYTES, siteReport } from '../../src/site/build.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { STARTER_DIR } from '../../src/site/tokens.mjs';
import { newProject } from '../unit/helpers.mjs';

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
  symlinkSync(MODULES, join(r.siteDir, 'node_modules'), 'junction');
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

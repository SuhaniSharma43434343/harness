import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from '../../src/core/ledger.mjs';
import { check } from '../../src/core/schemas.mjs';
import { formField, pageFile, planSite, toMarkdown } from '../../src/site/content.mjs';
import { DEFAULT_TOKENS } from '../../src/site/tokens.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { newProject } from './helpers.mjs';

const SAMPLES = new URL('../../samples/briefs/', import.meta.url);
const sample = (type) => JSON.parse(readFileSync(new URL(`${type}.json`, SAMPLES), 'utf8'));
const TYPES = readdirSync(SAMPLES).map((f) => f.replace('.json', ''));

test('page slugs map to content files', () => {
  assert.equal(pageFile('/'), 'index.md');
  assert.equal(pageFile('/contact'), 'contact.md');
  assert.equal(pageFile('/services/kitchens'), 'services/kitchens.md');
});

test('form fields get input types, autocomplete and required flags', () => {
  assert.deepEqual(formField('email'), { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' });
  assert.deepEqual(formField('name'), { name: 'name', label: 'Name', type: 'text', required: true, autocomplete: 'name' });
  assert.equal(formField('phone').type, 'tel');
  assert.equal(formField('preferred date').type, 'date');
  assert.equal(formField('message').type, 'textarea');
  assert.equal(formField('project type').name, 'project-type');
  assert.equal(formField('project type').required, false);
});

for (const type of TYPES) {
  test(`the ${type} sample brief plans a valid site with one page per brief page`, () => {
    const brief = sample(type);
    const { site, pages } = planSite(brief);
    assert.deepEqual(check('siteConfig', site).errors, []);
    assert.equal(site.name, brief.client.name);
    assert.deepEqual(site.nav.map((n) => n.href), brief.pages.map((p) => p.slug));
    assert.deepEqual(pages.map((p) => p.file), brief.pages.map((p) => pageFile(p.slug)));
    assert.deepEqual(Object.keys(site.forms), (brief.features?.forms ?? []).map((f) => f.id));

    const slugs = new Set(brief.pages.map((p) => p.slug));
    for (const [i, page] of pages.entries()) {
      assert.equal(page.data.status, 'scaffold');
      assert.equal(page.data.cta.label, brief.pages[i].cta, 'every page keeps its call to action');
      assert.equal(page.data.sections[0].use, 'APP-01/Hero');
      // Every CTA goes to an anchor on the page or to a page that exists.
      const target = page.data.cta.href.split('#')[0];
      assert.ok(target === '' || slugs.has(target), `${page.file}: ${page.data.cta.href}`);
    }
    // Every form is rendered on exactly the page it is assigned to.
    for (const [id, form] of Object.entries(site.forms)) {
      const holders = pages.filter((p) => p.data.sections.some((s) => s.form === id));
      assert.deepEqual(holders.map((p) => p.file), [pageFile(form.page)]);
    }
  });
}

test('forms go to the matching page, or to the home page when none matches', () => {
  assert.equal(planSite(sample('business')).site.forms.quote.page, '/contact');
  assert.equal(planSite(sample('flagship')).site.forms['test-drive'].page, '/book');
  assert.equal(planSite(sample('showroom')).site.forms.dealer.page, '/dealers');
  assert.equal(planSite(sample('event')).site.forms.register.page, '/');
  assert.equal(planSite(sample('event')).pages[1].data.cta.href, '/#register');
});

test('frontmatter quotes every string so brief text cannot break it', () => {
  const md = toMarkdown({
    data: { title: 'Q: "yes" # no', sections: [{ use: 'APP-01/Hero', lead: '---' }], empty: [] },
    body: 'Body\n',
  });
  assert.equal(
    md,
    '---\ntitle: "Q: \\"yes\\" # no"\nsections:\n  - use: "APP-01/Hero"\n    lead: "---"\nempty: []\n---\nBody\n',
  );
});

test('scaffoldSite copies the starter, writes the brief and records it in the ledger', () => {
  const brief = sample('business');
  const { project, opts } = newProject(brief.project);
  const r = scaffoldSite(project, { brief, ...opts });
  const site = r.siteDir;

  assert.ok(existsSync(join(site, 'astro.config.mjs')));
  assert.ok(existsSync(join(site, 'src/sections/APP-01/Hero.astro')));
  assert.ok(!existsSync(join(site, 'node_modules')), 'dependencies are not copied');
  assert.deepEqual(JSON.parse(readFileSync(join(site, 'src/styles/tokens.json'), 'utf8')), DEFAULT_TOKENS);
  assert.equal(JSON.parse(readFileSync(join(site, 'src/site.json'), 'utf8')).name, 'Harbor Home Renovations');
  assert.deepEqual(readdirSync(join(site, 'src/content/pages')).sort(), ['contact.md', 'index.md', 'projects.md', 'services.md']);
  assert.deepEqual(r.forms, ['quote']);

  const note = ledger.read(project, opts).at(-1);
  assert.equal(note.type, 'note');
  assert.equal(note.data.event, 'site_scaffolded');
  assert.equal(note.data.pages.length, 4);
});

test('scaffoldSite refuses to overwrite a site unless forced', () => {
  const brief = sample('launch');
  const { project, opts } = newProject(brief.project);
  scaffoldSite(project, { brief, ...opts });
  assert.throws(() => scaffoldSite(project, { brief, ...opts }), (err) => err.code === 'PERMISSION_DENIED');
  assert.doesNotThrow(() => scaffoldSite(project, { brief, force: true, ...opts }));
});

test('scaffoldSite reads intake/brief.json and uses locked content over the scaffold', () => {
  const brief = sample('portfolio');
  const { project, opts } = newProject(brief.project);
  const dir = join(opts.workspace, project);
  mkdirSync(join(dir, 'intake'), { recursive: true });
  writeFileSync(join(dir, 'intake/brief.json'), JSON.stringify(brief));
  mkdirSync(join(dir, 'content/pages'), { recursive: true });
  const locked = '---\ntitle: "About"\ndescription: "Mira Rao, photographer"\nstatus: "locked"\ncta: { label: "Get in touch", href: "/" }\nsections:\n  - use: "APP-01/Prose"\n---\nHello.\n';
  writeFileSync(join(dir, 'content/pages/about.md'), locked);

  const r = scaffoldSite(project, opts);
  assert.deepEqual(r.pages.find((p) => p.file === 'about.md'), { file: 'about.md', status: 'content' });
  assert.equal(readFileSync(join(r.siteDir, 'src/content/pages/about.md'), 'utf8'), locked);
  assert.equal(r.pages.filter((p) => p.status === 'scaffold').length, 2);
});

test('scaffoldSite without a brief says where to put one', () => {
  const { project, opts } = newProject('no-brief');
  assert.throws(() => scaffoldSite(project, opts), (err) => err.code === 'CONFIG_MISSING' && /intake\/brief\.json/.test(err.hint));
});

test('scaffoldSite uses the chosen direction from design/directions.json', () => {
  const brief = sample('nonprofit');
  const { project, opts } = newProject(brief.project);
  const decision = JSON.parse(readFileSync(new URL('../../fixtures/schemas/valid/design-decision.json', import.meta.url), 'utf8'));
  assert.equal(decision.status, 'chosen');
  mkdirSync(join(opts.workspace, project, 'design'), { recursive: true });
  writeFileSync(join(opts.workspace, project, 'design/directions.json'), JSON.stringify(decision));
  const r = scaffoldSite(project, { brief, ...opts });
  assert.equal(r.tokens, decision.chosen);
});

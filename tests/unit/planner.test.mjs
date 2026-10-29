import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listTasks } from '../../src/core/board.mjs';
import { runCheck } from '../../src/core/checks.mjs';
import { planPhase } from '../../src/core/planner.mjs';
import { check } from '../../src/core/schemas.mjs';
import { writeJsonAtomic } from '../../src/core/workspace.mjs';
import { newProject } from './helpers.mjs';

const BRIEF = JSON.parse(readFileSync(new URL('../../samples/briefs/business.json', import.meta.url), 'utf8'));

function project(phase) {
  const p = newProject(BRIEF.project);
  p.dir = join(p.opts.workspace, p.project);
  mkdirSync(join(p.dir, 'intake'), { recursive: true });
  writeFileSync(join(p.dir, 'intake', 'brief.json'), JSON.stringify(BRIEF));
  const file = join(p.dir, 'project.json');
  writeJsonAtomic(file, { ...JSON.parse(readFileSync(file, 'utf8')), phase });
  return p;
}

test('research and asset phases get valid task contracts, once', () => {
  for (const [phase, id, agent] of [['RESEARCH', 'research', 'research-strategy'], ['ASSETS_LICENSING', 'asset-register', 'asset-rights']]) {
    const p = project(phase);
    const added = planPhase(p.project, p.opts);
    assert.deepEqual(added.map((t) => [t.id, t.agent]), [[id, agent]]);
    assert.ok(check('task', added[0]).valid);
    assert.match(added[0].verify, /check (research|assets)$/);
    assert.deepEqual(planPhase(p.project, p.opts), [], 'planning again adds nothing');
    assert.equal(listTasks(p.project, p.opts).length, 1);
  }
});

test('the content task names every brief page, and its drafts are seeded from the site', () => {
  const p = project('CONTENT');
  assert.throws(() => planPhase(p.project, p.opts), /no draft pages/);
  mkdirSync(join(p.dir, 'site', 'src', 'content', 'pages'), { recursive: true });
  writeFileSync(join(p.dir, 'site', 'src', 'content', 'pages', 'index.md'), '---\ntitle: "Home"\n---\n');
  const [t] = planPhase(p.project, p.opts);
  for (const page of BRIEF.pages) assert.ok(t.acceptance[0].includes(page.cta), page.cta);
  assert.equal(readFileSync(join(p.dir, 'content', 'pages', 'index.md'), 'utf8'), '---\ntitle: "Home"\n---\n');
});

test('phases whose work is a forge command get no tasks', () => {
  for (const phase of ['INTAKE', 'BUILD', 'QUALITY_REVIEW']) assert.deepEqual(planPhase(project(phase).project, project(phase).opts), []);
});

test('the content check wants every page locked, with sections and no placeholders', () => {
  const p = project('CONTENT');
  const pages = join(p.dir, 'content', 'pages');
  mkdirSync(pages, { recursive: true });
  const page = (status, body) => `---\ntitle: "T"\nstatus: "${status}"\nsections:\n  - use: "APP-01/Hero"\n    lead: "x"\n---\n${body}\n`;
  for (const f of ['index', 'services', 'projects', 'contact']) writeFileSync(join(pages, `${f}.md`), page('locked', 'Real copy about kitchens and bathrooms that is long enough to count as copy.'));
  assert.deepEqual(runCheck('content', p.dir), []);
  writeFileSync(join(pages, 'services.md'), page('draft', 'Lorem ipsum dolor'));
  const problems = runCheck('content', p.dir);
  assert.ok(problems.some((x) => /services.md: status/.test(x)));
  assert.ok(problems.some((x) => /services.md: has placeholder/.test(x)));
});

test('the research and assets checks catch missing and malformed files', () => {
  const p = project('RESEARCH');
  assert.ok(runCheck('research', p.dir).some((x) => /summary.md/.test(x)));
  mkdirSync(join(p.dir, 'research'), { recursive: true });
  writeFileSync(join(p.dir, 'research', 'summary.md'), 'x'.repeat(300));
  writeFileSync(join(p.dir, 'research', 'sources.json'), JSON.stringify({ sources: [{ id: 'brief', title: 'Brief', kind: 'client', ref: 'intake/brief.json' }] }));
  assert.deepEqual(runCheck('research', p.dir), []);
  assert.deepEqual(runCheck('assets', p.dir), ['assets/register.json is missing']);
  mkdirSync(join(p.dir, 'assets'), { recursive: true });
  writeFileSync(join(p.dir, 'assets', 'register.json'), JSON.stringify({ assets: [{ file: 'a.svg', licence: 'own work', source: 'drawn', status: 'cleared' }, { file: 'b.png' }] }));
  assert.deepEqual(runCheck('assets', p.dir), ['register row b.png needs licence, source and status']);
});

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

test('the copy task names every brief page and call to action', () => {
  const p = project('CONTENT');
  const [t] = planPhase(p.project, p.opts);
  assert.equal(t.id, 'copy');
  for (const page of BRIEF.pages) assert.ok(t.acceptance.join(' ').includes(page.cta), page.cta);
});

test('phases whose work is a forge command get no tasks', () => {
  for (const phase of ['INTAKE', 'CREATIVE_DIRECTIONS', 'QUALITY_REVIEW']) assert.deepEqual(planPhase(project(phase).project, project(phase).opts), []);
});

test('the build cannot be planned from an incomplete specification', () => {
  const p = project('BUILD');
  assert.throws(() => planPhase(p.project, p.opts), /specification is not complete/);
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
  assert.deepEqual(runCheck('research', p.dir), ['research/positioning.json is missing']);
  assert.deepEqual(runCheck('assets', p.dir), ['assets/register.json is missing']);
  mkdirSync(join(p.dir, 'assets'), { recursive: true });
  writeFileSync(join(p.dir, 'assets', 'register.json'), JSON.stringify({ assets: [{ file: 'a.svg', licence: 'own work', source: 'drawn', status: 'cleared' }, { file: 'b.png' }] }));
  assert.deepEqual(runCheck('assets', p.dir), ['register row b.png needs licence, source and status']);
});

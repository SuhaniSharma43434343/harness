import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdNew } from '../../src/cli/project.mjs';
import { cmdSite } from '../../src/cli/site.mjs';
import { STARTER_DIR } from '../../src/site/tokens.mjs';
import { linkModules } from '../build/approach-helpers.mjs';

// fileURLToPath, not URL.pathname: on Windows the pathname is /C:/..., which no file API accepts.
const BRIEF = fileURLToPath(new URL('../../samples/briefs/business.json', import.meta.url));
const DECISION = fileURLToPath(new URL('../../fixtures/schemas/valid/design-decision.json', import.meta.url));

function tmpRoot() {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  return { root, workspace: join(root, 'ws') };
}

function quiet(fn) {
  const { log, error } = console;
  const out = [];
  console.log = console.error = (...a) => out.push(a.join(' '));
  try {
    return { code: fn(), out: out.join('\n') };
  } finally {
    Object.assign(console, { log, error });
  }
}

test('forge site writes the site from the brief given to forge new', () => {
  const { root, workspace } = tmpRoot();
  quiet(() => cmdNew(root, ['harbor-home', '--brief', BRIEF]));
  const r = quiet(() => cmdSite(root, ['harbor-home']));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Wrote 4 pages .* \(tokens: starter-default\)/);
  assert.match(r.out, /4 page\(s\) are scaffolds/);
  assert.ok(existsSync(join(workspace, 'harbor-home/site/src/content/pages/contact.md')));
});

test('forge site --direction styles the site from a design direction', () => {
  const { root, workspace } = tmpRoot();
  quiet(() => cmdNew(root, ['harbor-home']));
  const direction = JSON.parse(readFileSync(DECISION, 'utf8')).directions[0];
  const file = join(root, 'direction.json');
  writeFileSync(file, JSON.stringify(direction));
  const r = quiet(() => cmdSite(root, ['harbor-home', '--brief', BRIEF, '--direction', file]));
  assert.equal(r.code, 0, r.out);
  const tokens = JSON.parse(readFileSync(join(workspace, 'harbor-home/site/src/styles/tokens.json'), 'utf8'));
  assert.equal(tokens.source, direction.id);
});

test('forge site prints usage without a project', () => {
  const { root } = tmpRoot();
  assert.equal(quiet(() => cmdSite(root, [])).code, 2);
});

test('forge site --build-only needs a site', () => {
  const { root } = tmpRoot();
  quiet(() => cmdNew(root, ['harbor-home', '--brief', BRIEF]));
  const r = quiet(() => cmdSite(root, ['harbor-home', '--build-only']));
  assert.equal(r.code, 1);
  assert.match(r.out, /has no site yet/);
});

const noStarter = !existsSync(join(STARTER_DIR, 'node_modules', 'astro')) && 'starter dependencies are not installed: run scripts/setup.sh';

// Found in the T28 release run: rebuilding after forge approach used to mean scaffolding again.
test('forge site --build-only builds the site that is there and keeps its changes', { skip: noStarter }, () => {
  const { root, workspace } = tmpRoot();
  quiet(() => cmdNew(root, ['harbor-home', '--brief', BRIEF]));
  quiet(() => cmdSite(root, ['harbor-home']));
  const siteDir = join(workspace, 'harbor-home', 'site');
  linkModules(siteDir);
  const page = join(siteDir, 'src/content/pages/services.md');
  writeFileSync(page, readFileSync(page, 'utf8').replace(/title: .*/, 'title: Rebuilt services'));
  const r = quiet(() => cmdSite(root, ['harbor-home', '--build-only']));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Built 4 routes/);
  assert.match(readFileSync(join(siteDir, 'dist/services/index.html'), 'utf8'), /Rebuilt services/);
});

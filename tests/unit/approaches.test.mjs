// Approach modules (T19, T20): every module matches its registry entry, and its recipes exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModule, MODULES } from '../../src/approaches/index.mjs';
import { loadApproaches } from '../../src/registry/load.mjs';
import { ROOT } from '../../src/core/workspace.mjs';
import { cmdApproach } from '../../src/cli/approach.mjs';
import { createProject, approve } from '../../src/core/project.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';

const { approaches } = loadApproaches();
const entry = (id) => approaches.find((a) => a.id === id);

for (const m of MODULES.values()) {
  test(`${m.id} module matches its registry entry`, () => {
    const e = entry(m.id);
    assert.equal(e.verification, 'implemented');
    for (const r of e.module.recipes) assert.ok(existsSync(join(ROOT, r)), r);
    assert.ok(existsSync(join(ROOT, e.module.skill)), e.module.skill);
    for (const k of ['build', 'fallback', 'budget']) assert.ok(existsSync(join(ROOT, e.tests[k])), e.tests[k]);
    assert.equal(m.fallback.approach, e.fallback.approach);
    assert.deepEqual(m.fallback.triggers, e.fallback.triggers);
    for (const s of m.sections) assert.ok(existsSync(join(ROOT, m.recipes, 'sections', `${s}.astro`)), s);
    for (const p of m.packages) {
      const dep = e.dependencies.find((d) => d.name === p.name);
      assert.ok(dep, `${p.name} is listed in the registry`);
      assert.equal(p.licenceVerified, dep.licenceVerified, `${p.name} licence status agrees with the registry`);
      assert.match(p.version, /^\d+\.\d+\.\d+$/, 'exact version');
    }
  });
}

test('getModule refuses an approach without a module', () => {
  assert.throws(() => getModule('APP-08'), /No approach module for APP-08/);
});

function cliProject(decisions) {
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, workspaceDir: 'ws' }));
  const workspace = join(root, 'ws');
  createProject('lumen', { workspace });
  const brief = JSON.parse(readFileSync(join(ROOT, 'samples/briefs/launch.json'), 'utf8'));
  scaffoldSite('lumen', { brief, workspace });
  const file = join(workspace, 'lumen', 'design', 'approach-decision.json');
  mkdirSync(join(workspace, 'lumen', 'design'), { recursive: true });
  writeFileSync(file, JSON.stringify({ decisions }));
  return { root, workspace };
}

const quiet = async (fn) => {
  const { log } = console;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

test('forge approach applies a selected approach and refuses one that is not selected', async () => {
  const { root, workspace } = cliProject([{ approach: 'APP-02', selected: true }]);
  assert.equal(await quiet(() => cmdApproach(root, ['lumen', 'APP-02', '--no-install'])), 0);
  assert.ok(existsSync(join(workspace, 'lumen', 'site/src/sections/APP-02/ScrollStory.astro')));
  const other = cliProject([{ approach: 'APP-02', selected: false, reason: 'Not selected: rejected' }]);
  await assert.rejects(cmdApproach(other.root, ['lumen', 'APP-02', '--no-install']), /APP-02 is not selected/);
});

test('forge approach needs the recorded approval for an experimental approach', async () => {
  const { root, workspace } = cliProject([{ approach: 'APP-02', selected: true, needsApproval: 'B2' }]);
  await assert.rejects(cmdApproach(root, ['lumen', 'APP-02', '--no-install']), /B2 not recorded/);
  approve('lumen', 'B2', { workspace });
  assert.equal(await quiet(() => cmdApproach(root, ['lumen', 'APP-02', '--no-install'])), 0);
});

test('APP-04 wiring: scene events dispatch page events, and page triggers emit scene events', async () => {
  const { wireEvents } = await import('../../skills/app04/recipes/lib/events.js');
  const listeners = new Map();
  const emitted = [];
  const app = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    emitEvent: (type, object) => emitted.push([type, object]),
  };
  const button = new EventTarget();
  const root = new EventTarget();
  root.ownerDocument = { querySelectorAll: (sel) => (sel === '#play' ? [button] : []) };
  const seen = [];
  root.addEventListener('scene:button', (e) => seen.push(e.detail));

  const off = wireEvents(app, root, {
    events: [{ on: 'mouseDown', object: 'Button', dispatch: 'scene:button' }],
    triggers: [{ selector: '#play', event: 'click', emit: 'mouseDown', object: 'Cube' }],
  });
  listeners.get('mouseDown')({ target: { name: 'Other' } });
  listeners.get('mouseDown')({ target: { name: 'Button' } });
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(seen, [{ object: 'Button', event: 'mouseDown' }]);
  assert.deepEqual(emitted, [['mouseDown', 'Cube']]);

  off();
  button.dispatchEvent(new Event('click'));
  assert.equal(listeners.size, 0);
  assert.equal(emitted.length, 1);
});

test('lockInSync: npm ci only when the lockfile pins what package.json asks for', async () => {
  const { lockInSync } = await import('../../src/site/build.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'forge-lock-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '7.3.8' } }));
  assert.equal(lockInSync(dir), false, 'no lockfile');
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { '': { dependencies: { astro: '7.3.8' } } } }));
  assert.equal(lockInSync(dir), true);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { astro: '7.3.8', '@fontsource/lora': '5.3.0' } }));
  assert.equal(lockInSync(dir), false, 'forge site added a font package');
});

test('APP-04 fetches its scene through the spline plugin, and keeps the poster without it', async () => {
  const app04 = getModule('APP-04');
  const workspace = mkdtempSync(join(tmpdir(), 'forge-ws-'));
  createProject('scene', { workspace });
  const siteDir = join(workspace, 'scene', 'site');
  mkdirSync(join(siteDir, 'src', 'lib', 'app04'), { recursive: true });
  const sceneFile = join(siteDir, 'src', 'lib', 'app04', 'scene.json');
  const root = mkdtempSync(join(tmpdir(), 'forge-root-'));
  const dirs = [join(ROOT, 'plugins')];
  const url = 'https://prod.spline.design/AbC123-x/scene.splinecode';
  const opts = { project: 'scene', workspace, root, dirs, mock: true, env: {} };

  // Plugin not enabled: the poster stays, with the reason.
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {} }));
  let r = await app04.fetchScene(siteDir, { url, ...opts });
  assert.equal(r.fallback, 'plugin-missing');
  assert.match(r.reason, /not enabled/);
  assert.deepEqual(JSON.parse(readFileSync(sceneFile, 'utf8')), { scene: null });

  // Enabled but B5 not recorded: still the poster.
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: { spline: true } }));
  r = await app04.fetchScene(siteDir, { url, ...opts });
  assert.equal(r.fallback, 'plugin-missing');
  assert.match(r.reason, /B5/);

  // Enabled and approved: the scene is copied into public/spline/ and recorded for the section.
  approve('scene', 'B5', { workspace });
  r = await app04.fetchScene(siteDir, { url, ...opts });
  assert.equal(r.scene, '/spline/scene.splinecode');
  assert.ok(existsSync(join(siteDir, 'public', 'spline', 'scene.splinecode')));
  assert.equal(JSON.parse(readFileSync(sceneFile, 'utf8')).scene, '/spline/scene.splinecode');
});

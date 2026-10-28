import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as git from '../../plugins/git/index.mjs';
import * as preview from '../../plugins/local-preview/index.mjs';
import * as vercel from '../../plugins/vercel/index.mjs';
import { AuthFailed, ConfigMissing, PermissionDenied, RateLimited, Unavailable } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { getPlugin, healthCheck, listPlugins } from '../../src/core/plugins.mjs';
import { approve } from '../../src/core/project.mjs';
import { gitDiscardChanges } from '../../src/core/recovery.mjs';
import { newProject, task } from './helpers.mjs';

const tmp = (p = 'forge-plug-') => mkdtempSync(join(tmpdir(), p));

function builtSite() {
  const dir = tmp('forge-dist-');
  writeFileSync(join(dir, 'index.html'), '<h1>Home</h1>');
  writeFileSync(join(dir, '404.html'), '<h1>Missing</h1>');
  mkdirSync(join(dir, 'about'));
  writeFileSync(join(dir, 'about', 'index.html'), '<h1>About</h1>');
  writeFileSync(join(dir, 'style.css'), 'h1{color:red}');
  return dir;
}

test('the git, local-preview and vercel plugins ship with valid manifests, off by default', () => {
  const plugins = listPlugins({ env: {} });
  for (const id of ['git', 'local-preview', 'vercel']) {
    const p = plugins.find((x) => x.id === id);
    assert.ok(p, `${id} is discovered`);
    assert.equal(p.hasMock, true, `${id} has a mock`);
  }
  assert.deepEqual(plugins.find((p) => p.id === 'vercel').approvals, ['B5', 'B7']);
});

test('git: init makes the project its own repository, once, and commit and log work', async () => {
  const dir = tmp();
  writeFileSync(join(dir, 'project.json'), '{}');
  mkdirSync(join(dir, 'locks'));
  writeFileSync(join(dir, 'locks', 'run.lock'), '{}');
  assert.deepEqual(await git.init(dir), { created: true });
  assert.deepEqual(await git.init(dir), { created: false });
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^locks\/$/m);

  mkdirSync(join(dir, 'site'));
  writeFileSync(join(dir, 'site', 'index.html'), 'v1');
  const sha = await git.commit(dir, 'Build hero');
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(await git.commit(dir, 'nothing changed'), null);
  assert.deepEqual((await git.log(dir)).map((c) => c.subject), ['Build hero', 'Project created']);
  assert.deepEqual((await git.status(dir)).changed, []);
  assert.ok(!spawnSync('git', ['ls-files'], { cwd: dir, encoding: 'utf8' }).stdout.includes('locks/'), 'locks are not committed');
  assert.equal((await git.healthCheck()).ok, true);
});

test('git: after init, forge resume can discard a crashed task\'s changes', async () => {
  const dir = tmp();
  mkdirSync(join(dir, 'site'));
  writeFileSync(join(dir, 'site', 'hero.txt'), 'good\n');
  await git.init(dir);
  writeFileSync(join(dir, 'site', 'hero.txt'), 'half written\n');
  assert.equal(gitDiscardChanges({ task: task('hero'), projectDir: dir }).discarded, true);
  assert.equal(readFileSync(join(dir, 'site', 'hero.txt'), 'utf8').replace(/\r/g, ''), 'good\n');
  await assert.rejects(git.commit(tmp(), 'x'), ConfigMissing);
});

test('local-preview serves clean URLs, answers 404 with the 404 page, and refuses traversal', async () => {
  const { url, close } = await preview.start({ dir: builtSite() });
  try {
    const get = async (p) => {
      const r = await fetch(new URL(p, url));
      return [r.status, await r.text(), r.headers.get('x-robots-tag')];
    };
    assert.deepEqual(await get('/'), [200, '<h1>Home</h1>', 'noindex']);
    assert.deepEqual((await get('/about')).slice(0, 2), [200, '<h1>About</h1>']);
    assert.deepEqual((await get('/about/')).slice(0, 2), [200, '<h1>About</h1>']);
    assert.deepEqual((await get('/nope')).slice(0, 2), [404, '<h1>Missing</h1>']);
    assert.deepEqual((await get('/%2e%2e/%2e%2e/etc/passwd')).slice(0, 1), [404]);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    assert.equal((await fetch(new URL('/style.css', url))).headers.get('content-type'), 'text/css; charset=utf-8');
  } finally {
    await close();
  }
  await assert.rejects(preview.start({ dir: tmp() }), ConfigMissing);
  assert.equal((await preview.healthCheck()).ok, true);
});

// A fake Vercel API behind ctx.fetch.
function fakeVercel({ states = ['BUILDING', 'READY'], status = {} } = {}) {
  const calls = [];
  let poll = 0;
  const reply = (code, body) => ({ ok: code < 300, status: code, text: async () => JSON.stringify(body) });
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, query: u.search, headers: init.headers, body: init.body });
    if (status[u.pathname]) return reply(status[u.pathname], { error: { message: 'nope' } });
    if (u.pathname === '/v2/user') return reply(200, { user: { username: 'suhani' } });
    if (u.pathname === '/v2/files') return reply(200, {});
    if (u.pathname === '/v13/deployments') return reply(200, { id: 'dpl_1', url: 'forge-abc.vercel.app', readyState: 'QUEUED' });
    if (u.pathname.startsWith('/v13/deployments/')) return reply(200, { id: 'dpl_1', url: 'forge-abc.vercel.app', readyState: states[Math.min(poll++, states.length - 1)] });
    return reply(404, {});
  };
  const ctx = { env: { VERCEL_TOKEN: 'x'.repeat(24), VERCEL_TEAM_ID: 'team_abc' }, fetch: fetchFn, project: 'harbor-home' };
  return { ctx, calls };
}

test('vercel: a preview deploy uploads each file by digest, then waits until it is ready', async () => {
  const { ctx, calls } = fakeVercel();
  const out = await vercel.create(ctx, { pollMs: 1 }).deployPreview({ dir: builtSite() });
  assert.deepEqual(out, { id: 'dpl_1', url: 'https://forge-abc.vercel.app', target: 'preview', files: 4 });

  const uploads = calls.filter((c) => c.path === '/v2/files');
  assert.equal(uploads.length, 4);
  assert.match(uploads[0].headers['x-vercel-digest'], /^[0-9a-f]{40}$/);
  assert.ok(calls.every((c) => c.query.includes('teamId=team_abc')));
  assert.ok(calls.every((c) => c.headers?.Authorization === `Bearer ${'x'.repeat(24)}` || c.method === 'GET'));
  const body = JSON.parse(calls.find((c) => c.path === '/v13/deployments').body);
  assert.equal(body.name, 'harbor-home');
  assert.equal(body.target, undefined, 'a preview has no production target');
  assert.deepEqual(body.files.map((f) => f.file).sort(), ['404.html', 'about/index.html', 'index.html', 'style.css']);
});

test('vercel: production sets the target; errors map to typed errors', async () => {
  const prod = fakeVercel({ states: ['READY'] });
  assert.equal((await vercel.create(prod.ctx, { pollMs: 1 }).deployProduction({ dir: builtSite() })).target, 'production');
  assert.equal(JSON.parse(prod.calls.find((c) => c.path === '/v13/deployments').body).target, 'production');

  await assert.rejects(vercel.create(fakeVercel({ states: ['ERROR'] }).ctx, { pollMs: 1 }).deployPreview({ dir: builtSite() }), Unavailable);
  await assert.rejects(vercel.create(fakeVercel({ status: { '/v2/files': 429 } }).ctx).deployPreview({ dir: builtSite() }), RateLimited);
  await assert.rejects(vercel.healthCheck(fakeVercel({ status: { '/v2/user': 401 } }).ctx), AuthFailed);
  await assert.rejects(vercel.create(fakeVercel().ctx).deployPreview({ dir: tmp() }), ConfigMissing);
  assert.deepEqual(await vercel.healthCheck(fakeVercel().ctx), { ok: true, detail: 'signed in as suhani' });
  await assert.rejects(
    vercel.create(fakeVercel({ states: ['BUILDING'] }).ctx, { pollMs: 1, readyTimeoutMs: 20 }).deployPreview({ dir: builtSite() }),
    /was not ready/,
  );
});

test('vercel through the host: a preview needs B5 and production also needs B7', async () => {
  const root = tmp('forge-root-');
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: { vercel: true } }));
  const dirs = [join(process.cwd(), 'plugins')];
  const { project, opts } = newProject();
  const plugin = await getPlugin('vercel', { root, dirs, mock: true, project, ...opts, env: {} });

  await assert.rejects(plugin.actions.deployPreview(), PermissionDenied);
  approve(project, 'B5', opts);
  assert.match((await plugin.actions.deployPreview()).url, /vercel\.app$/);
  await assert.rejects(plugin.actions.deployProduction(), /B7 not recorded/);
  assert.equal(ledger.read(project, opts).at(-1).type, 'refusal');
  approve(project, 'B7', opts);
  assert.equal((await plugin.actions.deployProduction()).target, 'production');

  const health = await healthCheck('vercel', { root, dirs, env: {} });
  assert.deepEqual([health.ok, health.code], [false, 'CONFIG_MISSING'], 'no token, no health');
});

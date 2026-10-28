import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigInvalid, ConfigMissing, PermissionDenied, SchemaInvalid } from '../../src/core/errors.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import {
  approvalsFor,
  disablePlugin,
  discoverPlugins,
  enablePlugin,
  getPlugin,
  healthCheck,
  listPlugins,
} from '../../src/core/plugins.mjs';
import { approve } from '../../src/core/project.mjs';
import { newProject } from './helpers.mjs';

const manifest = (id, over = {}) => ({
  id,
  category: 'deploy',
  version: '0.1.0',
  enabledByDefault: false,
  env: [],
  permissions: { network: [], filesystem: 'none', actions: ['read'] },
  cost: { paid: false },
  docs: `docs/plugins.md#${id}`,
  status: 'implemented-tested',
  ...over,
});

// A harness root with its own forge.config.json, .env and plugins folder.
function harness(plugins, { config = {}, env = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forge-plugins-'));
  const dir = join(root, 'plugins');
  for (const [id, files] of Object.entries(plugins)) {
    mkdirSync(join(dir, id), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, id, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
  }
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: {}, ...config }));
  writeFileSync(join(root, '.env'), env);
  return { root, dirs: [dir], env: {} };
}

const VERCEL_INDEX = `
export const actionKinds = { deployPreview: 'deploy', deployProduction: 'deploy', spendCredits: 'spend', status: 'read' };
export const actionApprovals = { deployPreview: ['B5'], deployProduction: ['B5', 'B7'] };
export const configSchema = { type: 'object', properties: { VERCEL_TOKEN: { type: 'string', minLength: 10 } } };
export async function healthCheck(ctx) { return { ok: true, detail: 'token present (' + Object.keys(ctx.env).join(',') + ')' }; }
export async function status() { return 'ready'; }
export async function deployPreview(dir) { return { url: 'https://preview.example', dir }; }
export async function deployProduction() { return { url: 'https://prod.example' }; }
export async function spendCredits() { return 'spent'; }
export async function boom() { throw new Error('socket hang up'); }
`;

const vercel = () => ({
  'plugin.json': manifest('vercel', {
    env: [{ name: 'VERCEL_TOKEN', required: true, secret: true }],
    permissions: { network: ['api.vercel.com'], filesystem: 'project-read', actions: ['read', 'deploy'] },
    approvals: ['B5', 'B7'],
  }),
  'index.mjs': VERCEL_INDEX,
  'mock.mjs': `export async function status() { return 'mock-ready'; }\nexport async function deployPreview() { return { url: 'https://mock.example' }; }`,
});

test('plugins are discovered from their folders and off by default', () => {
  const h = harness({ vercel: vercel() }, { env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  assert.deepEqual([...discoverPlugins(h).keys()], ['vercel']);
  const [p] = listPlugins(h);
  assert.deepEqual([p.id, p.enabled, p.paid, p.hasMock, p.missingEnv], ['vercel', false, false, true, []]);
});

test('a bad manifest, a renamed folder or a duplicate id is a schema error', () => {
  assert.throws(() => discoverPlugins(harness({ bad: { 'plugin.json': manifest('bad', { enabledByDefault: true }) } })), SchemaInvalid);
  assert.throws(() => discoverPlugins(harness({ other: { 'plugin.json': manifest('nope') } })), /must match its folder/);
  const a = harness({ dup: { 'plugin.json': manifest('dup') } });
  assert.throws(() => discoverPlugins({ dirs: [a.dirs[0], a.dirs[0]] }), /defined twice/);
});

test('a disabled plugin is refused with the command that enables it', async () => {
  const h = harness({ vercel: vercel() }, { env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  await assert.rejects(getPlugin('vercel', h), (e) => e instanceof PermissionDenied && /forge plugins enable vercel/.test(e.hint));
  await assert.rejects(getPlugin('ghost', h), ConfigMissing);
});

test('a missing credential is ConfigMissing naming the variable, never a value', async () => {
  const h = harness({ vercel: vercel() }, { config: { plugins: { vercel: true } } });
  await assert.rejects(getPlugin('vercel', h), (e) => e instanceof ConfigMissing && /VERCEL_TOKEN/.test(e.message) && e.details.missing[0] === 'VERCEL_TOKEN');
  assert.deepEqual(listPlugins(h)[0].missingEnv, ['VERCEL_TOKEN']);
});

test('settings that fail the config schema are ConfigInvalid without echoing the secret', async () => {
  const h = harness({ vercel: vercel() }, { config: { plugins: { vercel: true } }, env: 'VERCEL_TOKEN=short\n' });
  await assert.rejects(getPlugin('vercel', h), (e) => e instanceof ConfigInvalid && /VERCEL_TOKEN/.test(e.message) && !/short/.test(e.message));
});

test('enable runs the health check, then switches the plugin on in forge.config.json', async () => {
  const h = harness({ vercel: vercel() }, { env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  const { health } = await enablePlugin('vercel', h);
  assert.match(health.detail, /token present \(VERCEL_TOKEN\)/);
  assert.equal(JSON.parse(readFileSync(join(h.root, 'forge.config.json'), 'utf8')).plugins.vercel, true);
  disablePlugin('vercel', h);
  assert.equal(JSON.parse(readFileSync(join(h.root, 'forge.config.json'), 'utf8')).plugins.vercel, false);
});

test('enable refuses a plugin whose health check fails, and records the refusal for a project', async () => {
  const { project, opts } = newProject();
  const h = harness({
    sick: { 'plugin.json': manifest('sick'), 'index.mjs': 'export async function healthCheck() { return { ok: false, detail: "service is down" }; }' },
  });
  await assert.rejects(enablePlugin('sick', { ...h, project, ...opts }), /was not enabled: service is down/);
  assert.equal(JSON.parse(readFileSync(join(h.root, 'forge.config.json'), 'utf8')).plugins.sick, undefined);
  assert.deepEqual(ledger.read(project, opts).at(-1).data, { action: 'plugins enable sick', reason: 'service is down' });
});

test('a health check that hangs or throws is reported, never thrown', async () => {
  const h = harness({
    slow: { 'plugin.json': manifest('slow'), 'index.mjs': 'export function healthCheck() { return new Promise(() => {}); }' },
    crash: { 'plugin.json': manifest('crash'), 'index.mjs': 'export function healthCheck() { throw new Error("kaput"); }' },
  });
  const slow = await healthCheck('slow', { ...h, timeoutMs: 50 });
  assert.deepEqual([slow.ok, slow.code], [false, 'UNAVAILABLE']);
  const crash = await healthCheck('crash', h);
  assert.deepEqual([crash.ok, crash.detail], [false, 'kaput']);
});

test('gated actions need the project approvals; refusals are recorded and calls are logged', async () => {
  const { project, opts } = newProject();
  const h = harness({ vercel: vercel() }, { config: { plugins: { vercel: true } }, env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  const { actions } = await getPlugin('vercel', { ...h, project, ...opts });
  const last = () => ledger.read(project, opts).at(-1);

  await assert.rejects(actions.status(), PermissionDenied, 'an integration needs B5 even to read');
  assert.deepEqual(last().data, { action: 'vercel.status', reason: 'B5 not recorded' });

  approve(project, 'B5', opts);
  assert.equal(await actions.status(), 'ready');
  assert.deepEqual((({ plugin, action, kind, ok }) => ({ plugin, action, kind, ok }))(last().data), { plugin: 'vercel', action: 'status', kind: 'read', ok: true });
  assert.equal((await actions.deployPreview('site/dist')).url, 'https://preview.example');

  await assert.rejects(actions.deployProduction(), /B7 not recorded/);
  assert.equal(last().type, 'refusal');
  approve(project, 'B7', opts);
  assert.equal((await actions.deployProduction()).url, 'https://prod.example');

  await assert.rejects(actions.spendCredits(), /spend action, which the manifest does not allow/);
  await assert.rejects(actions.boom(), (e) => e.code === 'UNAVAILABLE' && /socket hang up/.test(e.message));
  assert.deepEqual([last().data.ok, last().data.code], [false, 'UNAVAILABLE']);
});

test('a gated action outside a project is refused', async () => {
  const h = harness({ vercel: vercel() }, { config: { plugins: { vercel: true } }, env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  const { actions } = await getPlugin('vercel', h);
  await assert.rejects(actions.deployPreview(), /must run for a project/);
});

test('mock mode loads mock.mjs and needs no credentials', async () => {
  const h = harness({ vercel: vercel() }, { config: { plugins: { vercel: true } } });
  const { project, opts } = newProject();
  approve(project, 'B5', opts);
  const plugin = await getPlugin('vercel', { ...h, mock: true, project, ...opts });
  assert.equal(await plugin.actions.status(), 'mock-ready');
  assert.equal((await plugin.actions.deployPreview()).url, 'https://mock.example');
  assert.equal(ledger.read(project, opts).at(-1).data.mock, true);

  const noMock = harness({ local: { 'plugin.json': manifest('local'), 'index.mjs': 'export const x = () => 1;' } }, { config: { plugins: { local: true } } });
  await assert.rejects(getPlugin('local', { ...noMock, mock: true }), /no mock.mjs/);
});

test('a plugin can only fetch the hosts its manifest declares, and sees only its own variables', async () => {
  const h = harness(
    {
      net: {
        'plugin.json': manifest('net', { env: [{ name: 'NET_KEY', required: false }], permissions: { network: ['api.example.com', '*.cdn.example'], filesystem: 'none', actions: ['read'] } }),
        'index.mjs': 'export function create(ctx) { return { call: (url) => ctx.fetch(url), env: () => ctx.env }; }',
      },
    },
    { config: { plugins: { net: true } }, env: 'NET_KEY=k1\nOTHER_SECRET=s2\n' },
  );
  const { actions } = await getPlugin('net', h);
  await assert.rejects(actions.call('https://evil.example/x'), (e) => e instanceof PermissionDenied && /may not call evil.example/.test(e.message));
  assert.deepEqual(await actions.env(), { NET_KEY: 'k1' });
});

test('default approvals: deploy and spend need every listed approval, other actions only B5', () => {
  const m = manifest('x', { approvals: ['B4', 'B5', 'B7'], permissions: { network: [], filesystem: 'none', actions: ['read', 'deploy', 'spend'] } });
  const mod = { actionKinds: { ship: 'deploy', buy: 'spend' }, actionApprovals: { preview: ['B5'] } };
  assert.deepEqual(approvalsFor(m, mod, 'ship'), ['B4', 'B5', 'B7']);
  assert.deepEqual(approvalsFor(m, mod, 'buy'), ['B4', 'B5', 'B7']);
  assert.deepEqual(approvalsFor(m, mod, 'look'), ['B5']);
  assert.deepEqual(approvalsFor(m, mod, 'preview'), ['B5']);
  assert.deepEqual(approvalsFor(manifest('y'), {}, 'look'), []);
});

test('a local tool with no approvals runs without a project', async () => {
  const h = harness({ tool: { 'plugin.json': manifest('tool', { category: 'testing' }), 'index.mjs': 'export const launch = async () => "browser";' } }, { config: { plugins: { tool: true } } });
  const { actions } = await getPlugin('tool', h);
  assert.equal(await actions.launch(), 'browser');
});

test('forge plugins list, enable, check and disable work on a harness root', async () => {
  const { cmdPlugins, pluginDoctorChecks } = await import('../../src/cli/plugins.mjs');
  const h = harness({ vercel: vercel() }, { env: 'VERCEL_TOKEN=abcdefghijkl\n' });
  const out = [];
  const { log, error } = console;
  console.log = console.error = (...a) => out.push(a.join(' '));
  try {
    assert.equal(await cmdPlugins(h.root, ['list']), 0);
    assert.equal(await cmdPlugins(h.root, ['enable', 'vercel']), 0);
    assert.equal(await cmdPlugins(h.root, ['check']), 0);
    assert.deepEqual((await pluginDoctorChecks(h.root)).map((c) => [c.name, c.status]), [['Plugin vercel', 'ok']]);
    assert.equal(await cmdPlugins(h.root, ['disable', 'vercel']), 0);
    assert.equal(await cmdPlugins(h.root, ['enable']), 2);
  } finally {
    Object.assign(console, { log, error });
  }
  const text = out.join('\n');
  assert.match(text, /off\s+vercel\s+deploy\s+implemented-tested, free, needs B5, B7/);
  assert.match(text, /Enabled vercel/);
  assert.match(text, /OK\s+vercel/);
  assert.ok(!text.includes('abcdefghijkl'), 'the token is never printed');
});

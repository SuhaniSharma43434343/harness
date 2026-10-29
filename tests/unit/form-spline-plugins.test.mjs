import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as form from '../../plugins/form-function/index.mjs';
import { createHandler, webhookForwarder } from '../../plugins/form-function/handler.mjs';
import * as spline from '../../plugins/spline/index.mjs';
import * as vercel from '../../plugins/vercel/index.mjs';
import { ConfigInvalid, ConfigMissing, PermissionDenied } from '../../src/core/errors.mjs';
import { getPlugin, listPlugins } from '../../src/core/plugins.mjs';
import { approve } from '../../src/core/project.mjs';
import { newProject } from './helpers.mjs';

const tmp = (p = 'forge-fs-') => mkdtempSync(join(tmpdir(), p));

// The shape Nidhi's starter writes to site.json.
const FORMS = {
  contact: {
    purpose: 'Get in touch',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'message', label: 'Message', type: 'textarea', required: false },
    ],
  },
};

const post = (handle, body, { form: id = 'contact', type = 'form', ip = '1.2.3.4' } = {}) => {
  const init = { method: 'POST', headers: { 'x-forwarded-for': ip } };
  if (type === 'json') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) fd.append(k, v);
    init.body = fd;
  }
  return handle(new Request(`https://site.example/api/form?form=${id}`, init));
};

test('the form handler checks submissions on the server before forwarding them', async () => {
  const sent = [];
  const handle = createHandler({ forms: FORMS, forward: async (p) => sent.push(p), now: () => Date.UTC(2026, 9, 28) });

  let res = await post(handle, { name: 'Asha', email: 'asha@example.com', message: 'Hello', extra: 'dropped' });
  assert.equal(res.status, 200);
  assert.deepEqual(sent[0], { form: 'contact', fields: { name: 'Asha', email: 'asha@example.com', message: 'Hello' }, receivedAt: '2026-10-28T00:00:00.000Z' });

  res = await post(handle, { name: '', email: 'not-an-email' }, { ip: '5.5.5.5' });
  assert.equal(res.status, 422);
  assert.deepEqual((await res.json()).errors, { name: 'This field is required.', email: 'Enter a valid email address.' });

  assert.equal((await post(handle, { name: 'x'.repeat(5001), email: 'a@b.co' }, { ip: '6.6.6.6' })).status, 422);
  assert.equal((await post(handle, { name: 'A', email: 'a@b.co' }, { form: 'nope' })).status, 404);
  assert.equal((await post(handle, { name: 'A', email: 'a@b.co' }, { type: 'json', ip: '7.7.7.7' })).status, 200, 'JSON bodies work too');
  assert.equal((await handle(new Request('https://site.example/api/form?form=contact'))).status, 405);

  const before = sent.length;
  assert.equal((await post(handle, { name: 'Bot', email: 'b@b.co', _gotcha: 'spam' }, { ip: '8.8.8.8' })).status, 200);
  assert.equal(sent.length, before, 'a filled honeypot is accepted but not forwarded');
});

test('the form handler rate limits each client and reports delivery problems', async () => {
  let t = 0;
  const handle = createHandler({ forms: FORMS, forward: async () => {}, rateLimit: { max: 2, windowMs: 1000 }, now: () => t });
  const ok = { name: 'A', email: 'a@b.co' };
  assert.equal((await post(handle, ok)).status, 200);
  assert.equal((await post(handle, ok)).status, 200);
  assert.equal((await post(handle, ok)).status, 429);
  assert.equal((await post(handle, ok, { ip: '9.9.9.9' })).status, 200, 'another client is not affected');
  t = 2000;
  assert.equal((await post(handle, ok)).status, 200, 'the window moves on');

  assert.equal((await post(createHandler({ forms: FORMS, forward: null }), ok)).status, 503);
  const failing = createHandler({ forms: FORMS, forward: webhookForwarder('https://hook.example', async () => ({ ok: false, status: 500 })) });
  assert.equal((await post(failing, ok)).status, 502);
});

test('install writes a Vercel function into the built site that runs the same checks', async () => {
  const dist = tmp('forge-dist-');
  const out = form.install(dist, { forms: FORMS });
  assert.deepEqual(out.actions, { contact: '/api/form?form=contact' });
  for (const f of out.files) assert.ok(existsSync(join(dist, f)), f);
  assert.ok(!readFileSync(join(dist, 'api', '_forge-forms.mjs'), 'utf8').includes('Get in touch'), 'only what the server needs');

  // Load the generated function and call it like Vercel would.
  const webhook = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      webhook.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.FORM_WEBHOOK_URL = `http://127.0.0.1:${server.address().port}/hook`;
  try {
    const fn = await import(pathToFileURL(join(dist, 'api', 'form.mjs')).href);
    const res = await post(fn.POST, { name: 'Asha', email: 'asha@example.com' });
    assert.equal(res.status, 200);
    assert.deepEqual(webhook[0].fields, { name: 'Asha', email: 'asha@example.com' });
    assert.equal((await fn.GET(new Request('https://site.example/api/form?form=contact'))).status, 405);
  } finally {
    delete process.env.FORM_WEBHOOK_URL;
    await new Promise((r) => server.close(r));
  }
  assert.throws(() => form.install(dist, { forms: {} }), ConfigMissing);
});

test('the local endpoint accepts real form posts and writes them to a file', async () => {
  const file = join(tmp(), 'evidence', 'forms.jsonl');
  const { url, close } = await form.startLocalEndpoint({ forms: FORMS, file });
  try {
    const fd = new FormData();
    fd.append('name', 'Asha');
    fd.append('email', 'asha@example.com');
    const res = await fetch(`${url}?form=contact`, { method: 'POST', body: fd });
    assert.equal(res.status, 200);
    const bad = await fetch(`${url}?form=contact`, { method: 'POST', body: new URLSearchParams({ name: '' }) });
    assert.equal(bad.status, 422);
  } finally {
    await close();
  }
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].fields.email, 'asha@example.com');
});

test('form-function health needs an HTTPS webhook', async () => {
  assert.equal((await form.healthCheck({ env: {} })).ok, false);
  assert.deepEqual(await form.healthCheck({ env: { FORM_WEBHOOK_URL: 'https://hooks.example.com/abc' } }), { ok: true, detail: 'forwards to hooks.example.com' });
});

const SCENE = 'https://prod.spline.design/AbC123-x/scene.splinecode';
const splineCtx = (status = 200, body = 'SCENEBYTES') => ({
  env: {},
  fetch: async (url, init) => ({
    ok: status < 300,
    status,
    headers: new Headers({ 'content-length': String(body.length), 'content-type': 'application/octet-stream' }),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    url,
    method: init?.method,
  }),
});

test('spline checks the scene URL, its size, and can copy it into the site', async () => {
  const s = spline.create(splineCtx());
  assert.deepEqual(await s.checkScene(SCENE), { url: SCENE, bytes: 10, contentType: 'application/octet-stream' });
  const dest = join(tmp(), 'site', 'public', 'scenes');
  assert.deepEqual(await s.downloadScene(SCENE, dest, { name: 'hero' }), { file: 'hero.splinecode', bytes: 10 });
  assert.equal(readFileSync(join(dest, 'hero.splinecode'), 'utf8'), 'SCENEBYTES');

  await assert.rejects(s.checkScene('https://evil.example/scene.splinecode'), ConfigInvalid);
  await assert.rejects(s.checkScene(), ConfigMissing);
  await assert.rejects(spline.create(splineCtx(404)).checkScene(SCENE), /not found/);
  await assert.rejects(s.downloadScene(SCENE, dest, { name: '../x' }), ConfigInvalid);
  assert.equal((await spline.healthCheck({ env: {} })).ok, true);
});

test('vercel can set a project variable such as FORM_WEBHOOK_URL', async () => {
  const calls = [];
  const ctx = {
    env: { VERCEL_TOKEN: 'x'.repeat(24) },
    project: 'harbor-home',
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => '{}' };
    },
  };
  assert.deepEqual(await vercel.create(ctx).setProjectEnv('FORM_WEBHOOK_URL', 'https://hooks.example.com/abc'), { project: 'harbor-home', key: 'FORM_WEBHOOK_URL' });
  assert.match(calls[0].url, /\/v10\/projects\/harbor-home\/env\?upsert=true$/);
  assert.deepEqual(calls[0].body.target, ['production', 'preview']);
  assert.equal(calls[0].body.type, 'encrypted');
  await assert.rejects(vercel.create(ctx).setProjectEnv('bad key', 'v'), ConfigInvalid);
});

test('form-function and spline are discovered, and spline actions need B5 through the host', async () => {
  const ids = listPlugins({ env: {} }).map((p) => p.id);
  for (const id of ['form-function', 'spline']) assert.ok(ids.includes(id), id);

  const root = tmp('forge-root-');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(root, 'forge.config.json'), JSON.stringify({ concurrency: 1, plugins: { spline: true, 'form-function': true } }));
  const dirs = [join(process.cwd(), 'plugins')];
  const { project, opts } = newProject();

  const s = await getPlugin('spline', { root, dirs, mock: true, project, ...opts, env: {} });
  await assert.rejects(s.actions.checkScene(), PermissionDenied);
  approve(project, 'B5', opts);
  assert.equal((await s.actions.checkScene()).bytes, 245760);

  const f = await getPlugin('form-function', { root, dirs, mock: true, env: {} });
  assert.equal(await f.actions.actionFor('contact'), '/api/form?form=contact');
});

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import { loadConfig } from './config.mjs';
import { ConfigInvalid, ConfigMissing, ForgeError, PermissionDenied, SchemaInvalid, Unavailable } from './errors.mjs';
import * as ledger from './ledger.mjs';
import { requireApproval } from './project.mjs';
import { check } from './schemas.mjs';
import { ROOT } from './workspace.mjs';

// The plugin host (T07). A plugin is a folder <dir>/<id>/ with:
//   plugin.json  the manifest (schemas/plugin-manifest.schema.json): off by default, declared
//                env vars, permissions, approvals and cost
//   index.mjs    the adapter: optional `configSchema`, `healthCheck(ctx)`, `actionKinds`,
//                `actionApprovals`, and its actions, either as exported functions or as the
//                object returned by `create(ctx)`
//   mock.mjs     optional: the same actions with recorded responses, used with { mock: true }
//
// getPlugin(id) hands out an enabled plugin whose actions are wrapped: each call is checked
// against the manifest's permissions and the project's recorded approvals, and logged.

// Plugins live in plugins/ (the plan's layout) and src/plugins/ (the test-tool adapters).
export const pluginDirs = (root = ROOT) => [join(root, 'plugins'), join(root, 'src', 'plugins')];

const RESERVED = new Set(['configSchema', 'healthCheck', 'actionKinds', 'actionApprovals', 'create', 'id', 'default']);
const HEALTH_TIMEOUT_MS = 30_000;

export function discoverPlugins({ root = ROOT, dirs = pluginDirs(root) } = {}) {
  const found = new Map();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const folder = join(dir, entry.name);
      const manifestFile = join(folder, 'plugin.json');
      if (!existsSync(manifestFile)) continue;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      } catch (err) {
        throw new SchemaInvalid(`${manifestFile} is not valid JSON`, { hint: err.message });
      }
      const { valid, errors } = check('plugin', manifest);
      if (!valid) throw new SchemaInvalid(`${manifestFile} does not match the plugin manifest schema`, { details: errors });
      if (manifest.id !== entry.name) throw new SchemaInvalid(`${manifestFile}: id "${manifest.id}" must match its folder name "${entry.name}"`);
      if (found.has(manifest.id)) throw new SchemaInvalid(`Plugin "${manifest.id}" is defined twice`, { details: [found.get(manifest.id).folder, folder] });
      found.set(manifest.id, {
        manifest,
        folder,
        index: join(folder, 'index.mjs'),
        mock: existsSync(join(folder, 'mock.mjs')) ? join(folder, 'mock.mjs') : null,
      });
    }
  }
  return found;
}

function findPlugin(id, opts) {
  const plugin = discoverPlugins(opts).get(id);
  if (!plugin) {
    throw new ConfigMissing(`There is no plugin "${id}"`, { hint: 'Run forge plugins list to see the plugins this harness has.' });
  }
  return plugin;
}

// Only the variables the manifest declares are passed on, so a plugin never sees other secrets.
function pluginEnv(manifest, env) {
  const out = {};
  for (const v of manifest.env) if (env[v.name] !== undefined && env[v.name] !== '') out[v.name] = env[v.name];
  return out;
}

export function missingEnv(manifest, env) {
  return manifest.env.filter((v) => v.required && (env[v.name] === undefined || env[v.name] === '')).map((v) => v.name);
}

function hostAllowed(host, patterns) {
  return patterns.some((p) => {
    const [name, port] = p.split(':');
    const [h, hp] = host.split(':');
    if (port && port !== hp) return false;
    if (name.startsWith('*.')) return h.endsWith(name.slice(1)) && h !== name.slice(2);
    return h === name;
  });
}

// fetch limited to the hosts the manifest declares.
function guardedFetch(manifest) {
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (!hostAllowed(url.host, manifest.permissions.network)) {
      return Promise.reject(
        new PermissionDenied(`Plugin "${manifest.id}" may not call ${url.host}`, {
          hint: `Its manifest allows: ${manifest.permissions.network.join(', ') || 'no network'}.`,
        }),
      );
    }
    return fetch(input, init);
  };
}

async function importModule(file) {
  return import(pathToFileURL(file).href);
}

function checkConfig(manifest, mod, env) {
  const missing = missingEnv(manifest, env);
  if (missing.length) {
    throw new ConfigMissing(`Plugin "${manifest.id}" needs ${missing.join(', ')}`, {
      hint: `Add ${missing.join(', ')} to .env (see .env.example). Values are never shown.`,
      details: { missing },
    });
  }
  if (mod.configSchema) {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(mod.configSchema);
    if (!validate(pluginEnv(manifest, env))) {
      // Report which variables are wrong, never their values.
      const fields = [...new Set(validate.errors.map((e) => e.instancePath.replace(/^\//, '') || e.params?.missingProperty || '(config)'))];
      throw new ConfigInvalid(`Plugin "${manifest.id}" has invalid settings: ${fields.join(', ')}`, { hint: 'Check those values in .env.' });
    }
  }
}

function actionKind(mod, name) {
  return mod.actionKinds?.[name] ?? 'read';
}

// Approvals an action needs: the adapter can list them per action; otherwise deploy and spend
// actions need every approval in the manifest, and other actions need B5 when the manifest
// lists it (an external integration).
export function approvalsFor(manifest, mod, name) {
  if (mod.actionApprovals?.[name]) return mod.actionApprovals[name];
  const listed = manifest.approvals ?? [];
  const kind = actionKind(mod, name);
  return kind === 'deploy' || kind === 'spend' ? listed : listed.filter((c) => c === 'B5');
}

function context(manifest, env, extra) {
  return { id: manifest.id, env: pluginEnv(manifest, env), fetch: guardedFetch(manifest), ...extra };
}

// getPlugin(id) => Promise<Plugin>, as agreed in docs/interfaces.md. Throws ConfigMissing for
// an unknown plugin or a missing variable, PermissionDenied for a disabled one.
// opts: { root, dirs, env, project, workspace, mock, actor }
export async function getPlugin(id, opts = {}) {
  const { root = ROOT, mock = false, project, actor = 'cli', ...rest } = opts;
  const loaded = loadConfig(root, rest.env ? { env: rest.env } : {});
  const plugin = findPlugin(id, { root, ...rest });
  const { manifest } = plugin;

  if (loaded.config.plugins[id] !== true) {
    throw new PermissionDenied(`Plugin "${id}" is not enabled`, {
      hint: `Run forge plugins enable ${id}. Until then its feature uses the documented fallback.`,
    });
  }
  const file = mock ? plugin.mock : plugin.index;
  if (!file || !existsSync(file)) {
    throw new ConfigMissing(`Plugin "${id}" has no ${mock ? 'mock.mjs' : 'index.mjs'}`, {
      hint: mock ? 'Mock mode needs recorded responses for every action.' : 'The plugin is not implemented yet.',
    });
  }
  const mod = await importModule(file);
  const indexMod = mock ? await importModule(plugin.index).catch(() => mod) : mod;
  if (!mock) checkConfig(manifest, mod, loaded.env);

  const ctx = context(manifest, loaded.env, { mock, project });
  const source = typeof mod.create === 'function' ? await mod.create(ctx) : mod;
  const names = Object.keys(source).filter((k) => typeof source[k] === 'function' && !RESERVED.has(k));
  const ledgerOpts = rest.workspace ? { workspace: rest.workspace } : {};

  const actions = {};
  for (const name of names) {
    actions[name] = async (...args) => {
      const kind = actionKind(indexMod, name);
      const action = `${id}.${name}`;
      if (kind !== 'read' && !manifest.permissions.actions.includes(kind)) {
        throw new PermissionDenied(`${action} is a ${kind} action, which the manifest does not allow`);
      }
      const needs = approvalsFor(manifest, indexMod, name);
      if (needs.length && !project) {
        throw new PermissionDenied(`${action} needs ${needs.join(', ')}, so it must run for a project`);
      }
      for (const code of needs) requireApproval(project, code, action, { actor, ...ledgerOpts });

      const started = Date.now();
      try {
        const out = await source[name](...args);
        if (project) ledger.append(project, { actor, type: 'plugin_call', data: { plugin: id, action: name, kind, ok: true, mock, ms: Date.now() - started } }, ledgerOpts);
        return out;
      } catch (err) {
        const typed = err instanceof ForgeError ? err : new Unavailable(`${action} failed: ${err?.message ?? err}`);
        if (project) ledger.append(project, { actor, type: 'plugin_call', data: { plugin: id, action: name, kind, ok: false, mock, code: typed.code, ms: Date.now() - started } }, ledgerOpts);
        throw typed;
      }
    };
  }
  return { id, manifest, mock, actions };
}

// Runs a plugin's health check with a time limit. Resolves { ok, detail } and never throws:
// a failure becomes ok: false with the typed error's code and hint.
export async function healthCheck(id, opts = {}) {
  const { root = ROOT, ...rest } = opts;
  try {
    const plugin = findPlugin(id, { root, ...rest });
    const mod = await importModule(plugin.index);
    const loaded = loadConfig(root, rest.env ? { env: rest.env } : {});
    checkConfig(plugin.manifest, mod, loaded.env);
    if (typeof mod.healthCheck !== 'function') return { ok: true, detail: 'no health check defined' };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Unavailable(`Health check for "${id}" took longer than ${HEALTH_TIMEOUT_MS / 1000}s`)), rest.timeoutMs ?? HEALTH_TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([mod.healthCheck(context(plugin.manifest, loaded.env, {})), timeout]);
      return res?.ok === false ? { ok: false, detail: res.detail ?? 'health check failed' } : { ok: true, detail: res?.detail ?? 'healthy' };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const typed = err instanceof ForgeError ? err : new Unavailable(String(err?.message ?? err));
    return { ok: false, code: typed.code, detail: typed.message, hint: typed.hint };
  }
}

function writePluginFlag(root, id, on) {
  const file = join(root, 'forge.config.json');
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : JSON.parse(readFileSync(join(ROOT, 'forge.config.example.json'), 'utf8'));
  current.plugins = { ...(current.plugins ?? {}), [id]: on };
  writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
}

// forge plugins enable: the config must be complete and the health check must pass before the
// plugin is switched on. With a project, the decision is recorded in its ledger.
export async function enablePlugin(id, opts = {}) {
  const { root = ROOT, project, workspace } = opts;
  const plugin = findPlugin(id, opts);
  const health = await healthCheck(id, opts);
  const ledgerOpts = workspace ? { workspace } : {};
  if (!health.ok) {
    if (project) ledger.append(project, { actor: 'operator', type: 'refusal', data: { action: `plugins enable ${id}`, reason: health.detail } }, ledgerOpts);
    const Err = health.code === 'CONFIG_MISSING' ? ConfigMissing : health.code === 'CONFIG_INVALID' ? ConfigInvalid : Unavailable;
    throw new Err(`Plugin "${id}" was not enabled: ${health.detail}`, { hint: health.hint });
  }
  writePluginFlag(root, id, true);
  if (project) ledger.append(project, { actor: 'operator', type: 'note', data: { message: `Plugin ${id} enabled`, plugin: id, paid: plugin.manifest.cost.paid } }, ledgerOpts);
  return { id, health, manifest: plugin.manifest };
}

export function disablePlugin(id, opts = {}) {
  const { root = ROOT } = opts;
  findPlugin(id, opts);
  writePluginFlag(root, id, false);
  return { id };
}

export function listPlugins(opts = {}) {
  const { root = ROOT, ...rest } = opts;
  const loaded = loadConfig(root, rest.env ? { env: rest.env } : {});
  return [...discoverPlugins({ root, ...rest }).values()]
    .map(({ manifest, mock }) => ({
      id: manifest.id,
      category: manifest.category,
      status: manifest.status ?? 'planned',
      enabled: loaded.config.plugins[manifest.id] === true,
      paid: manifest.cost.paid,
      approvals: manifest.approvals ?? [],
      missingEnv: missingEnv(manifest, loaded.env),
      hasMock: Boolean(mock),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

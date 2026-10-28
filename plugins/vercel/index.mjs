import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthFailed, ConfigInvalid, ConfigMissing, RateLimited, Unavailable } from '../../src/core/errors.mjs';
import { walk } from '../../src/core/glob.mjs';

// Vercel deploys of a built static site through the REST API: each file is uploaded by its
// SHA-1, then a deployment is created from the list and polled until it is ready. A preview
// needs B5 (an external integration); production also needs B7.

export const actionKinds = { deployPreview: 'deploy', deployProduction: 'deploy', getDeployment: 'read', setProjectEnv: 'write' };
export const actionApprovals = { deployPreview: ['B5'], deployProduction: ['B5', 'B7'], getDeployment: ['B5'], setProjectEnv: ['B5'] };
export const configSchema = {
  type: 'object',
  properties: {
    VERCEL_TOKEN: { type: 'string', minLength: 20 },
    VERCEL_TEAM_ID: { type: 'string', pattern: '^team_[A-Za-z0-9]+$' },
    VERCEL_PROJECT: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,99}$' },
  },
};

const API = 'https://api.vercel.com';
const POLL_MS = 2000;
const READY_TIMEOUT_MS = 5 * 60_000;

function client(ctx) {
  const team = ctx.env.VERCEL_TEAM_ID ? `teamId=${encodeURIComponent(ctx.env.VERCEL_TEAM_ID)}` : '';
  const url = (path) => `${API}${path}${team ? (path.includes('?') ? '&' : '?') + team : ''}`;
  return async function call(path, { method = 'GET', headers = {}, body } = {}) {
    const res = await ctx.fetch(url(path), {
      method,
      headers: { Authorization: `Bearer ${ctx.env.VERCEL_TOKEN}`, ...headers },
      body,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (res.ok) return data;
    const message = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new AuthFailed(`Vercel refused the token: ${message}`, { hint: 'Create a new token in Vercel and update VERCEL_TOKEN in .env.' });
    if (res.status === 429) throw new RateLimited(`Vercel rate limit: ${message}`, { hint: 'Wait a few minutes and try again.' });
    if (res.status >= 500) throw new Unavailable(`Vercel is unavailable: ${message}`);
    throw new ConfigInvalid(`Vercel rejected the request: ${message}`);
  };
}

export async function healthCheck(ctx) {
  const user = await client(ctx)('/v2/user');
  return { ok: true, detail: `signed in as ${user?.user?.username ?? 'a Vercel user'}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function create(ctx, { pollMs = POLL_MS, readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
  const call = client(ctx);

  async function deploy({ dir, name, target }) {
    const files = walk(dir).map((file) => {
      const data = readFileSync(join(dir, file));
      return { file, data, sha: createHash('sha1').update(data).digest('hex'), size: data.length };
    });
    if (!files.some((f) => f.file === 'index.html')) {
      throw new ConfigMissing(`There is no built site in ${dir}`, { hint: 'Build the site first; the deploy uploads its output folder.' });
    }
    for (const f of files) {
      await call('/v2/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-vercel-digest': f.sha, 'Content-Length': String(f.size) },
        body: f.data,
      });
    }
    const project = ctx.env.VERCEL_PROJECT ?? name ?? ctx.project;
    if (!project) throw new ConfigMissing('No Vercel project name', { hint: 'Set VERCEL_PROJECT in .env or deploy for a Forge project.' });
    const body = {
      name: project,
      files: files.map(({ file, sha, size }) => ({ file, sha, size })),
      projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
    };
    if (target === 'production') body.target = 'production';
    let dep = await call('/v13/deployments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    const started = Date.now();
    while (!['READY', 'ERROR', 'CANCELED'].includes(dep.readyState)) {
      if (Date.now() - started > readyTimeoutMs) throw new Unavailable(`Vercel deployment ${dep.id} was not ready after ${readyTimeoutMs / 60000} minutes`);
      await sleep(pollMs);
      dep = await call(`/v13/deployments/${encodeURIComponent(dep.id)}`);
    }
    if (dep.readyState !== 'READY') throw new Unavailable(`Vercel deployment ${dep.id} ended as ${dep.readyState}`);
    return { id: dep.id, url: `https://${dep.url}`, target: target ?? 'preview', files: files.length };
  }

  return {
    deployPreview: ({ dir, name } = {}) => deploy({ dir, name }),
    deployProduction: ({ dir, name } = {}) => deploy({ dir, name, target: 'production' }),
    // Sets an environment variable on the Vercel project, for preview and production (for
    // example FORM_WEBHOOK_URL for the form function). The value is stored encrypted.
    setProjectEnv: async (key, value, { name } = {}) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key ?? '')) throw new ConfigInvalid(`"${key}" is not a valid variable name`);
      const project = ctx.env.VERCEL_PROJECT ?? name ?? ctx.project;
      if (!project) throw new ConfigMissing('No Vercel project name', { hint: 'Set VERCEL_PROJECT in .env or run it for a Forge project.' });
      await call(`/v10/projects/${encodeURIComponent(project)}/env?upsert=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, type: 'encrypted', target: ['production', 'preview'] }),
      });
      return { project, key };
    },
    getDeployment: async (id) => {
      const dep = await call(`/v13/deployments/${encodeURIComponent(id)}`);
      return { id: dep.id, url: `https://${dep.url}`, readyState: dep.readyState };
    },
  };
}

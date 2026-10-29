import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigInvalid, ConfigMissing, Unavailable } from '../../src/core/errors.mjs';

// Spline runtime embedding (Release 1.0; the Spline API is future work). The operator exports a
// scene from their own Spline account as a public .splinecode URL. This plugin checks that the
// scene is reachable and how large it is (APP-04 loads it after LCP within a budget), and can
// copy it into the site so the runtime loads it from the site's own origin.

export const actionKinds = { checkScene: 'read', downloadScene: 'write', sceneUrl: 'read' };

const SCENE = /^https:\/\/prod\.spline\.design\/[A-Za-z0-9_-]+\/scene\.splinecode$/;
const MAX_BYTES = 50 * 1024 * 1024;

function assertSceneUrl(url) {
  if (!url) throw new ConfigMissing('No Spline scene URL', { hint: 'Set the brief’s features.splineSceneUrl, or SPLINE_SCENE_URL in .env.' });
  if (!SCENE.test(url)) {
    throw new ConfigInvalid('That is not a Spline scene export URL', { hint: 'Export the scene for the web in Spline and copy the URL ending in /scene.splinecode.' });
  }
  return url;
}

async function get(ctx, url, method = 'GET') {
  let res;
  try {
    res = await ctx.fetch(url, { method });
  } catch (err) {
    if (err?.code) throw err;
    throw new Unavailable(`Could not reach Spline: ${err?.message ?? err}`);
  }
  if (res.status === 404 || res.status === 403) {
    throw new ConfigInvalid(`The Spline scene was not found (HTTP ${res.status})`, { hint: 'Check that the scene is exported and public in Spline.' });
  }
  if (!res.ok) throw new Unavailable(`Spline answered HTTP ${res.status}`);
  return res;
}

export async function healthCheck(ctx) {
  if (!ctx.env.SPLINE_SCENE_URL) return { ok: true, detail: 'no default scene set; projects give their own scene URL' };
  const { bytes } = await create(ctx).checkScene();
  return { ok: true, detail: `default scene reachable (${Math.round(bytes / 1024)} KB)` };
}

export function create(ctx) {
  const pick = (url) => assertSceneUrl(url ?? ctx.env.SPLINE_SCENE_URL);
  return {
    sceneUrl: (url) => pick(url),

    // { url, bytes, contentType }: bytes is null when Spline does not say the size.
    checkScene: async (url) => {
      const scene = pick(url);
      const res = await get(ctx, scene, 'HEAD');
      const length = Number(res.headers.get('content-length'));
      return { url: scene, bytes: Number.isFinite(length) && length > 0 ? length : null, contentType: res.headers.get('content-type') };
    },

    // Saves the scene as <destDir>/<name>.splinecode and returns its site-relative path and size.
    downloadScene: async (url, destDir, { name = 'scene' } = {}) => {
      const scene = pick(url);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new ConfigInvalid(`"${name}" is not a valid scene file name`);
      const res = await get(ctx, scene);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_BYTES) throw new ConfigInvalid(`The scene is ${Math.round(data.length / 1048576)} MB, over the ${MAX_BYTES / 1048576} MB limit`);
      mkdirSync(destDir, { recursive: true });
      const file = `${name}.splinecode`;
      writeFileSync(join(destDir, file), data);
      return { file, bytes: data.length };
    },
  };
}

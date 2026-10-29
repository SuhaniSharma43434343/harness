import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigMissing, PermissionDenied } from '../core/errors.mjs';
import { getPlugin } from '../core/plugins.mjs';
import { applyApproach } from './apply.mjs';

const SCENE_CONFIG = join('src', 'lib', 'app04', 'scene.json');
const writeScene = (siteDir, value) => writeFileSync(join(siteDir, SCENE_CONFIG), JSON.stringify(value, null, 2) + '\n');

// APP-04 Spline + Website (T20): an embedded Spline scene from the operator's own scene URL,
// lazy-loaded after the page behind a poster, with scene events wired to the page.
// Fallback: the poster (the registry names APP-03's scene first; that module is not built yet).
// The scene comes through the spline plugin (T08): fetchScene checks it and copies it into the
// site, and SplineScene uses it unless a page gives its own scene prop. Without the plugin or a
// scene URL the section is the poster alone ('plugin-missing').
export default {
  id: 'APP-04',
  name: 'Spline + Website',
  recipes: 'skills/app04/recipes',
  sections: ['SplineScene'],
  packages: [
    { name: '@splinetool/runtime', version: '2.0.79', licence: 'Spline terms of service (npm lists no licence)', licenceVerified: false, note: 'Review the runtime and account terms before release.' },
  ],
  fallback: { approach: 'APP-03', description: 'APP-03 scene or a poster image', triggers: ['plugin-missing', 'no-webgl', 'reduced-motion', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: the runtime loads after LCP; its size is measured and budgeted per project.
  budget: { loadAfterLcp: true },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },

  // fetchScene(siteDir, { project, url, workspace, mock, root }) => { scene, bytes } | { scene: null, fallback, reason }
  // Copies the operator's scene into public/spline/ through the spline plugin and records it in
  // src/lib/app04/scene.json. A disabled or unconfigured plugin, or no scene URL, is not an
  // error: the site keeps the poster and the reason is returned. A bad or missing scene throws.
  async fetchScene(siteDir, { url, ...opts } = {}) {
    let plugin;
    try {
      plugin = await getPlugin('spline', opts);
      url = plugin.actions.sceneUrl ? await plugin.actions.sceneUrl(url) : url;
    } catch (err) {
      if (!(err instanceof PermissionDenied || err instanceof ConfigMissing)) throw err;
      writeScene(siteDir, { scene: null });
      return { scene: null, fallback: 'plugin-missing', reason: err.message };
    }
    const { file, bytes } = await plugin.actions.downloadScene(url, join(siteDir, 'public', 'spline'));
    const scene = `/spline/${file}`;
    writeScene(siteDir, { scene, source: url, bytes });
    return { scene, bytes };
  },
};

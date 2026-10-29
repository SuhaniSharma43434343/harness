import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigInvalid, ConfigMissing } from '../core/errors.mjs';
import { applyApproach } from './apply.mjs';

// APP-03 Interactive 3D (T12): a lazy-loaded Three.js scene (a glTF model, or a procedural object
// in the token colours) with drag, keyboard and scroll interaction, behind a poster.
// Fallback: the poster with a CSS depth tilt.
const app03 = {
  id: 'APP-03',
  name: 'Interactive 3D',
  recipes: 'skills/app03/recipes',
  sections: ['Scene3D'],
  packages: [{ name: 'three', version: '0.186.1', licence: 'MIT', licenceVerified: true, note: 'MIT as listed on npm. Each model needs its own register row.' }],
  fallback: { approach: 'APP-01', description: 'Poster image plus CSS depth', triggers: ['reduced-motion', 'no-webgl', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: the poster is the LCP; at most 250 KB of JavaScript (gzip) and 3 MB of assets,
  // loaded after LCP; 30 fps on a mid-range phone.
  budget: { extraJsBytes: 250 * 1024, assetBytes: 3 * 1024 * 1024, minFps: 30, loadAfterLcp: true },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },
};
export default app03;

// Checks a model file against the asset budget and records its licence. Every model needs a row.
// model: { file (on disk), path (as the site serves it), source, licence, evidence? }
export function registerModel(projectDir, model) {
  if (!model?.file || !existsSync(model.file)) throw new ConfigMissing(`No model at ${model?.file}`);
  if (!model.source || !model.licence) throw new ConfigInvalid('A model needs its source and licence', { hint: 'Pass { source, licence } for the model.' });
  const bytes = statSync(model.file).size;
  if (bytes > app03.budget.assetBytes) {
    throw new ConfigInvalid(`The model is ${(bytes / 1048576).toFixed(1)} MB, over the 3 MB budget`, { hint: 'Compress it (meshopt or Draco, smaller textures) before adding it.' });
  }
  const file = join(projectDir, 'assets', 'register.json');
  const register = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { assets: [] };
  register.assets ??= [];
  if (!register.assets.some((r) => r.path === model.path)) {
    register.assets.push({ path: model.path, usage: 'APP-03 model', source: model.source, licence: model.licence, status: 'cleared', evidence: model.evidence ?? model.source, bytes });
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(register, null, 2) + '\n');
  return { bytes };
}

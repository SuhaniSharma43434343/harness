import { ConfigMissing } from '../core/errors.mjs';
import app02 from './app02.mjs';
import app04 from './app04.mjs';
import app06 from './app06.mjs';

// Approach modules with code recipes. APP-01 is the starter itself (starters/astro-base), and
// approaches without a module here are not built yet.
// A module: { id, name, recipes, sections, packages, fallback, budget, apply(siteDir, opts) }.
export const MODULES = new Map([app02, app04, app06].map((m) => [m.id, m]));

export function getModule(id) {
  const m = MODULES.get(id);
  if (!m) throw new ConfigMissing(`No approach module for ${id}`, { hint: `Modules: ${[...MODULES.keys()].join(', ')}` });
  return m;
}

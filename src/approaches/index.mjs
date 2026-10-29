import { ConfigMissing } from '../core/errors.mjs';
import app02 from './app02.mjs';
import app03 from './app03.mjs';
import app04 from './app04.mjs';
import app05 from './app05.mjs';
import app06 from './app06.mjs';
import app07 from './app07.mjs';
import app08 from './app08.mjs';

// Approach modules with code recipes. APP-01 is the starter itself (starters/astro-base);
// APP-07 is the composite of APP-02 and APP-03 (and optionally APP-05).
// A module: { id, name, recipes, sections, packages, fallback, budget, apply(siteDir, opts) }.
export const MODULES = new Map([app02, app03, app04, app05, app06, app07, app08].map((m) => [m.id, m]));

export function getModule(id) {
  const m = MODULES.get(id);
  if (!m) throw new ConfigMissing(`No approach module for ${id}`, { hint: `Modules: ${[...MODULES.keys()].join(', ')}` });
  return m;
}

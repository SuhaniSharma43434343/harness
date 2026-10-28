import { applyApproach } from './apply.mjs';

// APP-04 Spline + Website (T20): an embedded Spline scene from the operator's own scene URL or
// file, lazy-loaded after the page behind a poster, with scene events wired to the page.
// Fallback: the poster (the registry names APP-03's scene first; that module is not built yet).
// The Spline plugin (T08) will supply the scene from the operator's account; until it exists,
// the scene URL is a section prop and a missing one is the 'plugin-missing' fallback.
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
};

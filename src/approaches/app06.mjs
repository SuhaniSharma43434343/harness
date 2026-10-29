import { applyApproach } from './apply.mjs';

// APP-06 Game-Like Website (T20): one bounded mechanic (collect an item to open it) in Phaser,
// with keyboard and touch controls, progress kept for the visit, optional synthesised sound
// (no audio files, so no audio licences) and a skip control. Phaser's own vector maths stands in
// for a physics library: the mechanic needs only distance checks. Fallback: the explainer
// section with the same content, always in the page.
export default {
  id: 'APP-06',
  name: 'Game-Like',
  recipes: 'skills/app06/recipes',
  sections: ['Game'],
  packages: [{ name: 'phaser', version: '4.2.1', licence: 'MIT', licenceVerified: true, note: 'MIT as listed on npm.' }],
  fallback: { approach: 'APP-01', description: 'An interactive explainer section with the same content', triggers: ['no-webgl', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: lazy-loaded, at most 400 KB of JavaScript (gzip), at least 30 fps on a mid-range phone.
  budget: { extraJsBytes: 400 * 1024, minFps: 30, loadAfterLcp: true },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },
};

import { applyApproach } from './apply.mjs';

// APP-05 Shader / WebGL (T12): a GLSL background section with a quality ladder (full, reduced,
// off), drawn with plain WebGL and our own shaders, so it adds no package and no licence.
// Fallback: the CSS gradient underneath, or one still frame for reduced motion.
export default {
  id: 'APP-05',
  name: 'Shader / WebGL',
  recipes: 'skills/app05/recipes',
  sections: ['ShaderBackground'],
  packages: [],
  fallback: { approach: 'APP-01', description: 'CSS gradient or a static frame', triggers: ['reduced-motion', 'no-webgl', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: at most 80 KB of JavaScript (gzip) and 8 ms of GPU time a frame on a mid-range phone.
  budget: { extraJsBytes: 80 * 1024, gpuMsPerFrame: 8 },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },
};

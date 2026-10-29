import { ConfigInvalid } from '../core/errors.mjs';
import app02 from './app02.mjs';
import app03 from './app03.mjs';
import app05 from './app05.mjs';

// APP-07 AI + 3D + Motion + Real (T12): the composite flagship. It applies APP-02 (cinematic
// scroll) and APP-03 (the 3D scene) to one site, and APP-05 (a shader background) when asked,
// on top of APP-01, and keeps one shared budget across them:
//   - the up-front JavaScript stays within APP-01's budget: every part loads on demand;
//   - the extra JavaScript is at most the sum of the parts' budgets;
//   - one WebGL canvas runs at a time: APP-03 and APP-05 share the webgl-slot registry, so the
//     section most in view runs and the others pause.
// Fallback: drop to APP-01 + APP-02. Each 3D part falls back to its poster or gradient on its
// own, while the cinematic scroll keeps running.
const app07 = {
  id: 'APP-07',
  name: 'AI + 3D + Motion + Real',
  composedOf: ['APP-01', 'APP-02', 'APP-03'],
  optional: ['APP-05'],
  recipes: null,
  sections: [],
  // The packages belong to the parts, which add them when they are applied.
  packages: [],
  partPackages: [...app02.packages, ...app03.packages],
  fallback: { approach: 'APP-02', description: 'APP-01 + APP-02: the 3D parts fall back to their posters', triggers: ['no-webgl', 'reduced-motion', 'low-end-device', 'load-failed', 'slow-network'] },
  budget: {
    extraJsBytes: app02.budget.extraJsBytes + app03.budget.extraJsBytes,
    extraJsBytesWithShader: app02.budget.extraJsBytes + app03.budget.extraJsBytes + app05.budget.extraJsBytes,
    webglCanvases: 1,
  },
  // apply(siteDir, { shader, install, projectDir }) applies each part in turn.
  apply(siteDir, opts = {}) {
    const parts = [app02, app03, ...(opts.shader ? [app05] : [])];
    const files = [];
    const packages = [];
    // Install once, after every part has added its packages.
    parts.forEach((part, i) => {
      const r = part.apply(siteDir, { ...opts, install: i === parts.length - 1 ? opts.install : false });
      files.push(...r.files);
      packages.push(...r.packages);
    });
    return { files, packages, parts: parts.map((p) => p.id) };
  },
};
export default app07;

// checkComposite(report, baseline, { shader }) => { ok, extraJsBytes, problems }
// report and baseline are siteReport() results for the composite site and the same site
// without approaches.
export function checkComposite(report, baseline, { shader = false } = {}) {
  const extra = report.totalJsBytes - baseline.totalJsBytes;
  const limit = shader ? app07.budget.extraJsBytesWithShader : app07.budget.extraJsBytes;
  const problems = [];
  if (!report.withinBudget) problems.push('the up-front JavaScript is over the APP-01 budget; every part must load on demand');
  if (extra > limit) problems.push(`the parts add ${(extra / 1024).toFixed(0)} KB of JavaScript, over the shared ${(limit / 1024).toFixed(0)} KB`);
  return { ok: problems.length === 0, extraJsBytes: extra, limit, problems };
}

export function assertComposite(...args) {
  const r = checkComposite(...args);
  if (!r.ok) throw new ConfigInvalid(`APP-07 is over its shared budget: ${r.problems.join('; ')}`);
  return r;
}

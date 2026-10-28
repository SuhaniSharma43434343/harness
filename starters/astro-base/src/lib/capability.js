// Decides, in the browser, whether an approach module may run its full experience or must use
// its documented fallback (plan: reduced motion, no WebGL, a missing plugin, a low-end device,
// a slow network or a failed load each produce the fallback). Shared by the approach recipes;
// APP-01 never loads it.
//
// capability({ webgl, plugin }) => { full: boolean, reason?: string }
//   webgl: the module needs WebGL. plugin: the module needs a plugin the site may not have
//   (pass false when its configuration is missing).
// ?forge-fallback=<reason> in the URL forces the fallback, for checks and screenshots.
export function capability({ webgl = false, plugin = true } = {}) {
  const forced = new URLSearchParams(location.search).get('forge-fallback');
  if (forced) return { full: false, reason: forced };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { full: false, reason: 'reduced-motion' };
  if (plugin === false) return { full: false, reason: 'plugin-missing' };
  const memory = navigator.deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if ((memory && memory < 4) || (cores && cores < 4)) return { full: false, reason: 'low-end-device' };
  const net = navigator.connection;
  if (net && (net.saveData || ['slow-2g', '2g', '3g'].includes(net.effectiveType))) return { full: false, reason: 'slow-network' };
  if (webgl && !hasWebGL()) return { full: false, reason: 'no-webgl' };
  return { full: true };
}

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Loads the full experience, or gives up after `timeoutMs`: a load that fails or stalls is
// the 'load-failed' fallback, never a blank section.
export async function loadOrFallback(load, timeoutMs = 8000) {
  let timer;
  try {
    return await Promise.race([load(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)))]);
  } finally {
    clearTimeout(timer);
  }
}

// Records the decision on <html> so CSS, tests and the QA Verifier can see it:
// data-<approach>="full" | "fallback" and data-<approach>-reason.
export function markMode(approach, mode, reason) {
  const el = document.documentElement;
  el.dataset[approach] = mode;
  if (reason) el.dataset[`${approach}Reason`] = reason;
  else delete el.dataset[`${approach}Reason`];
}

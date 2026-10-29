import { capability, loadOrFallback, markMode } from '../capability.js';
import { wireEvents } from './events.js';

// APP-04 runtime. The poster is the page's first paint (and its LCP). The Spline runtime loads
// only after the page has loaded, the browser is idle and the scene is near the viewport, and
// only when the device can take it. Any failure keeps the poster: the 'load-failed' fallback.
const idle = () => new Promise((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 2000 }) : setTimeout(r, 200)));
const loaded = () => new Promise((r) => (document.readyState === 'complete' ? r() : addEventListener('load', () => r(), { once: true })));
const near = (el) =>
  new Promise((r) => {
    if (!('IntersectionObserver' in window)) return r();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        r();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
  });

export async function startSpline(section) {
  const scene = section.dataset.scene;
  const decision = capability({ webgl: true, plugin: Boolean(scene) });
  if (!decision.full) return markMode('app04', 'fallback', decision.reason);

  await loaded();
  await idle();
  await near(section);
  const canvas = section.querySelector('canvas');
  try {
    const app = await loadOrFallback(async () => {
      const { Application } = await import('@splinetool/runtime');
      const app = new Application(canvas);
      await app.load(scene);
      return app;
    }, Number(section.dataset.timeout ?? 10000));
    wireEvents(app, section, JSON.parse(section.dataset.wiring ?? '{}'));
    canvas.hidden = false;
    section.classList.add('is-live');
    markMode('app04', 'full');
  } catch {
    canvas.remove();
    markMode('app04', 'fallback', 'load-failed');
  }
}

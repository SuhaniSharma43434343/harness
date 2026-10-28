import { capability, loadOrFallback, markMode } from '../capability.js';

// APP-02 runtime: one per page, shared by every APP-02 section on it. Full mode loads GSAP,
// ScrollTrigger and Lenis on demand and scrubs each section from scroll; the fallback keeps the
// static stacked layout and reveals blocks with CSS as they enter the viewport.
let started;

export function startCinematic() {
  started ??= run();
  return started;
}

async function run() {
  const decision = capability();
  if (!decision.full) return fallback(decision.reason);
  try {
    const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await loadOrFallback(() => Promise.all([import('gsap'), import('gsap/ScrollTrigger'), import('lenis')]));
    full(gsap, ScrollTrigger, Lenis);
  } catch {
    fallback('load-failed');
  }
}

function fallback(reason) {
  markMode('app02', 'fallback', reason);
  if (reason === 'reduced-motion') return;
  const blocks = document.querySelectorAll('[data-app02-reveal]');
  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) {
      e.target.classList.add('is-visible');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -10% 0px' });
  document.documentElement.classList.add('app02-reveals');
  blocks.forEach((b) => io.observe(b));
}

function full(gsap, ScrollTrigger, Lenis) {
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  markMode('app02', 'full');

  // ScrollStory: pin the section and scrub through its steps.
  for (const story of document.querySelectorAll('[data-app02="story"]')) {
    const steps = [...story.querySelectorAll('[data-app02-step]')];
    if (steps.length < 2) continue;
    story.classList.add('is-pinned');
    const tl = gsap.timeline({
      scrollTrigger: { trigger: story, start: 'top top', end: () => `+=${window.innerHeight * steps.length}`, pin: true, scrub: true, anticipatePin: 1, invalidateOnRefresh: true },
    });
    steps.forEach((step, i) => {
      if (i > 0) tl.fromTo(step, { autoAlpha: 0, yPercent: 12 }, { autoAlpha: 1, yPercent: 0, duration: 1 }, i);
      if (i < steps.length - 1) tl.to(step, { autoAlpha: 0, yPercent: -12, duration: 1 }, i + 0.6);
    });
  }

  // Chapter: scrub the heading and media in as the chapter crosses the viewport.
  for (const chapter of document.querySelectorAll('[data-app02="chapter"]')) {
    const parts = chapter.querySelectorAll('[data-app02-reveal]');
    gsap.fromTo(parts, { autoAlpha: 0, y: 48 }, { autoAlpha: 1, y: 0, stagger: 0.15, ease: 'none', scrollTrigger: { trigger: chapter, start: 'top 85%', end: 'top 35%', scrub: true } });
  }
}

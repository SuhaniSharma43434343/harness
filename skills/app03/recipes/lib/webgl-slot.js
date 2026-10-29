// One WebGL canvas visible at a time (APP-07's shared budget). Every WebGL section on the page
// registers here; when several are on screen, only the one most in view keeps running and the
// others pause. The registry lives on globalThis, so copies of this file in different approach
// folders still share it.
const slots = (globalThis.__forgeWebglSlots ??= { list: [], io: null });

function pick() {
  const visible = slots.list.filter((s) => s.ratio > 0).sort((a, b) => b.ratio - a.ratio);
  const winner = visible[0] ?? null;
  for (const s of slots.list) {
    const run = s === winner;
    if (run !== s.running) {
      s.running = run;
      run ? s.resume() : s.pause();
    }
  }
}

// claimWebgl(el, { resume, pause }) registers a section; it starts paused until it is in view.
export function claimWebgl(el, { resume, pause }) {
  const slot = { el, resume, pause, ratio: 0, running: false };
  slots.list.push(slot);
  if (!('IntersectionObserver' in window)) {
    slot.ratio = 1;
    pick();
    return slot;
  }
  slots.io ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const s = slots.list.find((x) => x.el === e.target);
        if (s) s.ratio = e.isIntersecting ? e.intersectionRatio : 0;
      }
      pick();
    },
    { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  slots.io.observe(el);
  return slot;
}

// How many WebGL sections are running now (for tests and the QA Verifier).
export const runningWebgl = () => slots.list.filter((s) => s.running).length;

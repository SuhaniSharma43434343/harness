// Scroll video engine, pure part: no DOM, no project knowledge. Everything a scroll position, a
// video and a list of scenes need to agree on is computed here, so Node tests check the same code
// the browser runs. Times are seconds, progress is 0 to 1 along the pinned track.

export const LAYOUTS = ['cinematic', 'sticky-text', 'split', 'product', 'background', 'labels'];
export const TEXT_ANIMATIONS = ['fade', 'rise', 'slide', 'scale', 'blur', 'mask', 'none'];
export const POSITIONS = ['top-start', 'top', 'top-end', 'start', 'center', 'end', 'bottom-start', 'bottom', 'bottom-end'];
// Words a page may override on a scene, matched by id. Timing never comes from the page.
export const WORD_FIELDS = ['eyebrow', 'title', 'description', 'label', 'cta'];

export const DEFAULTS = Object.freeze({
  layout: { type: 'cinematic', fit: 'cover', focus: '50% 50%', side: 'start', scrim: 0.55, theme: 'site', frame: false },
  scroll: { length: null, lengthMobile: null, smoothingMs: 120, render: 'auto', preload: 'auto', blobMaxBytes: 12 * 1024 * 1024, seekBudgetMs: 90, loadTimeoutMs: 15000 },
  animation: { text: 'rise', enter: 0.18, exit: 0.18, progress: 'rail' },
});

// Layout defaults that differ from the cinematic ones.
const LAYOUT_DEFAULTS = {
  'sticky-text': { frame: true, scrim: 0 },
  split: { scrim: 0 },
  product: { fit: 'contain', frame: false, scrim: 0 },
  background: { scrim: 0.7 },
  labels: {},
  cinematic: {},
};

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// The default track length, in viewport heights: enough scroll per scene to read it, and
// enough per second that the clip does not race. Bounded so a long clip stays usable.
export function defaultLength(sceneCount, durationS = 0) {
  return round(clamp(Math.max(sceneCount * 1.1, durationS * 0.45, 3), 3, 24), 1);
}

// resolveConfig(base, props?, { overrides }) => the config the engine runs, with every default
// filled in. base is the config file (or {}); props come from the page. When `overrides` is true,
// props.scenes only change words of existing scenes (matched by id) and an unknown id throws, so
// a typo fails the build instead of silently dropping copy.
export function resolveConfig(base = {}, props = {}, { overrides = false } = {}) {
  const pick = (k) => ({ ...(base[k] ?? {}), ...(props[k] ?? {}) });
  const layoutType = props.layout?.type ?? base.layout?.type ?? DEFAULTS.layout.type;
  const layout = { ...DEFAULTS.layout, ...(LAYOUT_DEFAULTS[layoutType] ?? {}), ...pick('layout'), type: layoutType };
  const animation = { ...DEFAULTS.animation, ...pick('animation') };
  const video = props.video ?? base.video ?? null;
  let scenes = (base.scenes ?? []).map((s) => ({ ...s }));
  if (props.scenes) {
    if (overrides) {
      for (const o of props.scenes) {
        const s = scenes.find((x) => x.id === o.id);
        if (!s) throw new Error(`ScrollVideo: the page overrides scene "${o.id}", which the config "${base.id ?? 'inline'}" does not have (scenes: ${scenes.map((x) => x.id).join(', ')}).`);
        for (const k of WORD_FIELDS) if (o[k] !== undefined) s[k] = o[k];
      }
    } else scenes = props.scenes.map((s) => ({ ...s }));
  }
  if (!scenes.length) throw new Error(`ScrollVideo: the config "${base.id ?? 'inline'}" has no scenes.`);
  const durationS = video?.durationS ?? Math.max(...scenes.map((s) => s.end));
  const scroll = { ...DEFAULTS.scroll, ...pick('scroll') };
  scroll.length ??= defaultLength(scenes.length, durationS);
  scroll.lengthMobile ??= scroll.length;
  scenes = scenes.map((s) => ({ ...s, position: s.position ?? 'bottom-start', animation: s.animation ?? animation.text, label: s.label ?? s.title }));
  return {
    id: base.id ?? props.id ?? 'inline',
    label: props.label ?? base.label ?? null,
    foreground: props.foreground ?? base.foreground ?? null,
    video,
    durationS,
    layout,
    scroll,
    animation,
    scenes,
  };
}

// parseFocus('30% 60%') => [0.3, 0.6]
export function parseFocus(focus = '50% 50%') {
  const m = String(focus).match(/^\s*([\d.]+)%\s+([\d.]+)%\s*$/);
  return m ? [clamp(Number(m[1]) / 100), clamp(Number(m[2]) / 100)] : [0.5, 0.5];
}

// buildTimeline(scenes, duration) => [{ p, t }], a monotonic piecewise-linear map from track
// progress to video time. Without scroll slices it is proportional. With them, each scene owns
// its slice and gaps interpolate.
export function buildTimeline(scenes, duration) {
  const sliced = scenes.length > 0 && scenes.every((s) => s.scroll);
  if (!sliced) return [{ p: 0, t: 0 }, { p: 1, t: duration }];
  const points = [{ p: 0, t: 0 }];
  for (const s of scenes) points.push({ p: s.scroll.from, t: s.start }, { p: s.scroll.to, t: s.end });
  points.push({ p: 1, t: duration });
  // Same progress twice: the later point wins (a scene that starts at p=0 but t>0 skips the
  // head of the clip on purpose).
  const out = [];
  for (const pt of points) {
    if (out.length && Math.abs(out[out.length - 1].p - pt.p) < 1e-9) out[out.length - 1] = pt;
    else out.push(pt);
  }
  return out;
}

// timeAt(progress, timeline) => seconds
export function timeAt(p, timeline) {
  p = clamp(p);
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (p <= b.p) return b.p === a.p ? b.t : a.t + ((p - a.p) / (b.p - a.p)) * (b.t - a.t);
  }
  return timeline[timeline.length - 1].t;
}

// progressAt(seconds, timeline) => progress, the inverse of timeAt (first progress showing t).
export function progressAt(t, timeline) {
  for (let i = 1; i < timeline.length; i++) {
    const a = timeline[i - 1];
    const b = timeline[i];
    if (t <= b.t) return b.t === a.t ? a.p : a.p + ((t - a.t) / (b.t - a.t)) * (b.p - a.p);
  }
  return 1;
}

// isMonotonic(timeline) => true when time never goes backwards as progress grows.
export const isMonotonic = (timeline) => timeline.every((pt, i) => i === 0 || (pt.p >= timeline[i - 1].p && pt.t >= timeline[i - 1].t));

// sceneIndexAt(t, scenes, duration) => the index of the scene showing at time t, or -1 in a gap.
// [start, end) except that the end of the clip belongs to the last scene that reaches it.
export function sceneIndexAt(t, scenes, duration = Infinity) {
  for (let i = 0; i < scenes.length; i++) if (t >= scenes[i].start && t < scenes[i].end) return i;
  const last = scenes.length - 1;
  if (last >= 0 && t >= scenes[last].end - 1e-6 && scenes[last].end >= duration - 0.05) return last;
  return -1;
}

// sceneFactor(t, scene, opts) => { p, v }: p is how far through the scene t is (0 to 1), v how
// visible its text is (0 to 1). Text animates in over the first `enter` share and out over the
// last `exit` share. The first scene is already in at the top of the track and the last stays in
// at the bottom, so the section never opens or closes on an empty frame.
export function sceneFactor(t, scene, { enter = 0.18, exit = 0.18, first = false, last = false } = {}) {
  const len = scene.end - scene.start;
  const raw = len > 0 ? (t - scene.start) / len : 0;
  if (raw < 0 && !first) return { p: 0, v: 0 };
  if (raw > 1 && !last) return { p: 1, v: 0 };
  const p = clamp(raw);
  const vin = first || enter <= 0 ? 1 : clamp(p / enter);
  const vout = last || exit <= 0 ? 1 : clamp((1 - p) / exit);
  return { p, v: Math.min(vin, vout) };
}

// smooth(current, target, dtMs, tauMs) => the next shown value: an exponential follow that is
// independent of frame rate. tauMs 0 is a hard scrub.
export function smooth(current, target, dtMs, tauMs) {
  if (!(tauMs > 0) || !Number.isFinite(current)) return target;
  const next = current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
  return Math.abs(target - next) < 1e-3 ? target : next;
}

// pickSource(sources, { matches, canPlay }) => the first source whose media query matches and
// whose type the browser can play, or null. canPlay returns canPlayType's '', 'maybe', 'probably'.
export function pickSource(sources = [], { matches = () => true, canPlay = () => 'maybe' } = {}) {
  for (const s of sources) {
    if (s.media && !matches(s.media)) continue;
    const type = s.codecs ? `${s.type}; codecs="${s.codecs}"` : s.type;
    if (canPlay(type)) return s;
  }
  return null;
}

// fitRect(srcW, srcH, boxW, boxH, fit, [fx, fy]) => { x, y, w, h }: where object-fit and
// object-position put the picture inside its box. Used to draw frames and to place callouts.
export function fitRect(srcW, srcH, boxW, boxH, fit = 'cover', [fx, fy] = [0.5, 0.5]) {
  if (!(srcW > 0 && srcH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = fit === 'contain' ? Math.min(boxW / srcW, boxH / srcH) : Math.max(boxW / srcW, boxH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (boxW - w) * fx, y: (boxH - h) * fy, w, h };
}

// trackProgress(top, trackHeight, viewportHeight) => progress from the track's bounding top.
export function trackProgress(top, trackHeight, viewportHeight) {
  const run = trackHeight - viewportHeight;
  return run > 0 ? clamp(-top / run) : top <= 0 ? 1 : 0;
}

// The video frame on screen at time t: the last frame that starts at or before t.
export const frameAt = (t, fps) => Math.floor(t * fps + 1e-6);
// The time to seek to for that frame: its middle, so rounding can never land on a neighbour.
export const frameMid = (frame, fps, duration) => Math.max(0, Math.min((frame + 0.5) / fps, duration - 0.001));

// Frame sequences are numbered from 1, the way ffmpeg writes them.
export const frameIndexAt = (t, frames) => clamp(Math.round(t * frames.fps), 0, frames.count - 1);
export const frameUrl = (frames, index) => frames.pattern.replace('{i}', String(index + 1).padStart(frames.pad ?? 4, '0'));

// coarseToFine(count) => frame indexes in load order: every 8th, then every 4th, 2nd and the
// rest, so scrubbing works across the whole clip long before the sequence is complete.
export function coarseToFine(count) {
  const seen = new Set();
  const order = [];
  for (const step of [8, 4, 2, 1]) {
    for (let i = 0; i < count; i += step) if (!seen.has(i)) (seen.add(i), order.push(i));
  }
  if (!seen.has(count - 1)) order.push(count - 1);
  return order;
}

// nearestLoaded(index, loaded) => the closest index whose frame is loaded, or -1.
export function nearestLoaded(index, loaded) {
  for (let d = 0; d < loaded.length; d++) {
    if (loaded[index - d]) return index - d;
    if (loaded[index + d]) return index + d;
  }
  return -1;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}

// aspectRatio(1920, 1080) => '16:9'; unusual sizes give a decimal ratio such as '2.39:1'.
export function aspectRatio(w, h) {
  if (!(w > 0 && h > 0)) return null;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  const [a, b] = [w / g, h / g];
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  const known = [[16, 9], [9, 16], [4, 3], [3, 4], [1, 1], [21, 9], [4, 5], [5, 4], [3, 2], [2, 3]];
  for (const [x, y] of known) if (Math.abs(w / h - x / y) < 0.01) return `${x}:${y}`;
  return w >= h ? `${round(w / h, 2)}:1` : `1:${round(h / w, 2)}`;
}

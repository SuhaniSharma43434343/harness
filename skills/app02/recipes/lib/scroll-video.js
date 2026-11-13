import { capability, reducedMotion } from '../capability.js';
import * as core from './scroll-video-core.js';

// APP-02 Scroll Video runtime: one engine per [data-scroll-video] section. It knows nothing about
// any project: the section's JSON config (video, layout, scroll, animation, scenes) is the whole
// input. The page scrolls natively; a sticky stage pins the picture; each animation frame maps
// the track's progress to a video time, seeks (one seek in flight at a time) or draws a frame,
// and shows the scenes whose time the picture is at. See docs/scroll-video/02-architecture.md.

const SEEK_WATCHDOG_MS = 600;
const BUFFERING_AFTER_MS = 250;

export function startScrollVideos(root = document) {
  for (const el of root.querySelectorAll('[data-scroll-video]')) {
    if (!el.scrollVideo) el.scrollVideo = new ScrollVideo(el);
  }
}

export class ScrollVideo {
  constructor(root) {
    this.root = root;
    this.cfg = JSON.parse(root.querySelector('script[data-sv-config]').textContent);
    const q = (s) => root.querySelector(s);
    this.track = q('[data-sv-track]');
    this.stage = q('[data-sv-stage]');
    this.media = q('[data-sv-media]');
    this.video = q('video[data-sv-video]');
    this.canvas = q('canvas[data-sv-canvas]');
    this.sceneEls = [...root.querySelectorAll('[data-sv-scene]')];
    this.chapterEls = [...root.querySelectorAll('[data-sv-chapter]')];
    this.pointEls = [...root.querySelectorAll('[data-sv-point]')];
    this.scenes = this.cfg.scenes;
    this.duration = this.cfg.durationS;
    this.timeline = core.buildTimeline(this.scenes, this.duration);
    this.fps = this.cfg.video?.fps || 30;
    this.focus = core.parseFocus(this.cfg.layout.focus);

    this.progress = 0;
    this.target = 0;
    this.time = 0;
    this.shown = 0; // the time of the picture on screen
    this.sceneIndex = -2;
    this.render = 'video';
    this.seeking = false;
    this.requested = -1;
    this.seeks = 0;
    this.seekLatencies = [];
    this.presentedFrames = 0;
    this.loaded = [];
    this.loadedCount = 0;
    this.lastValues = new Map();
    this.visible = true;
    this.raf = 0;
    this.lastNow = 0;

    const decision = this.decide();
    if (!decision.full) this.fallback(decision.reason);
    else this.full();
  }

  // The same rules as every APP-02 section (capability.js), plus: a scroll video needs a source.
  decide() {
    const cap = capability();
    if (!cap.full) return cap;
    const v = this.cfg.video;
    if (!v) return { full: false, reason: 'no-source' };
    const frames = v.frames && this.canvas;
    if (this.cfg.scroll.render === 'frames' && frames) return { full: true };
    if (!this.chooseSource() && !frames) return { full: false, reason: 'no-source' };
    return { full: true };
  }

  chooseSource() {
    const probe = this.video ?? document.createElement('video');
    return core.pickSource(this.cfg.video?.sources ?? [], { matches: (m) => matchMedia(m).matches, canPlay: (t) => probe.canPlayType(t) });
  }

  set(attr, value) {
    if (value === null || value === undefined) this.root.removeAttribute(`data-sv-${attr}`);
    else this.root.setAttribute(`data-sv-${attr}`, value);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.set('state', state);
  }

  // The static layout: poster and every scene stacked. Nothing is downloaded.
  fallback(reason) {
    this.mode = 'fallback';
    this.reason = reason;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.loadTimer);
    this.cleanup?.();
    if (this.video) {
      this.video.removeAttribute('src');
      this.video.load?.();
    }
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.set('mode', 'fallback');
    this.set('reason', reason);
    this.setState('fallback');
    for (const el of this.sceneEls) {
      el.style.removeProperty('--sv-v');
      el.style.removeProperty('--sv-p');
      el.removeAttribute('data-active');
    }
  }

  full() {
    this.mode = 'full';
    this.set('mode', 'full');
    this.set('reason', null);
    this.setState('loading');

    const onScroll = () => this.wake();
    addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => this.layoutChanged());
    ro.observe(this.stage);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) this.visible = e.isIntersecting;
      if (this.visible) this.wake();
    }, { rootMargin: '100% 0px' });
    io.observe(this.root);
    const onFocus = (e) => {
      const el = e.target.closest?.('[data-sv-scene]');
      if (!el) return;
      const i = this.sceneEls.indexOf(el);
      if (i >= 0 && i !== this.sceneIndex) {
        // A keyboard user lands on the scene at once: no smoothing, so a focused link is never faint.
        this.jump = true;
        this.goTo(i, 'auto');
      }
    };
    this.root.addEventListener('focusin', onFocus);
    this.chapterEls.forEach((btn, i) => btn.addEventListener('click', () => this.goTo(i)));
    this.cleanup = () => {
      removeEventListener('scroll', onScroll);
      ro.disconnect();
      io.disconnect();
      this.root.removeEventListener('focusin', onFocus);
    };

    const frames = this.cfg.video.frames && this.canvas;
    if (this.cfg.scroll.render === 'frames' && frames) this.startFrames();
    else this.startVideo(this.chooseSource());
    this.measure();
    this.time = this.target;
    this.updateScenes(this.target);
    this.wake();
  }

  // ---- video renderer ----
  startVideo(source) {
    const v = this.video;
    this.render = 'video';
    this.set('render', 'video');
    this.source = source;
    this.videoReady = false;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    if (!this.videoBound) {
      this.videoBound = true;
      v.addEventListener('loadeddata', () => this.onVideoData());
      v.addEventListener('seeked', () => this.onSeeked());
      v.addEventListener('waiting', () => this.videoReady && this.setState('buffering'));
      v.addEventListener('error', () => this.fail('load-failed'));
      if ('requestVideoFrameCallback' in v) {
        const onFrame = (_now, meta) => {
          this.presentedFrames++;
          // The frame on screen: the scenes follow it, so wake the loop to re-check them.
          if (this.render === 'video' && !this.seeking && this.shown !== meta.mediaTime) {
            this.shown = meta.mediaTime;
            this.wake();
          }
          v.requestVideoFrameCallback(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
      }
    }
    clearTimeout(this.loadTimer);
    this.loadTimer = setTimeout(() => {
      if (!this.videoReady && !this.loadedCount) this.fail('load-failed');
    }, this.cfg.scroll.loadTimeoutMs);

    const bytes = source.bytes ?? this.cfg.video.bytes;
    const mode = this.cfg.scroll.preload;
    const blob = mode === 'blob' || (mode === 'auto' && bytes > 0 && bytes <= this.cfg.scroll.blobMaxBytes);
    if (blob && 'fetch' in window) {
      this.fetchBlob(source).then(
        (url) => this.source === source && (v.src = url),
        () => this.source === source && (v.src = source.src),
      );
    } else v.src = source.src;
  }

  // The whole clip in memory, with progress: seeking a Blob never waits on the network.
  async fetchBlob(source) {
    const res = await fetch(source.src);
    if (!res.ok) throw new Error(`${res.status}`);
    const total = Number(res.headers.get('content-length')) || source.bytes || 0;
    let blob;
    if (res.body && total) {
      const reader = res.body.getReader();
      const chunks = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.length;
        this.root.style.setProperty('--sv-load', String(core.clamp(got / total).toFixed(3)));
      }
      blob = new Blob(chunks, { type: source.type });
    } else blob = await res.blob();
    this.root.style.setProperty('--sv-load', '1');
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    this.blobUrl = URL.createObjectURL(blob);
    return this.blobUrl;
  }

  onVideoData() {
    if (this.videoReady || this.mode !== 'full') return;
    this.videoReady = true;
    clearTimeout(this.loadTimer);
    this.root.style.setProperty('--sv-load', '1');
    // iOS shows no frame for a seek until the video has played once; muted inline play is allowed.
    if (navigator.maxTouchPoints > 0) this.video.play()?.then(() => this.video.pause()).catch(() => {});
    this.requested = -1;
    this.seek(this.time, true);
  }

  seek(t, force = false) {
    const v = this.video;
    if (!this.videoReady) return;
    const now = performance.now();
    if (this.seeking && now - this.seekStartedAt < SEEK_WATCHDOG_MS && !force) return;
    // One seek per frame: a target inside the frame already asked for changes nothing on screen.
    const frame = core.frameAt(t, this.fps);
    if (!force && frame === core.frameAt(this.requested, this.fps)) return;
    this.seeking = true;
    this.seekStartedAt = now;
    this.requested = t;
    this.seeks++;
    clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.seeking && this.setState('buffering'), BUFFERING_AFTER_MS);
    v.currentTime = core.frameMid(frame, this.fps, v.duration || this.duration);
  }

  onSeeked() {
    if (!this.seeking) return;
    const latency = performance.now() - this.seekStartedAt;
    this.seeking = false;
    clearTimeout(this.bufferTimer);
    this.seekLatencies.push(Math.round(latency * 10) / 10);
    if (this.seekLatencies.length > 64) this.seekLatencies.shift();
    this.shown = core.frameAt(this.video.currentTime, this.fps) / this.fps;
    if (this.mode === 'full' && this.render === 'video') this.setState('ready');
    const recent = this.seekLatencies.slice(-8);
    if (this.render === 'video' && this.cfg.scroll.render === 'auto' && this.cfg.video.frames && this.canvas && recent.length >= 8 && core.median(recent) > this.cfg.scroll.seekBudgetMs) {
      this.startFrames('slow-seek');
    }
    this.wake();
  }

  fail(reason) {
    if (this.mode !== 'full') return;
    if (this.render === 'video' && this.cfg.video.frames && this.canvas && !this.framesFailed) return this.startFrames(reason);
    this.fallback(reason);
  }

  // ---- frames renderer ----
  startFrames(reason) {
    if (this.render === 'frames' && this.loaded.length) return;
    const f = this.cfg.video.frames;
    this.seeking = false;
    this.render = 'frames';
    this.set('render', 'frames');
    this.set('render-reason', reason ?? null);
    this.renderReason = reason ?? null;
    this.fps = f.fps;
    clearTimeout(this.loadTimer);
    if (this.video) this.video.pause?.();
    this.loaded = new Array(f.count).fill(null);
    this.loadedCount = 0;
    this.sizeCanvas();
    const order = core.coarseToFine(f.count);
    const tries = new Map();
    let next = 0;
    let failures = 0;
    this.framesLost = 0;
    const one = () => {
      if (next >= order.length || this.render !== 'frames') return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      // Settles on load, error or a stall, so one stuck request can never stop the queue.
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 8000);
        img.onload = () => (clearTimeout(timer), resolve());
        img.onerror = () => (clearTimeout(timer), reject(new Error('error')));
      });
      img.src = core.frameUrl(f, i);
      loaded.then(
        () => {
          this.loaded[i] = img;
          this.loadedCount++;
          if (this.loadedCount === 1) this.setState('ready');
          this.drawn = -1;
          this.wake();
          one();
        },
        () => {
          // A busy device can refuse a decode; try each frame twice more, at the back of the queue.
          // A frame that never loads is drawn as its nearest neighbour.
          const n = (tries.get(i) ?? 0) + 1;
          tries.set(i, n);
          if (n <= 2) order.push(i);
          else this.framesLost++;
          if (++failures > 8 && !this.loadedCount) {
            this.framesFailed = true;
            this.fallback('load-failed');
          } else setTimeout(one, 50 * n);
        },
      );
    };
    for (let k = 0; k < 6; k++) one();
    this.loadTimer = setTimeout(() => !this.loadedCount && ((this.framesFailed = true), this.fallback('load-failed')), this.cfg.scroll.loadTimeoutMs);
  }

  sizeCanvas() {
    if (!this.canvas) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(this.media.clientWidth * dpr);
    const h = Math.round(this.media.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.drawn = -1;
    }
  }

  draw(t) {
    const f = this.cfg.video.frames;
    const want = core.frameIndexAt(t, f);
    const i = core.nearestLoaded(want, this.loaded);
    if (i < 0) return;
    this.shown = i / f.fps;
    if (i === this.drawn && this.drawnFocus === this.focusKey) return;
    const img = this.loaded[i];
    const ctx = this.canvas.getContext('2d');
    const { width: W, height: H } = this.canvas;
    const r = core.fitRect(img.naturalWidth, img.naturalHeight, W, H, this.cfg.layout.fit, this.focus);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
    this.drawn = i;
    this.drawnFocus = this.focusKey;
    this.presentedFrames++;
  }

  // ---- the loop ----
  wake() {
    if (this.mode !== 'full' || this.raf) return;
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  measure() {
    const r = this.track.getBoundingClientRect();
    this.progress = core.trackProgress(r.top, r.height, this.stage.offsetHeight || innerHeight);
    this.target = core.timeAt(this.progress, this.timeline);
  }

  tick(now) {
    this.raf = 0;
    if (this.mode !== 'full') return;
    const dt = now - this.lastNow;
    this.lastNow = now;
    this.measure();
    this.time = this.jump ? this.target : core.smooth(this.time, this.target, dt, this.cfg.scroll.smoothingMs);
    this.jump = false;
    if (this.render === 'frames') this.draw(this.time);
    else this.seek(this.time);
    // Text follows the picture on screen. Before the first frame there is only the poster, which
    // is the start of the clip, so the scenes follow the scroll target until then.
    const ready = this.render === 'frames' ? this.loadedCount > 0 : this.videoReady;
    this.updateScenes(ready ? this.shown : this.target);
    this.root.style.setProperty('--sv-progress', this.progress.toFixed(4));
    // Keep going while the picture is still catching up; a scroll event or a finished seek wakes
    // the loop again, so an idle section costs nothing.
    const settling = Math.abs(this.time - this.target) > 1e-3 || this.seeking || (this.render === 'frames' && this.drawn !== core.nearestLoaded(core.frameIndexAt(this.time, this.cfg.video.frames), this.loaded));
    if (settling) this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  style(el, prop, value) {
    const key = el === this.root ? prop : `${this.sceneEls.indexOf(el)}${prop}`;
    if (this.lastValues.get(key) === value) return;
    this.lastValues.set(key, value);
    el.style.setProperty(prop, value);
  }

  updateScenes(t) {
    const idx = core.sceneIndexAt(t, this.scenes, this.duration);
    const n = this.scenes.length;
    const { enter, exit } = this.cfg.animation;
    this.scenes.forEach((s, i) => {
      const el = this.sceneEls[i];
      if (!el) return;
      let { p, v } = core.sceneFactor(t, s, { enter, exit, first: i === 0, last: i === n - 1 });
      if (s.animation === 'none') v = v > 0 ? 1 : 0;
      this.style(el, '--sv-v', v.toFixed(3));
      this.style(el, '--sv-p', p.toFixed(3));
    });
    if (idx === this.sceneIndex) return;
    this.sceneIndex = idx;
    const scene = this.scenes[idx];
    this.sceneEls.forEach((el, i) => el.toggleAttribute('data-active', i === idx));
    this.chapterEls.forEach((el, i) => (i === idx ? el.setAttribute('aria-current', 'step') : el.removeAttribute('aria-current')));
    for (const el of this.pointEls) el.toggleAttribute('data-active', el.dataset.scene === scene?.id);
    this.set('scene', scene?.id ?? null);
    this.set('pos', scene?.position ?? null);
    const focus = scene?.focus ?? this.cfg.layout.focus;
    this.focus = core.parseFocus(focus);
    this.focusKey = focus;
    this.root.style.setProperty('--sv-focus', focus);
    this.placePoints();
  }

  // Callouts point at places on the video frame: re-projected through object-fit on every change.
  placePoints() {
    if (!this.pointEls.length) return;
    const v = this.cfg.video;
    const r = core.fitRect(v.width, v.height, this.media.clientWidth, this.media.clientHeight, this.cfg.layout.fit, this.focus);
    for (const el of this.pointEls) {
      el.style.left = `${(r.x + Number(el.dataset.x) * r.w).toFixed(1)}px`;
      el.style.top = `${(r.y + Number(el.dataset.y) * r.h).toFixed(1)}px`;
    }
  }

  layoutChanged() {
    if (this.mode !== 'full') return;
    this.sizeCanvas();
    this.placePoints();
    if (this.render === 'video') {
      const next = this.chooseSource();
      if (next && next !== this.source && next.src !== this.source?.src) this.startVideo(next);
    }
    this.wake();
  }

  // Scrolls to the middle of scene i, where its text is fully in.
  goTo(i, behavior) {
    const s = this.scenes[i];
    if (!s) return;
    const p = core.progressAt((s.start + s.end) / 2, this.timeline);
    const r = this.track.getBoundingClientRect();
    const run = r.height - (this.stage.offsetHeight || innerHeight);
    const top = scrollY + r.top + p * run;
    scrollTo({ top, behavior: behavior ?? (reducedMotion() ? 'auto' : 'smooth') });
  }

  // Read-only state for the QA drive and the tests.
  snapshot() {
    return {
      mode: this.mode,
      reason: this.reason ?? null,
      state: this.state,
      render: this.render,
      renderReason: this.renderReason ?? null,
      progress: this.progress,
      target: this.target,
      time: this.time,
      shown: this.shown,
      seeking: this.seeking,
      scene: this.scenes[this.sceneIndex]?.id ?? null,
      // The scene the picture on screen belongs to; equal to scene once the text has caught up.
      shownScene: this.scenes[core.sceneIndexAt(this.shown, this.scenes, this.duration)]?.id ?? null,
      sceneIndex: this.sceneIndex,
      seeks: this.seeks,
      seekLatencies: [...this.seekLatencies],
      presentedFrames: this.presentedFrames,
      source: this.source?.src ?? null,
      frames: this.cfg.video?.frames ? { loaded: this.loadedCount, lost: this.framesLost ?? 0, count: this.cfg.video.frames.count } : null,
      duration: this.duration,
      fps: this.fps,
      scenes: this.scenes.map((s) => ({ id: s.id, start: s.start, end: s.end })),
    };
  }
}

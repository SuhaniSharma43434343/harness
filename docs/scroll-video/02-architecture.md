# 2. Engine architecture

One component, `APP-02/ScrollVideo`, renders any scroll video from a config. Nothing in it names a client, an industry, a video, a duration, an aspect ratio or a scene count; the build tests grep for that.

```
design/scroll-video/<id>.json ──prebuild──▶ site/src/data/scroll-video/<id>.json
assets/public/video/*          ──scaffold / forge scroll-video add-video──▶ site/public/video/*
page frontmatter: - use: "APP-02/ScrollVideo"  config: "<id>"  [scenes: per-scene word overrides]
        │
        ▼
ScrollVideo.astro  (server render: static markup that works without JavaScript)
  ├─ inline mode probe (≈0.5 KB, runs before paint, so choosing the layout causes no layout shift)
  ├─ <script type="application/json" data-sv-config>  (the merged config)
  └─ module script ─▶ lib/app02/scroll-video.js  (DOM engine)  ─▶ scroll-video-core.js (pure maths)
```

## Layers

| Layer | File | Responsibility | Tested by |
| --- | --- | --- | --- |
| Core maths (pure, no DOM) | `skills/app02/recipes/lib/scroll-video-core.js` | Defaults, the scroll-to-time map, scene lookup, scene enter/exit factors, smoothing, source choice, object-fit rectangles, frame index | `tests/unit/scroll-video-core.test.mjs` (Node) |
| DOM engine | `skills/app02/recipes/lib/scroll-video.js` | Mode, loading, seeking, frame sync, rendering, resize, chapters, fallback, the QA snapshot | `tests/build/scroll-video.test.mjs` (Chromium) |
| Section | `skills/app02/recipes/sections/ScrollVideo.astro` + `lib/scroll-video.css` | Markup for six layouts, static fallback, accessibility, token-only styling | build tests, gates |
| Config tooling (Node) | `src/scroll-video/*.mjs` | Container reader, asset checks and compression advice, config validation, storyboard to scenes, prompts, posters, stills and frames | `tests/unit/scroll-video-*.test.mjs` |
| CLI | `src/cli/scroll-video.mjs` | `forge scroll-video probe|new|prompts|add-video|check|stills|frames|layouts` | `tests/unit/scroll-video-cli.test.mjs` |
| QA | `src/scroll-video/qa.mjs`, used by `src/gates/interactions.mjs` | Drive each placed scroll video forward and back and report findings and metrics | gate tests and build tests |

## How scroll becomes video time

1. **Pinning without a library.** The section is a tall track (`length` × the small viewport height, `100svh`, so the phone address bar cannot resize it mid-scroll) holding a `position: sticky` stage of one viewport. The browser pins it; there is no pin spacer to measure, nothing to refresh on resize, and no layout shift.
2. **Progress.** `p = clamp(−trackTop / (trackHeight − stageHeight), 0, 1)` from one `getBoundingClientRect()` per frame, only while the section is within one viewport of the screen (IntersectionObserver).
3. **Time map.** A piecewise-linear map built from the scenes. With no scroll ranges, time is proportional to progress. A scene with `scroll: { from, to }` owns that slice of the track, so a key moment can hold longer than its share of the clip; gaps between scenes interpolate. The map is monotonic, so scrolling up plays the clip backwards through the same frames.
4. **Smoothing.** The shown time follows the target with an exponential filter (`smoothingMs`, default 120 ms, frame-rate independent). `0` is a hard scrub.
5. **Seeking.** At most one seek is in flight. A new target is sent when the previous `seeked` fires, or after a 600 ms watchdog. This avoids the seek pile-up that makes naive `currentTime = x` on every scroll event stutter, worst in reverse.
6. **Frame sync.** `requestVideoFrameCallback` reports the `mediaTime` of the frame actually on screen. Scene text follows that time, not the scroll target, so a caption never runs ahead of its picture. Where the callback is missing, `seeked` gives the time.

## Renderers

- **`video`**: a muted, inline `<video>` that is never played; the engine only seeks. Sources are chosen per `media` query and `canPlayType`, so a portrait cut can serve phones and a landscape cut desktops. Crossing a breakpoint swaps the source and keeps the position.
- **`frames`**: a `<canvas>` drawing a numbered image sequence. Frames load coarse to fine (every 8th, then 4th, 2nd, all), so scrubbing works before the sequence is complete; the nearest loaded frame is drawn. It is exact in both directions, at the cost of bytes and memory.
- **`auto`** (default): starts with `video` and measures every seek. If the median of the last 8 is over `seekBudgetMs` (default 90 ms) and the config has frames, it switches to `frames` and records why (`data-sv-render-reason="slow-seek"`).

## States, recorded on the section for CSS and QA

| Attribute | Values |
| --- | --- |
| `data-sv-mode` | `full`, `fallback` (decided before paint, then confirmed by the engine) |
| `data-sv-reason` | `reduced-motion`, `low-end-device`, `slow-network`, `load-failed`, `no-source` or a forced reason |
| `data-sv-state` | `poster` → `loading` → `ready`, `buffering` while a seek is slow, `fallback`, `error` |
| `data-sv-render` | `video` or `frames` |
| `--sv-load` | 0 to 1 load progress when the clip is fetched as a whole |

`section.scrollVideo.snapshot()` returns the same state plus progress, target time, shown time, the active scene and seek timings. The QA drive and the build tests read it; it changes nothing.

## Loading and fallback

- **Poster first.** The poster `<img>` (with width, height and alt) is the first paint in every mode, so LCP never waits for video.
- **Preload.** `preload: "auto"` (default) fetches the whole clip as a Blob when its size is known and at most `blobMaxBytes` (default 12 MB), with progress; seeking a Blob never touches the network. Larger clips stream through `src` and rely on the host's byte-range support.
- **Timeout.** No first frame within `loadTimeoutMs` (default 15 s) is `load-failed`: the section returns to the static layout with the poster.
- **Static fallback.** The poster and every scene stacked in reading order, every CTA live, no video request at all. It is what reduced motion, Save-Data, a 3G connection, a low-end device, a failed load, a missing source and no JavaScript all show.

## Responsive behaviour

`fit: cover` with a `focus` point (and an optional per-scene `focus`, eased between scenes) keeps the subject in frame when a 16:9 clip fills a 9:19.5 phone. `fit: contain` letterboxes onto the surface colour, for products. Product callouts (`overlay.point`) are placed in video coordinates and re-projected through the same object-fit maths on every resize. A `ResizeObserver` on the stage handles rotation, split-screen and the phone address bar.

## Accessibility

- The video is `aria-hidden`; the scenes carry the meaning as real headings and paragraphs, all in the DOM in reading order.
- Inactive scenes are hidden visually, not from assistive technology. When focus enters a scene (Tab to its CTA), the engine scrolls that scene into its slice of the track, so a focused link is never invisible.
- The chapter rail is a list of buttons that scroll to each scene.
- Reduced motion gets the static layout: no scrubbing, no transforms, all text visible.

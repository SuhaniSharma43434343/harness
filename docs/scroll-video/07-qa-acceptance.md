# 7. QA acceptance criteria

Each criterion names the test that checks it. "Headless" means Playwright's Chromium on the development PC; real devices are logged by hand in `docs/device-log.md`, and no result here is a claim about them.

## Reusability

| # | Criterion | Check |
| --- | --- | --- |
| R1 | One component renders at least three unrelated concepts (different subject, duration, frame rate, aspect ratio, scene count, layout) from config alone. | build test: three concept pages built from one engine; the built JavaScript chunk is the same file on every page |
| R2 | The seven industry scenarios (pizza assembling, car reveal, outfit transformation, building construction, particles forming a logo, product assembly, a journey through locations) validate and render with no code change. | unit: seven scenario configs pass `checkConfig`; build test: seven generated videos, one per scenario, render, scrub frame-accurately and pass the interactions gate |
| R3 | No project-specific code: the engine, section and CSS contain no concept words, no fixed duration, scene count or aspect ratio. | build test greps the recipe files |
| R4 | Scene markers change through config alone: editing a scene's times moves the moment its text appears, with no rebuild of the engine. | build test: a second config of the same video with different markers and a different number of scenes |
| R5 | Scene count varies: 3, 5, 7, 12 scenes work, and 1 still renders. | unit (core) + build test |

## Behaviour

| # | Criterion | Threshold | Check |
| --- | --- | --- | --- |
| B1 | The stage is pinned for the whole track and released after it. | stage top within 1 px of the viewport top at every sample inside the track | build test, gate |
| B2 | Forward scrubbing shows the frame for the scroll position. | after settling, the time code on screen is within 1 frame of the target at every step | build test (time code) |
| B3 | Reverse scrubbing does the same. | as B2, scrolling up | build test |
| B4 | Text stays in sync with the picture. | at every settled step, the active scene is the one whose `[start, end)` holds the on-screen frame's time | build test |
| B5 | Scenes activate in order forward and in reverse order backward. | sequence equals the config order (and its reverse) | build test, gate |
| B6 | Resizing (desktop ↔ phone, rotation) keeps position, re-crops and re-places callouts. | progress unchanged within 0.02; stage fills the viewport | build test |
| B7 | Phone touch scrolling drives the video. | a touch scroll gesture advances progress and the scene | build test (CDP touch gesture) |
| B8 | Any aspect ratio fits the stage: 16:9, 2.35:1, 9:16, 1:1, 4:5; split stacks on a phone. | `cover` fills the stage; `contain` shows the whole frame | build test |
| B9 | CTAs work and a focused CTA is visible. | Tab to a later scene's CTA scrolls that scene in | build test |
| B10 | The chapter rail jumps to scenes. | clicking label N makes scene N active | build test |

## Loading, fallback and performance

| # | Criterion | Threshold | Check |
| --- | --- | --- | --- |
| L1 | Poster first; no layout shift from choosing the mode. | CLS ≤ 0.1 (APP-02 budget) | build test |
| L2 | Reduced motion gets the static layout with every scene readable and no video request. | 0 video requests; every scene title visible | build test |
| L3 | Save-Data or a 3G connection gets the static layout, without downloading the video. | 0 video requests | build test |
| L4 | A failed or stalled load returns to the static layout. | `data-sv-reason="load-failed"` within `loadTimeoutMs` | build test |
| L5 | A large file on a slow connection shows loading, then works. | state `loading` with rising `--sv-load`, then `ready` | build test (throttled) |
| L6 | Without JavaScript every scene is visible. | all scene titles visible | build test |
| L7 | The engine stays within the APP-01 JavaScript budget. | page within 150 KB gzip up front; engine under 12 KB gzip | build test |
| L8 | Seek timings are measured and reported, never assumed. | p50/p95 settle time forward and reverse, per keyframe interval, written as test diagnostics and in `08-measurements.md` | build test |
| L9 | Slow seeking switches to frames when frames exist. | a forced high seek budget breach sets `data-sv-render="frames"`, and frames are exact both ways | build test |

## Tooling

| # | Criterion | Check |
| --- | --- | --- |
| T1 | MP4 and WebM are read without ffprobe: duration, width, height, aspect ratio, rotation, codec, fps, keyframe interval, fast start, audio. | unit (probe) |
| T2 | Unusable files are refused with a reason; heavy or badly encoded files get advice with exact commands. | unit (assess) |
| T3 | `checkConfig` catches every timing, file, word and layout problem in section 3. | unit (config) |
| T4 | The CLI creates, prompts, adds and replaces a video, writes stills, and checks, inside the project only. | unit (CLI) |
| T5 | The interactions gate fails a site whose scroll video does not move, and passes a working one. | build test |

# 6. Implementation plan

Each step lands with the tests that prove it. Paths are in this repository.

| # | Step | Files | Proof |
| --- | --- | --- | --- |
| 1 | Schema and short name `scrollVideo` | `schemas/scroll-video.schema.json`, `src/core/schemas.mjs` | `tests/unit/scroll-video-config.test.mjs` |
| 2 | Pure-JS container reader (MP4 boxes, WebM EBML): duration, size, rotation, codec, fps, keyframe interval, fast start, audio | `src/scroll-video/probe.mjs`; `probeVideo` in `src/media/video.mjs` falls back to it without ffprobe | `tests/unit/scroll-video-probe.test.mjs` (synthetic MP4 and WebM); the build test probes the eight generated WebM clips |
| 3 | Asset checks and compression advice with exact ffmpeg commands; `scroll-scrub` encode role | `src/scroll-video/assess.mjs`, `src/media/video.mjs` | same |
| 4 | Config: defaults, `checkConfig`, `scenesFromStoryboard`, `rescaleScenes`, `recommendLayout`, `newConfig` | `src/scroll-video/config.mjs` | `tests/unit/scroll-video-config.test.mjs` |
| 5 | Prompt generation from storyboard and direction | `src/scroll-video/prompts.mjs` | `tests/unit/scroll-video-config.test.mjs` |
| 6 | Core maths | `skills/app02/recipes/lib/scroll-video-core.js` | `tests/unit/scroll-video-core.test.mjs` |
| 7 | DOM engine, section, CSS, inline mode probe | `skills/app02/recipes/lib/scroll-video.js`, `scroll-video.css`, `sections/ScrollVideo.astro` | `tests/build/scroll-video.test.mjs` |
| 8 | APP-02 module and registry list the new section and files | `src/approaches/app02.mjs`, `registry/approaches/APP-02.json`, `skills/app02/SKILL.md` | `tests/unit/approaches.test.mjs` (existing) |
| 9 | Prebuild pulls configs; static server answers byte ranges | `starters/astro-base/scripts/sync-content.mjs`, `src/gates/serve.mjs` | `tests/unit/scroll-video-cli.test.mjs` |
| 10 | Stills, poster and frame extraction (system ffmpeg, else the browser) | `src/scroll-video/frames.mjs` | build test (browser path) |
| 11 | CLI | `src/cli/scroll-video.mjs`, `src/cli/index.mjs` | `tests/unit/scroll-video-cli.test.mjs` |
| 12 | QA drive in the interactions gate | `src/scroll-video/qa.mjs`, `src/gates/interactions.mjs` | build test runs the gate on the concept site and on a broken site |
| 13 | Media step: `--video-role scroll-scrub` | `src/media/video.mjs`, `src/media/step.mjs`, `configFromPrepared` in `src/scroll-video/project.mjs` | `tests/unit/scroll-video-probe.test.mjs`, `tests/unit/scroll-video-cli.test.mjs` |
| 14 | Agent responsibilities | `agents/*.md`, generated files | `forge agents check`, `tests/unit/agents.test.mjs` |
| 15 | Measurements on this PC and the concept matrix | `docs/scroll-video/08-measurements.md` | build test diagnostics |

State after implementation: every step above is done and tested.

## Test fixtures

`tests/fixtures/scroll-video/make-videos.mjs` draws each concept frame by frame in Chromium (canvas), stamps a 16-bit time code into every frame, and encodes VP9 WebM with the ffmpeg Playwright installs (or a system ffmpeg). Results are cached in the temp folder by a hash of the generator. Concepts differ in subject, duration, frame rate, aspect ratio, keyframe interval, scene count and layout. The time code lets a test read which frame is on screen, so seek accuracy and text sync are measured, not assumed.

## Out of scope for this PR

- H.264 playback in the tests (Playwright's Chromium has no H.264). Real Chrome, Safari and phones are logged by hand in `docs/device-log.md`.
- Changes to the planner's task contracts or the section-plan schema (owned by other PRs). The section plan references the config by id in its composition text until that schema gains a field.
- Calling a video generator. Generation stays with the operator.

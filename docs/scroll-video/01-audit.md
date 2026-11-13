# 1. Audit: where a scroll-controlled video belongs in Forge

Read on 2026-11-13 against `main` at `b1a59a7`. Every claim names the file it comes from.

## What already exists

| Need | Existing piece | File | Verdict |
| --- | --- | --- | --- |
| A pinned, scroll-scrubbed section | APP-02 Cinematic Scroll: `ScrollStory` and `Chapter`, GSAP + ScrollTrigger + Lenis, static stacked fallback | `skills/app02/recipes/`, `src/approaches/app02.mjs` | **Home for the engine.** Scroll video is a cinematic-scroll technique. It ships as a third APP-02 section, `ScrollVideo`, copied by the same `applyApproach`. |
| Deciding full experience or fallback | `capability()`, `loadOrFallback()`, `markMode()` | `starters/astro-base/src/lib/capability.js` | Reused as is. The same triggers (reduced motion, low-end device, slow network, load failure, `?forge-fallback=`) give the same fallback names. |
| Reading a client's clip | `probeVideo` (ffprobe), `placeVideo` (hero loop or story clip), `prepareVideo` (ffmpeg web versions), `registerVideo` (licence rows) | `src/media/video.mjs` | Reused. Two gaps: it needs ffprobe, which most machines here lack, and its encodes use long keyframe intervals, which make scrubbing jerky. The engine adds a pure-JavaScript MP4/WebM reader as the fallback and a `scroll-scrub` role with short keyframe intervals. |
| The media decision | `runMediaStep` writes `design/media-decision.json` and `brief.media` | `src/media/step.mjs` | Reused: `--video-role scroll-scrub` also writes a scroll-video config skeleton. |
| Getting files into the site | `scaffoldSite` copies `assets/public/` into `site/public/`; `scripts/sync-content.mjs` pulls `content/pages/` before every build | `src/site/scaffold.mjs:118`, `starters/astro-base/scripts/sync-content.mjs` | Reused. The prebuild also pulls `design/scroll-video/<id>.json`, so the scene config has one source of truth and cannot drift (the vendored-copy trap recorded on Cold Cafe Brew). |
| Page composition | Frontmatter `- use: "APP-0N/Name"` with props; `SectionList` wraps a section that has an `id` in `data-section` | `docs/starter.md`, `src/components/SectionList.astro` | Reused. A page places `APP-02/ScrollVideo` with `config: "<id>"`; scene words may be overridden from the locked page content. |
| Static serving for gates and preview | `serveSite` | `src/gates/serve.mjs` | Gap: it ignores `Range`, so a browser cannot seek a streamed video the way it can on a static host. Fixed: byte ranges for media. |
| Browser QA | The interactions gate drives toggles, tabs, dialogs, carousels and phone navigation, always with reduced motion | `src/gates/interactions.mjs` | Gap: nothing scrolls a page and checks what moves. The gate gains a scroll-video drive in a capable, motion-allowed context. |
| Agent roles | Creative Director writes `design/**`; Content & UX writes `content/**`; Asset Rights keeps `assets/register.json`; the Builder works only from contracts; QA Verifier runs gates | `agents/*.md` | Reused; each role gets one scroll-video responsibility. No new agent. |
| Budgets | 150 KB gzip up-front JavaScript per page | `src/site/build.mjs` (`JS_BUDGET_BYTES`, `siteReport`) | The engine has no dependencies and loads only on pages that place it. |

## Answers to the audit questions

**Where does the engine belong?** In APP-02, as `skills/app02/recipes/sections/ScrollVideo.astro` with its runtime in `skills/app02/recipes/lib/scroll-video*.js`. It does not use GSAP or Lenis, so a site that uses only `ScrollVideo` ships no GSAP code (Astro bundles a section's script only on the pages that use it), but it shares APP-02's fallback contract and its `forge approach <project> APP-02` install path. A new approach id (APP-09) was rejected: the registry, selection matrix, decision tests and planner all enumerate APP-01 to APP-08, and `src/core/planner.mjs` belongs to other PRs.

**Which agents generate prompts and scene configs?** The Creative Director, which already owns `design/**` and the motion plan, writes the storyboard, the layout and the scene timing in `design/scroll-video/<id>.json`, and runs `forge scroll-video prompts` to turn the storyboard into AI video prompts. Content & UX writes the words of each scene (in the config before B3, or as per-scene overrides in the locked page). Asset Rights registers the generated video.

**How does the Builder receive assets and config?** Through files it does not own: the video, poster and optional frame sequence in `assets/public/video/` (copied to `site/public/video/`), and the config, pulled into `site/src/data/scroll-video/` by the prebuild. The Builder places one frontmatter entry, or renders `ScrollVideo` from a bespoke section, and never edits the engine.

**How does QA validate scroll behaviour?** Three layers: `forge scroll-video check` (schema, timing, files, probe consistency) before the build; the interactions gate, which scrolls every placed scroll video forward and back and checks pinning, seek accuracy, scene order and the fallback; and the build tests, which measure frame accuracy against time-coded videos.

**Which existing components are reused?** `capability.js`, `applyApproach`, `probeVideo`/`prepareVideo`/`registerVideo`, `runMediaStep`, `scaffoldSite`'s asset copy, `sync-content.mjs`, `SectionList`, `serveSite`, `runGate` and the interactions gate, `launchBrowser`/`loadTool`, and the build-test helpers `scaffold()`, `linkModules()` and `addSections()`.

## Constraints that shaped the design

- `src/core/planner.mjs`, `src/design/spec.mjs` and `schemas/design-spec.schema.json` are owned by other PRs, so the section plan and task contracts are not changed. The scroll-video config is its own file with its own schema (`schemas/scroll-video.schema.json`).
- Playwright's bundled Chromium cannot decode H.264. Browser tests therefore use VP9 WebM; MP4 is covered by the container reader and validation, and by the `<source>` order at runtime. This is stated wherever results are reported.
- No system ffmpeg on the development PC. The tests generate their videos with the ffmpeg build Playwright installs (VP9 WebM only); production tooling prefers a system ffmpeg and falls back to frame capture in the browser.

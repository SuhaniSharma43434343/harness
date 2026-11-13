---
name: app02
description: APP-02 Cinematic Scroll. Add pinned, scroll-scrubbed story sections and chapter reveals with synced smooth scroll to a Forge site, with a static fallback. Use when the approach decision selects APP-02.
---

# APP-02: Cinematic Scroll

Pinned sections, scroll-scrubbed reveals and section transitions, built on GSAP, ScrollTrigger and Lenis. These load only on pages that use an APP-02 section, and only when the device can take them.

## Inputs

- `design/approach-decision.json` with APP-02 selected
- The site from APP-01 (`forge site <project>`)
- Locked content in `content/pages/`. APP-02 changes how content moves, never what it says.

## Steps

1. Run `forge approach <project> APP-02`. This copies the sections into `site/src/sections/APP-02/` and the runtime into `site/src/lib/app02/`. It adds `gsap` and `lenis` (exact versions) to `site/package.json` and installs them. It also adds licence rows to `assets/register.json` and lists APP-02 in `src/site.json`.
2. Place the sections in a page's frontmatter, after the hero:
   ```yaml
   - use: "APP-02/ScrollStory"      # pinned; scrubs through 2 to 6 steps
     heading: "How it works"
     steps:
       - { title: "...", text: "..." }
   - use: "APP-02/Chapter"          # full-height chapter opener that scrubs in
     eyebrow: "..."
     heading: "..."
     text: "..."
     image: { src: "/images/x.webp", alt: "...", width: 1200, height: 800 }
   ```
   The step and chapter text comes from the locked content.
3. Style the sections only with token custom properties. Motion distances and durations come from `--motion-*`, which drop to zero under reduced motion.
4. Build with `cd site && npm run build`, then run `forge gates <project>`.

## ScrollVideo: the scroll video engine

A continuous video scrubbed by scroll, pinned while its scenes play, from a config alone. It does not use GSAP or Lenis: it pins with `position: sticky` and seeks the video itself, so a page with only `ScrollVideo` ships about 5 KB of engine and no GSAP. The full design, schema, workflow and acceptance criteria are in `docs/scroll-video/`.

1. The Creative Director starts the config and storyboard: `forge scroll-video new <project> <id> --beats 5 --layout cinematic`, then `forge scroll-video prompts <project> <id>` for the operator's video generator.
2. Asset Rights adds the generated clip: `forge scroll-video add-video <project> <id> --video <file> [--video <phone cut> --media "(max-width: 47.99em)"] --licence "..."`. It reads the file (no ffprobe needed), refuses one that cannot work, makes a poster and prints compression advice (a keyframe every 0.2 s matters most).
3. Check the scene markers by eye with `forge scroll-video stills <project> <id>`, then `forge scroll-video check <project> <id>`.
4. Place it:
   ```yaml
   - use: "APP-02/ScrollVideo"
     config: "<id>"               # design/scroll-video/<id>.json, pulled in by the prebuild
     scenes:                       # optional: locked words by scene id; timing stays in the config
       - { id: "...", title: "...", description: "..." }
   ```
5. Layouts: `cinematic`, `sticky-text`, `split`, `product`, `background`, `labels` (`forge scroll-video layouts`). Never edit `scroll-video*.js`, `scroll-video.css` or `ScrollVideo.astro` for a project; everything project-specific is config.

Its fallback is the same contract as the other sections, recorded per section on `data-sv-mode` and `data-sv-reason`: the poster and every scene stacked, no video downloaded. A load that fails or stalls past `loadTimeoutMs` is `load-failed`; a config with no video yet is `no-source`. With a frame sequence (`forge scroll-video frames`), slow seeking switches to frames instead (`data-sv-render="frames"`).

## Fallback

The page starts as a static stacked layout, so it works without JavaScript. The runtime (`cinematic.js`) upgrades it only when `capability()` allows. Otherwise the steps stay stacked and fade in with CSS. `<html data-app02>` records the outcome, `full` or `fallback`, and `data-app02-reason` says why:

| Trigger | Reason |
| --- | --- |
| `prefers-reduced-motion: reduce` | `reduced-motion` (no reveal animation either) |
| Fewer than 4 cores or under 4 GB memory | `low-end-device` |
| Save-Data, or a 3G or slower connection | `slow-network` |
| GSAP, ScrollTrigger or Lenis fails to load within 8 s | `load-failed` |
| `?forge-fallback=<reason>` in the URL | that reason (for checks) |

## Budget

- At most 60 KB of extra JavaScript (gzip) over APP-01. GSAP, ScrollTrigger and Lenis come to about 51 KB.
- No layout shift: CLS at most 0.1. The pinned layout is applied before ScrollTrigger measures.
- Frames: under 33 ms on a mid-range phone, logged by hand in `docs/device-log.md`.

## Licences

- **Lenis:** MIT.
- **GSAP:** its own "Standard 'no charge'" licence, which is not open source. Its register row starts as `uncertain`, and the dependencies gate blocks until Asset Rights confirms that the terms allow this client site and records the evidence.

## Done when

- For ScrollVideo: `tests/build/scroll-video.test.mjs` passes (three concepts frame-accurate both ways, seven industry scenarios, phone touch, resize, fallbacks, slow network, frames switch, the gates).

- `tests/build/app02.test.mjs` passes. It covers the build, the routes, accessibility and responsive gates, all four fallbacks, and the budget.
- The real-device rows for the project are filled in `docs/device-log.md`.

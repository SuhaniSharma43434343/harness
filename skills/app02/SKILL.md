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

- `tests/build/app02.test.mjs` passes. It covers the build, the routes, accessibility and responsive gates, all four fallbacks, and the budget.
- The real-device rows for the project are filled in `docs/device-log.md`.

# Approaches

Forge has eight website approaches. The selector picks only the ones a brief justifies (`forge select <brief.json>`, `docs/registry.md`). This page covers what each approach is, which ones have a working module, and how modules are applied.

## The eight approaches

| Approach | What it is | Fallback | Module |
| --- | --- | --- | --- |
| APP-01 AI to Full Website | The multi-page site from the brief, content and tokens. Every project uses it | n/a | Built: the starter (`docs/starter.md`) |
| APP-02 Cinematic Scroll | Pinned sections, scroll-scrubbed reveals, smooth scroll | Static stacked layout with CSS reveals | Built (T19) |
| APP-03 Interactive 3D | A lazy-loaded Three.js scene behind a poster | Poster image plus CSS depth | Not built (engine side) |
| APP-04 Spline + Website | The operator's Spline scene behind a poster | APP-03 scene or the poster | Built (T20). Experimental, needs B2. Its scene comes in through the spline plugin |
| APP-05 Shader / WebGL | A GLSL background or transition with a quality ladder | CSS gradient or a static frame | Not built |
| APP-06 Game-Like | One bounded game mechanic over an explainer | The explainer with the same content | Built (T20). Experimental, needs B1 |
| APP-07 AI + 3D + Motion + Real | APP-01, 02 and 03 in one site under a shared budget | APP-01 plus APP-02 | Not built (needs APP-03) |
| APP-08 Image to Frame Animation to 3D | A scroll-scrubbed frame sequence and a depth-map parallax scene | A static key frame | Not built |

The selection matrix (`registry/selection-matrix.json`) gives each approach's status per project type: default, optional, experimental (needs approval) or excluded. Each registry entry's `verification` is one of `not-started`, `in-development`, `implemented` or `verified`. It moves to `verified` only with real-project and real-device evidence.

## Approach modules

Every approach has a registry entry (`registry/approaches/APP-0N.json`, see `docs/registry.md`), selection rules, and, once it is built, a module: a skill (`skills/app0N/SKILL.md`) plus code recipes (`skills/app0N/recipes/`) that `forge approach` copies into a project's site.

APP-01 is the starter itself (`docs/starter.md`). Every other module adds sections on top of it and never replaces it.

```sh
forge approach <project> APP-02              # copy the recipes, add the packages, install
forge approach <project> APP-02 --no-install # the same, without npm install
```

`forge approach` only applies an approach that `design/approach-decision.json` selects. An experimental approach also needs its recorded approval (B1 or B2).

## What applying a module does

`applyApproach(module, siteDir)` in `src/approaches/apply.mjs`:

1. Copies `recipes/sections/` to `site/src/sections/APP-0N/` and `recipes/lib/` to `site/src/lib/app0N/`.
2. Adds the module's packages to `site/package.json` at exact versions, then runs `npm install` to update the lockfile.
3. Adds a licence row per package to `assets/register.json`. A package whose licence is not verified gets `status: uncertain` and no evidence, so the dependencies gate blocks until Asset Rights records the evidence.
4. Lists the approach in `site/src/site.json`.

Applying twice gives the same site. Placing the sections on pages is the builder's job (see each skill).

## Fallbacks

Up-front JavaScript, which is what the APP-01 budget of 150 KB limits, is what a page loads before anything on demand: its scripts and their static imports. `siteReport` reports it as `jsBytes`, the on-demand chunks as `lazyJsBytes`, and everything as `totalJsBytes`. Approach libraries are always dynamic imports, so they count against their own budget, not APP-01's.

Every module's runtime asks `capability({ webgl, plugin, motion })` (`starters/astro-base/src/lib/capability.js`) whether it may run in full, and records the answer on `<html>` as `data-app0N="full|fallback"` and `data-app0N-reason`. The reasons are:

- `reduced-motion`
- `low-end-device` (fewer than 4 cores or under 4 GB memory)
- `slow-network` (Save-Data or 3G or slower)
- `no-webgl`
- `plugin-missing`
- `load-failed` (the full experience did not load within 8 s)

`?forge-fallback=<reason>` in the URL forces a reason, for checks and screenshots. The page's first HTML is always the fallback, so a site without JavaScript is complete.

## Modules

| Approach | Module | Sections | Packages | Fallback | Budget | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| APP-02 Cinematic Scroll | `src/approaches/app02.mjs`, `skills/app02/` | `ScrollStory` (pinned, scrubbed steps), `Chapter` (scrubbed chapter opener) | gsap 3.15.0 (own licence, unverified), lenis 1.3.27 (MIT) | Static stacked layout with CSS reveals | +60 KB JS gzip (measured about 51 KB), CLS ≤ 0.1 | `tests/build/app02.test.mjs` |
| APP-04 Spline + Website (experimental, B2) | `src/approaches/app04.mjs`, `skills/app04/` | `SplineScene` (scene behind a poster, events wired both ways) | @splinetool/runtime 2.0.79 (no licence on npm, unverified) | The poster (APP-03 scene once that module exists) | Runtime after LCP and load; measured about 1.1 MB gzip on demand | `tests/build/app04.test.mjs` |
| APP-06 Game-Like (experimental, B1) | `src/approaches/app06.mjs`, `skills/app06/` | `Game` (collect each item; keyboard, pointer, progress, sound, skip) | phaser 4.2.1 (MIT) | The explainer with the same content, always in the page | +400 KB JS gzip (measured about 350 KB), ≥ 30 fps, after load | `tests/build/app06.test.mjs` |

## Gaps

- **APP-04 real scene:** the tests cannot render a real Spline scene. That needs a real scene from the operator's account. `forge approach <project> APP-04` copies the brief's `features.splineSceneUrl` into `site/public/spline/` through the spline plugin when it is enabled and B5 is recorded, and otherwise keeps the poster and says why. The tests check that path with the plugin's mock. In the browser they serve an invalid scene, and check load ordering and the `load-failed` fallback instead.
- **APP-03 fallback for APP-04:** the registry names APP-03 as APP-04's first fallback. That module is not built, so APP-04 falls back to the poster.
- **Real devices:** every module still needs its rows in `docs/device-log.md` before its registry status can move from `implemented` to `verified`.

## Acceptance tests

Each module's build test does the following, per the plan:

- **Build:** scaffolds a sample brief that selects the approach, applies the module, places its sections and builds. Then it runs the routes, accessibility and responsive gates on the result.
- **Fallback:** forces each trigger and checks the fallback by DOM assertion and screenshot. The triggers are reduced motion, a low-end device, a slow network, a blocked library (failed load) and, where they apply, WebGL off and the plugin disabled.
- **Budget:** measures the extra JavaScript against an APP-01 build of the same brief, CLS while scrolling, and a frame-time probe. With `FORGE_SLOW_TESTS=1` it also runs Lighthouse mobile through the performance gate.

The tests install the module's packages once into a cache folder, so they need the network on their first run and skip with the reason without it. Real-device checks are manual, and are logged in `docs/device-log.md`.

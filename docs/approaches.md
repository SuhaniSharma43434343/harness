# Approach modules

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

Every module's runtime asks `capability()` (`starters/astro-base/src/lib/capability.js`) whether it may run in full, and records the answer on `<html>` as `data-app0N="full|fallback"` and `data-app0N-reason`. The reasons are:

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

## Acceptance tests

Each module's build test does the following, per the plan:

- **Build:** scaffolds a sample brief that selects the approach, applies the module, places its sections and builds. Then it runs the routes, accessibility and responsive gates on the result.
- **Fallback:** forces each trigger and checks the fallback by DOM assertion and screenshot. The triggers are reduced motion, a low-end device, a slow network, a blocked library (failed load) and, where they apply, WebGL off and the plugin disabled.
- **Budget:** measures the extra JavaScript against an APP-01 build of the same brief, CLS while scrolling, and a frame-time probe. With `FORGE_SLOW_TESTS=1` it also runs Lighthouse mobile through the performance gate.

The tests install the module's packages once into a cache folder, so they need the network on their first run and skip with the reason without it. Real-device checks are manual, and are logged in `docs/device-log.md`.

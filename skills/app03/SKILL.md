---
name: app03
description: APP-03 Interactive 3D. Add a lazy-loaded Three.js scene (a glTF model or a procedural object) with drag, keyboard and scroll interaction, behind a poster, to a Forge site. Use when the approach decision selects APP-03 (showroom, product, data visualisation, and a device floor that allows it).
---

# APP-03: Interactive 3D

A Three.js scene behind a poster. The poster is the first paint and the LCP element. Three.js, the glTF loader and the model load only after the page has loaded, and only when the section comes near the viewport.

## Inputs

- `design/approach-decision.json` with APP-03 selected
- A poster image for each scene (also the fallback)
- Optionally, a model as `.glb` (plain or meshopt-compressed), at most 3 MB, with its source and licence

## Steps

1. Run `forge approach <project> APP-03`. This copies `Scene3D` and the runtime, adds `three` (exact version) and records its licence.
2. For a model, put it in `site/public/models/` and register it with `registerModel(projectDir, { file, path, source, licence })` from `src/approaches/app03.mjs`. A model over 3 MB, or one without a source and licence, is refused.
3. Place the section:
   ```yaml
   - use: "APP-03/Scene3D"
     heading: "Turn it over"
     text: "..."
     model: "/models/lamp.glb"        # leave out for a procedural object in the token colours
     poster: { src: "/images/lamp.webp", alt: "...", width: 1200, height: 800 }
   ```
4. Build, then run `forge gates <project>`.

## Interaction

- **Drag:** turns the object.
- **Arrow keys:** turn the object when the canvas has focus. The canvas is focusable and labelled with the poster's alt text plus how to turn it.
- **Scrolling past:** adds a slow turn.

## Fallback

The poster with a gentle CSS depth tilt that follows the pointer. It is used for:

- reduced motion, which gets the poster without the tilt;
- no WebGL;
- a low-end device;
- a slow network;
- a failed or stalled load;
- frames that stay too slow after the resolution has dropped to 1x.

The mode is recorded on `<html>` as `data-app03` and `data-app03-reason`.

## Budget

- At most 250 KB of extra JavaScript (gzip), all of it loaded on demand. Three.js is about 180 KB.
- At most 3 MB of assets.
- 30 fps on a mid-range phone. The runtime measures frame times and drops to 1x resolution, then to the poster.
- Only one WebGL section runs at a time (`lib/app03/webgl-slot.js`). The headless check is in `tests/build/app03.test.mjs`, and real devices are logged in `docs/device-log.md`.

## Licences

- **Three.js:** MIT.
- **Models:** each one needs a row in `assets/register.json`, added by `registerModel`.

## Done when

- `tests/build/app03.test.mjs` passes: build, gates, keyboard turning, one canvas at a time, the five fallbacks and the budget.
- The device log rows are filled in.

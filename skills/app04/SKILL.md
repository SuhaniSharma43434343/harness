---
name: app04
description: APP-04 Spline + Website. Embed the operator's Spline scene behind a poster, lazy-loaded after the page, with scene events wired to the page. Use when the approach decision selects APP-04 and B2 records it.
---

# APP-04: Spline + Website

APP-04 adds an embedded scene from the operator's own Spline account, for a designer-edited micro-3D hero or a feature visual. The scene loads after the page, behind a poster. It is experimental: B2 must record it before `forge approach` applies it.

## Inputs

- `design/approach-decision.json` with APP-04 selected, and B2 recorded
- The scene: a `.splinecode` URL from the operator's account, or a file in `site/public/`. The Spline plugin (T08) will supply this from the account.
- A poster image (`site/public/images/`) with a licence row in `assets/register.json`. The poster is the first paint and the fallback.

## Steps

1. Run `forge approach <project> APP-04`. This copies `SplineScene` and the runtime, then adds `@splinetool/runtime` (exact version) and its licence row.
2. Place the section in a page:
   ```yaml
   - use: "APP-04/SplineScene"
     heading: "..."
     text: "..."
     scene: "https://prod.spline.design/<id>/scene.splinecode"
     poster: { src: "/images/scene-poster.webp", alt: "...", width: 1200, height: 800 }
     events:   [{ on: "mouseDown", object: "Button", dispatch: "scene:open" }]       # scene -> page
     triggers: [{ selector: "#explore", event: "click", emit: "mouseDown", object: "Cube" }]  # page -> scene
   ```
   A scene event dispatches a DOM `CustomEvent` on the section (`detail: { object, event }`). A trigger emits a Spline event when the element fires.
3. Build, then run `forge gates <project>`.

## Fallback

The poster is always in the page. The runtime loads only after the load event, when the browser is idle and the scene is near the viewport. It also loads only when `capability({ webgl: true, plugin: Boolean(scene) })` allows. `<html data-app04>` records the outcome:

| Trigger | Reason |
| --- | --- |
| No `scene` | `plugin-missing` |
| No WebGL | `no-webgl` |
| Reduced motion | `reduced-motion` |
| Fewer than 4 cores or under 4 GB memory | `low-end-device` |
| Save-Data, or 3G or slower | `slow-network` |
| The runtime or the scene fails to load within 10 s (`data-timeout` on the section) | `load-failed` |

The registry names an APP-03 scene as the first fallback. Until the APP-03 module exists, the fallback is the poster.

## Budget

- Up-front JavaScript stays under the APP-01 budget: the runtime is a dynamic import.
- The runtime is requested only after LCP and the load event.
- The runtime is large: about 1.1 MB gzip across its chunks, measured in `tests/build/app04.test.mjs`. Record the project's measured size in its report.

## Licences

`@splinetool/runtime` lists no licence on npm, so its register row starts as `uncertain`. The dependencies gate blocks until Asset Rights reviews the Spline terms for this client and records the evidence. The scene itself needs a register row too.

## Done when

- `tests/build/app04.test.mjs` passes.
- A real scene from the operator's account renders on the project. This is checked by hand and logged in `docs/device-log.md`.

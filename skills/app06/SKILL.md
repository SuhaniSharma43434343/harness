---
name: app06
description: APP-06 Game-Like. Add one bounded game (collect each item to open it) with keyboard and touch controls, progress, optional sound and a skip control, over an explainer with the same content. Use when the approach decision selects APP-06 and B1 confirms play is the point.
---

# APP-06: Game-Like

APP-06 adds a bounded game with one mechanic. The visitor moves a light around the stage and collects an orb for each item, and each orb opens that item in the explainer below. It is experimental: B1 must record that play is the point before `forge approach` applies it.

## Inputs

- `design/approach-decision.json` with APP-06 selected, and B1 recorded
- Locked content for the items, two to eight, each with a title and text

## Steps

1. Run `forge approach <project> APP-06`. This copies the `Game` section and the runtime, then adds `phaser` (exact version) and its licence row.
2. Place the section:
   ```yaml
   - use: "APP-06/Game"
     id: "stages"
     heading: "Find the three stages"
     intro: "..."
     items:
       - { title: "...", text: "..." }
   ```
3. Build, then run `forge gates <project>`.

## How it plays

- **Controls:** arrow keys or WASD move the light. A press or drag on the stage, by touch or mouse, moves it towards that point. The stage is focusable, and its instructions are linked by `aria-describedby`.
- **Progress:** each collected item opens in the explainer. Progress is announced (`role="status"`) and kept for the visit in `sessionStorage`.
- **Sound:** off until the visitor turns it on. The sounds are synthesised with Web Audio, so there are no audio files to license.
- **Skip:** "Skip the game" ends it, opens every item and moves focus to the explainer.
- **Reduced motion:** the game still runs, without the bobbing animation.

## Fallback

The explainer (`details` and `summary`, one per item) is always in the page, so every item can be read without playing. The game loads after the page, when the section is near the viewport, and only when `capability({ webgl: true, motion: false })` allows. Reasons: `no-webgl`, `low-end-device`, `slow-network`, `load-failed`. The fallback shows the explainer alone.

## Budget

At most 400 KB of extra JavaScript (gzip); Phaser is about 350 KB. It loads after the page. It must run at 30 fps or more on a mid-range phone: the headless check is in `tests/build/app06.test.mjs`, and the real-device check is logged in `docs/device-log.md`.

## Licences

- **Phaser:** MIT.
- **Physics:** no physics library is needed, because the mechanic uses only Phaser's distance checks.
- **Audio files:** none ship.

## Done when

- `tests/build/app06.test.mjs` passes. It covers the build, the gates, keyboard and pointer play, skip, reduced motion, the four fallbacks and the budget.
- The device log rows are filled in.

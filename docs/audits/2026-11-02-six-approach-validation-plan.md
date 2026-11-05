# Validation plan: the other six approaches

APP-01 and APP-02 are being tested first. A written methodology proves nothing, so the other six stay unproven until each has run through the same clean test. This plan runs after the Harbor and Saltline validation, one approach at a time, each with its own approved budget. None of it is covered by the current $15 limit.

## Rule for moving on

An approach moves on only when its run reports:
- no manual code or content edits;
- a chosen approach preserved, according to both the render check and the visual review;
- every release check marked passed, failed, blocked or not applicable, with evidence.

A failure in the harness itself is fixed and retested before the next approach starts. A failure specific to the approach goes in its report.

## Order and test briefs

The order runs from least to most outside dependency, so each run tests something new on top of what is already proven. Budgets are estimates, based on the $13 to $19 of the earlier runs.

| # | Approach | Test brief (invented client) | What it must prove | Needs first | Estimate |
| --- | --- | --- | --- | --- | --- |
| 1 | APP-05 Shader | A ceramics studio that fires with wood: a concept-derived heat shader, sparse portfolio pages | One authored shader, not a generic gradient; readable type over the field and over its fallback; the quality ladder | Nothing | $15 to $20 |
| 2 | APP-08 Frames | A paper-marbling workshop: a scroll-scrubbed sequence of ink spreading | Pinned frame stage; frame provenance on record; lag-free scrubbing; key-frame fallback | Frames: the operator supplies them, or we approve how they are made | $15 to $25 |
| 3 | APP-03 3D | A hand-built bicycle frame, in a showroom with interaction that teaches | One object; hotspots that reveal real features; the poster sells it before WebGL loads; **mobile profiled**, a known gap | A licensed `.glb`, or a procedural object on purpose | $20 to $30 |
| 4 | APP-07 Composite | A port operator's tier L flagship: one globe across pinned chapters | One world, not a collage; shared budget; one canvas at a time; a real multi-page structure | APP-02 and APP-03 proven first. A licensed model | $30 to $45 |
| 5 | APP-04 Spline | A SaaS scheduling tool with a small playful scene | Page and scene exchange events; works without the scene. **The team has never shipped real Spline**, and it is experimental (B2) | A real scene from the operator's Spline account, and the spline plugin enabled (B5) | $15 to $20 |
| 6 | APP-06 Game | A museum's "find the three stages" exhibit guide | One bounded mechanic; keyboard, touch and skip; the explainer holds the same content. **No team evidence exists**, and it is experimental (B1, client confirms play is the point) | The client's B1 confirmation | $20 to $30 |

## What each run must also check

The current render check tests these approaches less well than APP-01 and APP-02. Each row below needs work before or during its run:

- **APP-03, 04, 05, 07:** the gate sees that a canvas exists, not that the scene looks right or runs at the budgeted frame rate. It needs a frame-time probe and a capture of the canvas in the review screenshots.
- **APP-06:** the gate looks only for a marker. It needs a scripted playthrough: move, collect, finish, skip.
- **APP-08:** it needs a check that frames change with scroll, and that every frame has provenance.
- **All:** real-device checks in `docs/device-log.md`. Automated rendering is not a phone.

## Decisions needed before starting

1. A budget per approach: the total estimate is about $115 to $170.
2. Whether Nidhi's approach definitions change any of these briefs.
3. Who supplies the frames, the 3D model and the Spline scene.

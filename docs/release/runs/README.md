# Release runs (T28), 2026-10-29

All runs on Linux x64 (Node 22.22.0), with Claude Code 2.1.312 as every agent. `scripts/release-run.mjs` writes one report per site; the newest are the `-model` files.

## Full workflow with Claude Code (`--model`)

`node scripts/release-run.mjs <site> --fresh --model` runs the whole workflow: intake, research, directions, content, the asset register, the build with every selected approach, the gates, the QA Verifier and repair loop, then a local preview and the final report. The script gives the approvals the operator would (B1, B2, B3 and an experimental approach's approval, each with a note saying so) and stops at PREVIEW_REPORT, because accepting the preview (B6) is the operator's decision.

| Site | Approaches selected | Placed on pages | Reached | Quality floor | Model time |
| --- | --- | --- | --- | --- | --- |
| business | APP-01, APP-02 | APP-02 ScrollStory | PREVIEW_REPORT | met, 11 of 11 gates | about 9 min (research 33 s, content 52 s, assets 37 s, repair 414 s) |
| showroom | APP-01, 02, 03, 04, 07 | APP-02 ScrollStory and Chapter, APP-03 Scene3D, APP-04 SplineScene | PREVIEW_REPORT | met, 11 of 11 gates | about 10 min |
| story | APP-01, 05, 06, 08 | APP-05 ShaderBackground, APP-06 Game, APP-08 DepthParallax | PREVIEW_REPORT | met, 11 of 11 gates | about 9 min |

Reports: `2026-10-29-business-model.md`, `2026-10-29-showroom-model.md`, `2026-10-29-story-model.md`.

**What the reports also show, and what is not proven yet**

- **One exit gate was skipped on every site.** INTEGRATION_TESTS needs the forms and content-parity gates to pass, but the form endpoint and the approach sections are only fixed by the repair loop, which runs in QUALITY_REVIEW. The script skips that exit with `advancePhase` and lists it in each report (integration log, blocker 3).
- **Content & UX could not start where the workflow expects.** `forge run --advance` moves into CONTENT and then fails to plan, because the content task starts from the site's draft pages and the site is only scaffolded in BUILD. The script runs `forge site` first (blocker 2).
- **Asset register:** in the first set of model runs the showroom's asset task left the favicon `uncertain`, so its ASSETS_LICENSING exit was skipped; in the runs above it cleared.
- **No person has accepted a preview (B6).** A8's floor is met; A4 needs an operator's acceptance.
- **The Spline scene is the brief's example URL,** so APP-04 shows its poster. The screenshots come from a headless browser and may show posters rather than the live 3D, shader or game, so each needs a look on a real device (`docs/device-log.md`).
- **The gates do not judge how a page looks.** In the screenshots the scroll-story sections leave long empty stretches when captured as a still page. A person should look at each preview.

## Before the approach check

The first `--model` runs, an hour earlier, also met the floor on all three sites, but no page used any approach: the modules were installed and never placed. Content parity now fails a selected approach with no section on a page (`approach-unused`), and the repair loop placed them in the runs above.

## Repair loop only (`--repair`)

Earlier runs started the repair loop on a fresh scaffold, before the planner existed. They found most of the fixes in this pull request; see `2026-10-29-business-repair.md`.

## Commands only

`node scripts/release-run.mjs all --fresh` runs every command with no model: `2026-10-29-business.md`, `-showroom.md`, `-story.md`. `forge advance` stops at CONTENT (B3) on all three.

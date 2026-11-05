# Design workflow: test report

Date: 2026-11-02. Audit: `2026-11-02-design-generation.md`. How it works: `docs/design-workflow.md`.

## Result in one paragraph

The harness now writes a full design specification, builds bespoke sections from it, and checks the result in a browser and through a model reviewing screenshots. Two very different real runs produced sites that look designed rather than templated, and QA caught and repaired real faults. **It is not finished:** neither run was a clean, hands-off pass on the final code. I had to step in during both, and neither site passes the full release floor yet.

## The two test sites

Both are invented sample clients with rich client notes, built with `claude-sonnet-5-5` through `scripts/design-e2e.mjs`.

| | Harbor Home Renovations | Saltline Chocolate |
| --- | --- | --- |
| Brief | Service business, motion 1 | Product launch, motion 3 |
| Approach chosen | APP-01 (the only one the brief allowed) | APP-02, over APP-01, with its own reasons |
| Concept | The site reads like Ruth's itemised written quote | One scroll following the bar through two tides, the salt arriving last |
| Sections planned | 20 on 3 pages | 13 on 2 pages |
| Visual assets | 10 Unsplash photos plus authored SVG drawings | All authored SVG: contour maps, salt crystals |
| Repair loops | 2 | 3, then escalated |
| Review scores of 5 (distinctive, composition, type, content, spec) | 4, 3.8, 3.7, 4.2, 3.8 | 4, 3.8, 4.2, 4.1, 3.8 |
| Model cost | $13.13 | $18.52 |

Screenshots are in each project's `evidence/`.

## Your seven checks

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Approach followed as a complete method | **Works** | Two different methods gave two very different sites. Reviews set `approachPreserved` true, and the render check passes: no pinning on APP-01, pinning on APP-02 |
| 2 | Every section has real content and a defined layout | **Works** | Harbor 20 and Saltline 13 sections pass the copy and section checks. Content parity passes on both. It caught a dropped line on Harbor |
| 3 | Consistent theme and type system | **Works** | Font check at render passes. Fonts and colours stay as approved at B2 |
| 4 | Assets and animation specified | **Works** | Every id resolves. Motion checked in the browser on each page |
| 5 | Responsive | **Works, with limits** | The responsive gate passes on both; 390 px layouts are composed. 2 real overflow bugs were caught and fixed on Harbor. No real-device testing |
| 6 | QA detects incomplete or generic output | **Works** | The old Harbor skeleton fails: with no spec it gets `no-design-spec`; against a real spec it gets 12 missing sections, wrong font, wrong approach, no visuals. Automated tests cover card grids, repeated layouts, dead motion, placeholders and stale reviews |
| 7 | Failures and retries | **Works, with bugs found on the way** | The review opened 14 issues on Harbor and 20 on Saltline. All but one were fixed and verified by a later review |

## What the runs caught

- **Stock photos passed off as the client's work:** "Back Cove deck, finished" over a photo of bare joists. The reviewer flagged it. I added a rule against this afterwards, but **Harbor's copy was written before the rule, and its hero still captions a stock kitchen as "The Munjoy Hill kitchen"**. The rule is not yet tested.
- A broken floor-plan drawing, a mislabelled "Duration 1920s bathroom", a 3-row mobile header, contrast failures, and 13 px sideways scroll.

## Where I stepped in

1. **Approvals:** the test script gave B1, B2 and B3 itself, always choosing the first direction. A real run stops and asks.
2. **Harbor, invented page:** the planner invented a `/_chrome` page for the header and footer. I removed it by hand, and the check now refuses it.
3. **Harbor, restart:** my motion check had a bug, so I fixed it, then set the blocked build task to re-verify by hand instead of re-running it.
4. **Both, review loop:** the Design Manager's review kept sending work back over small details and escalated Saltline. I tightened what counts as blocking and restarted both runs mid-way.
5. **Saltline's escalation was a false alarm:** the last defect was a false positive. The ground colour does drift (I probed it across the scroll), but my check sampled only one position. The gate is fixed and now passes that site. The escalation path itself worked correctly. The repair loop was not re-run with the fixed check.

Harness bugs these runs found and I fixed: blocked tasks counting after their fix was done, dependants waiting on a replaced task, retries not being told what failed, and the licences gate crashing on any approach that adds a package.

## The full release floor, on the finished sites

Design QA uses 6 gates. The full floor has 13:

| Gate | Harbor | Saltline |
| --- | --- | --- |
| content-parity, licences, secrets, routes, accessibility, forms, responsive, design-fidelity, visual-review | pass | pass |
| dependencies | pass | **fail:** GSAP's licence needs a recorded decision |
| claims | **fail:** "5-year written guarantee" lacks a source link | **fail:** a similar unsourced claim |
| seo | **fail:** no site URL yet | **fail:** no site URL yet |
| performance | **fail:** LCP 2.86 s (budget 2.5 s) | **fail:** LCP 2.71 s, score 89 |

Design QA does not repair these, so they would be found only at release.

## What still needs work

1. **A clean run:** repeat one brief end to end on the final code with no hands on it. Nothing here proves the review now settles without help.
2. **Cost:** $13 to $19 a site on Sonnet, with reviews and repairs the largest share. The spend cap only covers the specification and build, not the QA loop.
3. **Photos:** agents cannot source images, so a brief with no photos gets illustration only. Picture sourcing needs your decision, because it means downloading.
4. **Art direction:** B2 still picks from a palette and font catalog, which limits how distinctive an identity can be.
5. **Taste:** I would call both sites competent and distinct, not award level. Harbor is text-heavy, at the 40% visual floor. Saltline is very long, and its pinned scenes depend on a mid-range device.
6. **The other 6 approaches** have methodologies but have not been run. APP-04 and APP-06 have no team evidence at all.
7. **`forge doctor --json`** still crashes on exit, as it does on main (1 failing test).
8. **Nidhi:** the methodologies are partly my interpretation, and she should review them. The new gates and agent also change frozen interfaces, so `docs/interfaces.md` needs both owners' approval. Her open PRs #33 and #36 overlap.

## Automated tests

`npm test` on the final code: 661 tests, 657 pass, 3 skipped, 1 fail (`forge doctor`, which also fails on main).

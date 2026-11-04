# Integration log (T26) and review history (T27)

One entry per integration session: what was merged, what was checked, and the blockers, each with an owner. Newest first.

## 2026-10-29

**Merged on main today:** #7 (M1 signatures), #9 (T18), #14 to #21 (T17, T23, T21, T22, T24, T19, T20, T25), #28 (T12), #29 (T29, `forge audit`), #30 (`forge advance`, preview, deploy, report, test and demo), #31 (the planner), #32 (typed intake answers), and Suhani's later fixes. Every build task from T01 to T25 is on main.

**Tests:** on `bddae26` (before #29), all 609 tests passed on Linux with the browser tools and `FORGE_SLOW_TESTS=1`, none skipped. This branch, merged with main at `21a8e23`: 643 tests with the browser tools and slow tests, 642 pass on the first run; the one failure is a timing test (blocker 10) that passes when re-run.

**Checked in this session:**

- **T28 release runs.** All three release websites went from brief to a local preview with Claude Code, with the quality floor met and every selected approach on a page (`runs/README.md`). Earlier runs found seven problems; the fixes are in this pull request:
  - the licences gate threw on the package rows that `forge approach` writes;
  - intake dropped the brief file's fields that no question fills (`integrations`, `features.splineSceneUrl`), so APP-04 was never selected from a brief file;
  - there was no way to rebuild a site after `forge approach` (now `forge site --build-only`);
  - the repair verifier checked the old `site/dist`, so every fix in `site/src` failed (it now builds first);
  - the forms gate passed an invented `action="/api/contact"` for a form-function form (now `wrong-endpoint`);
  - the repair loop spent three rounds on content-parity, which no builder can fix (a skipped gate gets no task now);
  - all three sites met the floor with no approach placed on any page (content parity now reports `approach-unused`).
- **T30.** The ZIP extracts and passes its tests on a second machine (`clean-extract-2026-10-29.md`).
- **T27.** Nidhi reviewed #29 on GitHub.

**Blockers:**

| # | Blocker | Blocks | Owner | Next step |
| --- | --- | --- | --- | --- |
| 1 | No independent tester is named, the harness licence is not chosen, and the three release websites need confirming. | A15, A14, T28, T31 | Both | Decide (plan, "Decisions to confirm"). The proposed briefs are in `samples/release/`. |
| 2 | `forge run --advance` moves from UX_DESIGN_SYSTEM into CONTENT, then the planner fails: the content task starts from the site's draft pages, and the site is only scaffolded at BUILD. | A4 | Suhani (planner), with Nidhi (starter) | Scaffold the site (`forge site`, no build) when CONTENT is planned, or seed the drafts from the brief without a site. |
| 3 | INTEGRATION_TESTS needs forms and content-parity to pass, but the form endpoint and the approach sections are only fixed by the repair loop, which runs in QUALITY_REVIEW. Every release run had to skip this exit. | A4, A8 | Shared | Either a BUILD task places the approach sections and sets each form's endpoint, or INTEGRATION_TESTS checks only routes until repair has run. |
| 4 | Nothing but the repair loop places the approach sections: the planner's content task keeps the draft's APP-01 sections. | A7, A8 | Shared | Give the content task (or a BUILD task) the selected approaches and their skills. |
| 5 | In every real-model run a builder decided licences itself: GSAP `cleared`, and the Spline runtime `recorded`. The repair task owns `assets/register.json`, so a builder can settle rights the plan leaves to Asset Rights and the operator. | A8, A13 | Shared | Decide whether a repair task may change a row's `status`; if not, the verifier refuses it. Then read the GSAP and Spline terms once and record them in the modules. |
| 6 | `scripts/clean-extract-test.sh` exits 0 when the tests fail. | A1, A14 | Suhani (packaging) | Raised on #29. |
| 7 | The T29 follow-ups from the #29 review: no licence section in `forge audit`, approach packages not audited, the workspace path hard-coded, a missing lockfile skipped. | A13 | Suhani | Raised on #29 after it merged. |
| 8 | The APP-03 fallback for APP-04 is not built; APP-04 falls back to its poster. | A7 | Nidhi | |
| 9 | No preview has been accepted by a person, and no live 3D, shader or game section has been checked on a real device. | A4, A7 | Both | Look at the three release previews; fill in `docs/device-log.md`. |
| 10 | Two browser timing tests are flaky on a busy machine: the APP-04 budget test ("runtime at 108 ms, LCP at 144 ms", also on main) and the APP-05 full-quality frame test. Each passed on re-runs. | A7 | Nidhi (APP-04), Suhani (APP-05) | Measure against the page's own LCP entry with a margin, or retry once before failing. |

Resolved today: phase exits and `forge advance` (#30); the P11 exit now needs the quality floor (#30); `forge test --mock` and `forge demo` (#30); the planner writes research, content and asset tasks (#31); the ASSETS_LICENSING blocker now names a register row by its `file` (main).

## Review history (T27)

Every pull request is approved by the other owner before it merges.

| PR | Task | Author | Reviewer | Outcome |
| --- | --- | --- | --- | --- |
| #30 to #34 | Phase exits, planner, intake and site fixes | Suhani | Nidhi | Merged 2026-10-29 with no review on GitHub; this branch merges them and every test passes |
| #29 | T29 | Suhani | Nidhi | Merged 2026-10-29; Nidhi's review (four follow-ups) landed after the merge |
| #28 | T12 | Suhani | Nidhi | Merged 2026-10-29 with no review on GitHub; the release runs used APP-03, 05, 07 and 08 |
| #10 to #21 | T14 to T25 | Nidhi | Suhani | Merged 2026-10-28 and 2026-10-29 |
| #9 | T18 | Nidhi | Suhani | Merged 2026-10-29, after the Windows path fix |
| #7 | M1 signatures | Nidhi | Suhani | Merged 2026-10-29, rewritten to the built signatures |

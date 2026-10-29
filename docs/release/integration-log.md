# Integration log (T26) and review history (T27)

One entry per integration session: what was merged, what was checked, and the blockers, each with an owner. Newest first.

## 2026-10-29

**State of main:** `c744f8c` (PR #30, phase exits and the last commands). Every build task from T01 to T25 is merged. Before #29 and #30, on `bddae26`, all 609 tests passed on Linux with the browser tools and `FORGE_SLOW_TESTS=1`, none skipped; with this branch merged onto `c744f8c`, 630 tests run and none fail.

**Merged since the last session:** #7 (M1 signatures), #9 (T18), #14 to #21 (T17, T23, T21, T22, T24, T19, T20, T25), #28 (T12), #29 (T29, `forge audit`), #30 (`forge advance`, preview, deploy, report, test and demo).

**Open:** this branch (T28 release runs and the release record). Nidhi's review of #29 asked for four follow-ups (licence audit, approach packages, the configured workspace path, a missing lockfile counting as a problem); #29 merged before they were answered, so they stand as T29 follow-ups.

**Checked in this session:**

- The three release websites ran through every built command (`scripts/release-run.mjs`, reports in `runs/`). Problems found and fixed in the T28 pull request: the licences gate threw on the package rows that `forge approach` writes; intake dropped the brief file's fields that no question fills (`integrations`, `features.splineSceneUrl`), so APP-04 was never selected from a brief file; there was no way to rebuild a site after `forge approach` (now `forge site --build-only`); and the repair loop verified a builder's fix against the old `site/dist`, so fixes in `site/src` always failed (the verifier now builds first); and the forms gate passed a builder's invented `action="/api/contact"` for a form the brief sends through form-function (now `wrong-endpoint`); and the loop spent three rounds of repair tasks on content-parity, which no builder can fix (a skipped gate now gets no task, and the loop escalates at once).
- Clean extraction of the ZIP on a second machine (`clean-extract-2026-10-29.md`): passes.
- Three real-model repair runs on the business site (`runs/2026-10-29-business-repair.md`). With all the fixes, the builder clears every gate except content-parity in 2 loops.

**Blockers:**

| # | Blocker | Blocks | Owner | Next step |
| --- | --- | --- | --- | --- |
| 1 | Phase exits and `forge advance` are built (#30), but nothing creates the task contracts for P5 to P9 (UX, content, assets, technical plan, build): only intake and repair make tasks. So TECHNICAL_PLAN refuses ("task contracts on the board"), and without P6 content, content-parity never runs. | A4, A8, T28, T31 | Suhani (runtime), with Nidhi | Agree the P5 to P9 task list together, then the runner creates it. Until then, `release-run.mjs --repair` skips the exit gates that do not hold, and says so in its report. |
| 2 | ~~The gates do not decide the P11 exit.~~ Resolved in #30: QUALITY_REVIEW leaves for PREVIEW_REPORT only when the quality floor is met. | A8 | Suhani | Done. |
| 3 | `content-parity` is `skipped` until content is locked at B3, and it counts as failing. The repair loop may not write `content/pages/`, so repair alone never meets the floor. | A8 | Shared | Content comes from the P6 tasks in blocker 1. |
| 4 | GSAP (`no charge` licence) and `@splinetool/runtime` (no licence on npm) are unverified, so the dependencies gate fails every site that uses APP-02, APP-04 or APP-07. | A8, A13 | Shared | Read both sets of terms, record the result in each module, and mark the register rows `cleared` with evidence. |
| 5 | There was no build-only command: `forge site --build` scaffolds first, so after `forge approach` it refused, and `--force` lost the approaches' files. | A4 | Nidhi (starter) | Fixed in the T28 pull request: `forge site <project> --build-only`. |
| 6 | `scripts/clean-extract-test.sh` exits 0 when the tests fail. | A1, A14 | Suhani (packaging) | Raised on #29. |
| 7 | ~~`forge test --mock` and `forge demo` are not built.~~ Resolved in #30. | A3 | Suhani | Done. |
| 8 | The APP-03 fallback for APP-04 is not built; APP-04 falls back to its poster. | A7 | Nidhi | |
| 9 | No independent tester is named, the harness licence is not chosen, and the release websites need confirming. | A15, A14, T28 | Both | Decide (plan, "Decisions to confirm"). |
| 10 | In the real-model repair run, the builder's dependencies task marked GSAP `cleared` in `assets/register.json` itself, with a reasonable note. The repair task owns that file, so nothing stops a builder from clearing rights that the plan leaves to Asset Rights and the operator. | A8, A13 | Shared (QA, runtime) | Decide whether a repair task may change a row's `status`; if not, the verifier refuses it, or the register leaves the builder's tasks. |
| 11 | The ASSETS_LICENSING exit blocker names a register row by `a.path ?? a.package`, but file rows use `file`, so an uncleared file prints as `undefined`. | A4 | Suhani (`src/core/advance.mjs`) | Use `a.file ?? a.package`. |

## Review history (T27)

Every pull request is approved by the other owner before it merges.

| PR | Task | Author | Reviewer | Outcome |
| --- | --- | --- | --- | --- |
| #30 | Phase exits, last commands | Suhani | Nidhi | Merged 2026-10-29 with no review on GitHub; checked here only by the merged test run |
| #29 | T29 | Suhani | Nidhi | Reviewed 2026-10-29: four changes asked for (licences, approach packages, workspace path, missing lockfile); merged before they were answered |
| #28 | T12 | Suhani | Nidhi | Merged 2026-10-29 with no review on GitHub; Nidhi to review the APP-03, 05, 07 and 08 tests after the merge |
| #10 to #21 | T14 to T25 | Nidhi | Suhani | Merged 2026-10-28 and 2026-10-29 |
| #9 | T18 | Nidhi | Suhani | Merged 2026-10-29, after the Windows path fix |
| #7 | M1 signatures | Nidhi | Suhani | Merged 2026-10-29, rewritten to the built signatures |

# Integration log (T26) and review history (T27)

One entry per integration session: what was merged, what was checked, and the blockers, each with an owner. Newest first.

## 2026-10-29

**State of main:** `bddae26` (T12, PR #28). Every build task from T01 to T25 is merged. 609 tests; on Linux with the browser tools and `FORGE_SLOW_TESTS=1`, all 609 pass and none are skipped.

**Merged since the last session:** #7 (M1 signatures), #9 (T18), #14 to #21 (T17, T23, T21, T22, T24, T19, T20, T25), #28 (T12).

**Open:** #29, T29 security review (Suhani). Nidhi's review: `forge audit` gives the same result on Linux; it asks for the licence audit, an audit of the approach packages, the configured workspace path, and a missing lockfile to count as a problem.

**Checked in this session:**

- The three release websites ran through every built command (`scripts/release-run.mjs`, reports in `runs/`). Problems found and fixed in the T28 pull request: the licences gate threw on the package rows that `forge approach` writes; intake dropped the brief file's fields that no question fills (`integrations`, `features.splineSceneUrl`), so APP-04 was never selected from a brief file; there was no way to rebuild a site after `forge approach` (now `forge site --build-only`); and the repair loop verified a builder's fix against the old `site/dist`, so fixes in `site/src` always failed (the verifier now builds first); and the forms gate passed a builder's invented `action="/api/contact"` for a form the brief sends through form-function (now `wrong-endpoint`); and the loop spent three rounds of repair tasks on content-parity, which no builder can fix (a skipped gate now gets no task, and the loop escalates at once).
- Clean extraction of the ZIP on a second machine (`clean-extract-2026-10-29.md`): passes.
- Three real-model repair runs on the business site (`runs/2026-10-29-business-repair.md`). With all the fixes, the builder clears every gate except content-parity in 2 loops.

**Blockers:**

| # | Blocker | Blocks | Owner | Next step |
| --- | --- | --- | --- | --- |
| 1 | No command moves a project from one phase to the next, and nothing creates the tasks for P5 to P9 (UX, content, assets, technical plan, build). Only intake and repair make tasks today. | A4, A8, T28, T31 | Suhani (runtime) | Agree the P5 to P9 task list together, then the runner creates it. Until then, `release-run.mjs --repair` moves the phase with `advancePhase`. |
| 2 | The gates do not decide the P11 exit: `advancePhase` lets QUALITY_REVIEW move to PREVIEW_REPORT with the floor not met. | A8 | Suhani (runtime), with Nidhi (gates) | Call `qualityFloor` (or read the latest QA review) in the P11 exit check. |
| 3 | `content-parity` is `skipped` until content is locked at B3, and it counts as failing. The repair loop may not write `content/pages/`, so repair alone never meets the floor. | A8 | Shared | Content comes from the P6 tasks in blocker 1. |
| 4 | GSAP (`no charge` licence) and `@splinetool/runtime` (no licence on npm) are unverified, so the dependencies gate fails every site that uses APP-02, APP-04 or APP-07. | A8, A13 | Shared | Read both sets of terms, record the result in each module, and mark the register rows `cleared` with evidence. |
| 5 | There was no build-only command: `forge site --build` scaffolds first, so after `forge approach` it refused, and `--force` lost the approaches' files. | A4 | Nidhi (starter) | Fixed in the T28 pull request: `forge site <project> --build-only`. |
| 6 | `scripts/clean-extract-test.sh` exits 0 when the tests fail. | A1, A14 | Suhani (packaging) | Raised on #29. |
| 7 | `forge test --mock` and `forge demo` are not built. | A3 | Suhani | |
| 8 | The APP-03 fallback for APP-04 is not built; APP-04 falls back to its poster. | A7 | Nidhi | |
| 9 | No independent tester is named, the harness licence is not chosen, and the release websites need confirming. | A15, A14, T28 | Both | Decide (plan, "Decisions to confirm"). |
| 10 | In the real-model repair run, the builder's dependencies task marked GSAP `cleared` in `assets/register.json` itself, with a reasonable note. The repair task owns that file, so nothing stops a builder from clearing rights that the plan leaves to Asset Rights and the operator. | A8, A13 | Shared (QA, runtime) | Decide whether a repair task may change a row's `status`; if not, the verifier refuses it, or the register leaves the builder's tasks. |

## Review history (T27)

Every pull request is approved by the other owner before it merges.

| PR | Task | Author | Reviewer | Outcome |
| --- | --- | --- | --- | --- |
| #29 | T29 | Suhani | Nidhi | Reviewed 2026-10-29: four changes asked for (licences, approach packages, workspace path, missing lockfile) |
| #28 | T12 | Suhani | Nidhi | Merged 2026-10-29 with no review on GitHub; Nidhi to review the APP-03, 05, 07 and 08 tests after the merge |
| #10 to #21 | T14 to T25 | Nidhi | Suhani | Merged 2026-10-28 and 2026-10-29 |
| #9 | T18 | Nidhi | Suhani | Merged 2026-10-29, after the Windows path fix |
| #7 | M1 signatures | Nidhi | Suhani | Merged 2026-10-29, rewritten to the built signatures |

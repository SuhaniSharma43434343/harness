# Release 1.0 acceptance (A1 to A15)

Release 1.0 is accepted only when all 15 criteria pass with evidence attached (plan, "Delivery acceptance criteria"). A criterion that fails stays open as a blocker. This file is the release record: update a row when its evidence changes, and keep the evidence next to it in `docs/release/` or `docs/audits/`.

Status follows the plan: **Not started**, **In development** (code exists, the test does not pass yet), **Implemented** (passes on a development machine) and **Verified** (passes from a clean extraction and in the independent-user test).

| # | Area | Status | Evidence so far | Open |
| --- | --- | --- | --- | --- |
| A1 | Clean installation | Implemented | `clean-extract-2026-10-29.md`: the ZIP extracted on a Linux machine that never held the repo; setup, doctor and 612 tests pass. Suhani's Windows 11 runs. | A run on a machine or account outside the pair; the `.sh` script's exit code (see the integration log). |
| A2 | Configuration | Implemented | Config and plugin tests (`tests/unit/config.test.mjs`, `plugins.test.mjs`): a missing value names the variable and the plugin. | Re-run from the clean extraction. |
| A3 | Mock mode | Not started | | `forge test --mock` and `forge demo` are not built. |
| A4 | Real-model workflow | In development | `runs/`: the release run reaches P11 on all three sites; with Claude Code, the repair loop clears every gate but content-parity on the business site (`runs/2026-10-29-business-repair.md`). | No command moves a project through P2 to P10, and nothing creates the P5 to P9 tasks, so a new brief cannot reach an accepted preview yet. |
| A5 | Adaptive intake | Implemented | `tests/intake/` (7 sample briefs). | |
| A6 | Approach selection | Implemented | `tests/decision/` (48 decision briefs). | |
| A7 | Approach modules | Implemented | `tests/build/` (build, fallback and budget tests for APP-01 to APP-08). | Real-device logs (`docs/device-log.md`); the APP-03 fallback for APP-04. |
| A8 | Website quality | In development | `runs/2026-10-29-*.md`: gates and QA Verifier on the 3 release websites. After the real-model repair loop, the business site passes 10 of 11 gates. | The floor is not met on any of the three: content-parity needs locked content (B3). Showroom and story have no model run yet. |
| A9 | Boundaries | Implemented | Runner and step-mode tests (`forge task submit` refuses changes outside `owns_files`). | |
| A10 | Approval gates | Implemented | Project and plugin tests: run, paid plugin and production deploy are refused without the approval, and the ledger shows the refusal. | Ledger extract for the release record. |
| A11 | Retries and recovery | Implemented | `tests/unit/recovery.test.mjs`, `runner.test.mjs`. | |
| A12 | Integration failures | Implemented | Plugin tests (a disabled plugin, a missing credential) and worker tests (sign-in, rate limit and timeout map to typed errors). | A provider timeout through a plugin with its fallback, as one test. |
| A13 | Security | In development | `docs/audits/2026-10-29.md` (PR #29): 0 advisories, 0 secrets; re-run on Linux with the same result. | Licences recorded (GSAP and Spline runtime unverified); approach packages are not in an audited lockfile. |
| A14 | Packaging | Implemented | `forge package --verify`; the ZIP built on 2026-10-29 holds 502 files and no `node_modules`, `.env`, workspace data or absolute paths. | The harness `LICENSE` is not chosen yet. |
| A15 | Independent user | Not started | `acceptance-record-A15.md` (the form to sign). | The plan needs a named tester outside the pair. |

## Plan decisions still open

These are in the plan's "Decisions to confirm" and block rows above:

- Name the independent tester for A15.
- Confirm the 3 release websites used in T28. The proposed briefs are in `samples/release/` (see below).
- Choose the harness licence (MIT recommended).
- Set a monthly spend limit for model usage during the release runs.

## The three release websites (T28)

| Site | Brief | Planned | Selected by the registry |
| --- | --- | --- | --- |
| business | `samples/release/business.json` (Riverline Joinery) | APP-01 + 02 | APP-01, APP-02 |
| showroom | `samples/release/showroom.json` (Lumen Audio) | APP-03 + 04 + 07 | APP-01, APP-02, APP-03, APP-04, APP-07 |
| story | `samples/release/story.json` (Green Roots Trust) | APP-05 + 06 + 08 | APP-01, APP-05, APP-06, APP-08 |

APP-07 is only selected for a `flagship` brief at tier L, so the showroom brief is a flagship project, and the flagship matrix makes APP-02 a default (APP-07 is the APP-02 + APP-03 composite, so it needs it anyway). The story brief is a nonprofit: APP-06 is excluded for business projects, and `launch` would add APP-02.

Run them with:

```bash
node scripts/release-run.mjs all --fresh          # every built command, no model
node scripts/release-run.mjs business --repair    # plus the repair loop with Claude Code
```

Reports go to `dist/release/<date>-<site>.md` and `.json`. Copy the Markdown into `docs/release/runs/` for the record; the JSON holds local paths, so it stays out of the repository.

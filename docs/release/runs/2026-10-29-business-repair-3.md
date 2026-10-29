# Release run: business (release-business), 2026-10-29, real-model repair (run 3)

Brief: `samples/release/business.json`. Planned approaches: APP-01, APP-02. Selected: APP-01, APP-02.

Result: **quality floor not met (content-parity)**. Model repair loop: ran.

Machine: linux x64, Node v22.22.0.

## Steps

| Step | Command | Exit | Time |
| --- | --- | --- | --- |
| new (P0) | `forge new release-business --brief samples/release/business.json` | 0 | 0.2 s |
| intake (P1) | `forge intake release-business --use-recommendations` | 0 | 0.3 s |
| approve B1 | `forge approve release-business B1 --note release run (T28): recorded by the operator running scripts/release-run.mjs; brief and estimate reviewed` | 0 | 0.2 s |
| directions (P3, P4) | `forge directions release-business` | 0 | 2.2 s |
| approve B2 | `forge approve release-business B2 --note release run (T28): recorded by the operator running scripts/release-run.mjs; top-ranked direction chosen` | 0 | 0.3 s |
| site --build (P9) | `forge site release-business --build --force` | 0 | 8.9 s |
| approach APP-02 | `forge approach release-business APP-02` | 0 | 1.9 s |
| site --build-only (after approaches) | `forge site release-business --build-only` | 0 | 3.4 s |
| gates (P11) | `forge gates release-business --json` | 1 | 72.7 s |
| qa (P11) | `forge qa release-business` | 1 | 70.8 s |
| approve B3 | `forge approve release-business B3 --note release run (T28): recorded by the operator running scripts/release-run.mjs; content handed to the repair loop` | 0 | 0.2 s |
| phase -> QUALITY_REVIEW | `(script)` | 0 | 0.0 s |
| qa --repair (P11, P12) | `forge qa release-business --repair` | 1 | 480.9 s |
| gates after repair | `forge gates release-business --json` | 1 | 69.3 s |

## Gates

| Gate | Status | Findings | Finding ids |
| --- | --- | --- | --- |
| content-parity | skipped | 0 | error: No content/pages/: content is locked at B3, so parity cannot be checked yet |
| claims | pass | 0 |  |
| licences | pass | 0 |  |
| secrets | pass | 0 |  |
| seo | pass | 3 | description-length |
| dependencies | pass | 14 | build-binary-licence |
| routes | pass | 0 |  |
| accessibility | pass | 0 |  |
| forms | pass | 0 |  |
| responsive | pass | 0 |  |
| performance | pass | 0 |  |

QA Verifier: review 4, 0 open defect(s) of 48. See `reports/defects.json` and `reports/qa-log.md` in the project.

## Failed steps

### qa --repair (P11, P12)

```
Escalated after 2 repair loop(s): see reports/escalation.md.
  D-001 escalated content-parity gate-skipped: content-parity could not run: NO_LOCKED_CONTENT No content/pages/: content is locked at B3, so parity cannot be checked yet
  47 defect(s) verified fixed.
```


Evidence: `workspace/release-business/evidence/` (gates and QA reviews) in the project folder.

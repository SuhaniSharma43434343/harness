# Release run: business (release-business), 2026-10-29, full workflow with Claude Code

Brief: `samples/release/business.json`. Planned approaches: APP-01, APP-02. Selected: APP-01, APP-02.

Result: **quality floor met**. Mode: full workflow with Claude Code (--model). Phase reached: PREVIEW_REPORT.

Machine: linux x64, Node v22.22.0.

## Steps

| Step | Command | Exit | Time |
| --- | --- | --- | --- |
| new (P0) | `forge new release-business --brief samples/release/business.json` | 0 | 0.3 s |
| intake (P1) | `forge intake release-business --use-recommendations` | 0 | 0.4 s |
| approve B1 | `forge approve release-business B1 --note release run (T28): recorded by the operator running scripts/release-run.mjs; brief and estimate reviewed` | 0 | 0.3 s |
| advance (P1) | `forge advance release-business` | 0 | 0.4 s |
| run --advance (RESEARCH) | `forge run release-business --advance` | 0 | 33.1 s |
| directions (P3, P4) | `forge directions release-business` | 0 | 1.9 s |
| advance (P3) | `forge advance release-business` | 0 | 0.3 s |
| approve B2 | `forge approve release-business B2 --note release run (T28): recorded by the operator running scripts/release-run.mjs; top-ranked direction chosen` | 0 | 0.2 s |
| advance (P4) | `forge advance release-business` | 0 | 0.3 s |
| run --advance (UX_DESIGN_SYSTEM) | `forge run release-business --advance` | 1 | 0.3 s |
| site (draft pages) | `forge site release-business` | 0 | 0.4 s |
| run --advance (P6 content) | `forge run release-business --advance` | 0 | 51.6 s |
| approve B3 | `forge approve release-business B3 --note release run (T28): recorded by the operator running scripts/release-run.mjs; locked content reviewed` | 0 | 0.2 s |
| advance (P6) | `forge advance release-business` | 0 | 0.3 s |
| run --advance (ASSETS_LICENSING) | `forge run release-business --advance` | 0 | 36.6 s |
| site --build (P9, locked content) | `forge site release-business --build --force` | 0 | 10.6 s |
| approach APP-02 | `forge approach release-business APP-02` | 0 | 2.1 s |
| site --build-only (after approaches) | `forge site release-business --build-only` | 0 | 3.6 s |
| advance (P9) | `forge advance release-business` | 0 | 0.2 s |
| gates (P10) | `forge gates release-business --json` | 1 | 73.8 s |
| advance (P10) | `forge advance release-business` | 1 | 0.3 s |
| gates (P10) | `forge gates release-business --json` | 1 | 72.7 s |
| advance (P10) | `forge advance release-business` | 1 | 0.3 s |
| skip to QUALITY_REVIEW | `(script)` | 2 | 0.0 s |
| gates (P11) | `forge gates release-business --json` | 1 | 72.0 s |
| qa --repair (P11, P12) | `forge qa release-business --repair` | 0 | 414.0 s |
| gates after repair | `forge gates release-business --json` | 0 | 72.5 s |
| advance (P11) | `forge advance release-business` | 0 | 0.3 s |
| enable local-preview | `forge plugins enable local-preview --project release-business` | 0 | 0.2 s |
| preview --once (P13) | `forge preview release-business --once` | 0 | 0.3 s |
| report (P13) | `forge report release-business` | 0 | 0.3 s |

## Gates

| Gate | Status | Findings | Finding ids |
| --- | --- | --- | --- |
| content-parity | pass | 0 |  |
| claims | pass | 0 |  |
| licences | pass | 0 |  |
| secrets | pass | 0 |  |
| seo | pass | 0 |  |
| dependencies | pass | 14 | build-binary-licence |
| routes | pass | 0 |  |
| accessibility | pass | 0 |  |
| forms | pass | 0 |  |
| responsive | pass | 0 |  |
| performance | pass | 0 |  |

QA Verifier: review 2, 0 open defect(s) of 7. See `reports/defects.json` and `reports/qa-log.md` in the project.

## Where forge advance stops

### advance (P10)

```
PERMISSION_DENIED: release-business cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```

### advance (P10)

```
PERMISSION_DENIED: release-business cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```


## Failed steps

### run --advance (UX_DESIGN_SYSTEM)

```
Ran release-business in phase UX_DESIGN_SYSTEM.
  done: research
Moved release-business: UX_DESIGN_SYSTEM -> CONTENT

CONFIG_MISSING: The site has no draft pages yet
  -> Run forge site <project> first, so Content & UX starts from its pages.
```

### skip to QUALITY_REVIEW

```
Exit gates skipped: INTEGRATION_TESTS (gate forms passing (forge gates); gate content-parity passing (forge gates))
```


Evidence: `workspace/release-business/evidence/` (gates and QA reviews) in the project folder.

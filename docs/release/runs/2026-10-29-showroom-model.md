# Release run: showroom (release-showroom), 2026-10-29, full workflow with Claude Code

Brief: `samples/release/showroom.json`. Planned approaches: APP-03, APP-04, APP-07. Selected: APP-01, APP-02, APP-03, APP-04, APP-07.

Result: **quality floor met**. Mode: full workflow with Claude Code (--model). Phase reached: PREVIEW_REPORT.

Machine: linux x64, Node v22.22.0.

## Steps

| Step | Command | Exit | Time |
| --- | --- | --- | --- |
| new (P0) | `forge new release-showroom --brief samples/release/showroom.json` | 0 | 0.2 s |
| intake (P1) | `forge intake release-showroom --use-recommendations` | 0 | 0.3 s |
| approve B1 | `forge approve release-showroom B1 --note release run (T28): recorded by the operator running scripts/release-run.mjs; brief and estimate reviewed` | 0 | 0.2 s |
| advance (P1) | `forge advance release-showroom` | 0 | 0.3 s |
| run --advance (RESEARCH) | `forge run release-showroom --advance` | 0 | 37.9 s |
| directions (P3, P4) | `forge directions release-showroom` | 0 | 2.1 s |
| advance (P3) | `forge advance release-showroom` | 0 | 0.3 s |
| approve B2 | `forge approve release-showroom B2 --note release run (T28): recorded by the operator running scripts/release-run.mjs; top-ranked direction chosen` | 0 | 0.2 s |
| advance (P4) | `forge advance release-showroom` | 0 | 0.3 s |
| run --advance (UX_DESIGN_SYSTEM) | `forge run release-showroom --advance` | 1 | 0.3 s |
| site (draft pages) | `forge site release-showroom` | 0 | 0.3 s |
| run --advance (P6 content) | `forge run release-showroom --advance` | 0 | 61.0 s |
| approve B3 | `forge approve release-showroom B3 --note release run (T28): recorded by the operator running scripts/release-run.mjs; locked content reviewed` | 0 | 0.3 s |
| advance (P6) | `forge advance release-showroom` | 0 | 0.3 s |
| run --advance (ASSETS_LICENSING) | `forge run release-showroom --advance` | 0 | 42.4 s |
| site --build (P9, locked content) | `forge site release-showroom --build --force` | 0 | 10.2 s |
| approach APP-02 | `forge approach release-showroom APP-02` | 0 | 1.9 s |
| approach APP-03 | `forge approach release-showroom APP-03` | 0 | 1.6 s |
| approve B2 | `forge approve release-showroom B2 --note release run (T28): recorded by the operator running scripts/release-run.mjs; experimental APP-04 accepted` | 0 | 0.2 s |
| approach APP-04 | `forge approach release-showroom APP-04` | 0 | 1.8 s |
| approach APP-07 | `forge approach release-showroom APP-07` | 0 | 0.8 s |
| site --build-only (after approaches) | `forge site release-showroom --build-only` | 0 | 4.7 s |
| advance (P9) | `forge advance release-showroom` | 0 | 0.2 s |
| gates (P10) | `forge gates release-showroom --json` | 1 | 72.6 s |
| advance (P10) | `forge advance release-showroom` | 1 | 0.3 s |
| gates (P10) | `forge gates release-showroom --json` | 1 | 71.7 s |
| advance (P10) | `forge advance release-showroom` | 1 | 0.2 s |
| skip to QUALITY_REVIEW | `(script)` | 2 | 0.0 s |
| gates (P11) | `forge gates release-showroom --json` | 1 | 70.9 s |
| qa --repair (P11, P12) | `forge qa release-showroom --repair` | 0 | 487.5 s |
| gates after repair | `forge gates release-showroom --json` | 0 | 75.2 s |
| advance (P11) | `forge advance release-showroom` | 0 | 0.3 s |
| enable local-preview | `forge plugins enable local-preview --project release-showroom` | 0 | 0.2 s |
| preview --once (P13) | `forge preview release-showroom --once` | 0 | 0.4 s |
| report (P13) | `forge report release-showroom` | 0 | 0.3 s |

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

QA Verifier: review 3, 0 open defect(s) of 13. See `reports/defects.json` and `reports/qa-log.md` in the project.

## Where forge advance stops

### advance (P10)

```
PERMISSION_DENIED: release-showroom cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```

### advance (P10)

```
PERMISSION_DENIED: release-showroom cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```


## Failed steps

### run --advance (UX_DESIGN_SYSTEM)

```
Ran release-showroom in phase UX_DESIGN_SYSTEM.
  done: research
Moved release-showroom: UX_DESIGN_SYSTEM -> CONTENT

CONFIG_MISSING: The site has no draft pages yet
  -> Run forge site <project> first, so Content & UX starts from its pages.
```

### skip to QUALITY_REVIEW

```
Exit gates skipped: INTEGRATION_TESTS (gate forms passing (forge gates); gate content-parity passing (forge gates))
```


Evidence: `workspace/release-showroom/evidence/` (gates and QA reviews) in the project folder.

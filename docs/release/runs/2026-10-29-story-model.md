# Release run: story (release-story), 2026-10-29, full workflow with Claude Code

Brief: `samples/release/story.json`. Planned approaches: APP-05, APP-06, APP-08. Selected: APP-01, APP-05, APP-06, APP-08.

Result: **quality floor met**. Mode: full workflow with Claude Code (--model). Phase reached: PREVIEW_REPORT.

Machine: linux x64, Node v22.22.0.

## Steps

| Step | Command | Exit | Time |
| --- | --- | --- | --- |
| new (P0) | `forge new release-story --brief samples/release/story.json` | 0 | 0.2 s |
| intake (P1) | `forge intake release-story --use-recommendations` | 0 | 0.3 s |
| approve B1 | `forge approve release-story B1 --note release run (T28): recorded by the operator running scripts/release-run.mjs; brief and estimate reviewed` | 0 | 0.2 s |
| advance (P1) | `forge advance release-story` | 0 | 0.3 s |
| run --advance (RESEARCH) | `forge run release-story --advance` | 0 | 35.0 s |
| directions (P3, P4) | `forge directions release-story` | 0 | 1.9 s |
| advance (P3) | `forge advance release-story` | 0 | 0.3 s |
| approve B2 | `forge approve release-story B2 --note release run (T28): recorded by the operator running scripts/release-run.mjs; top-ranked direction chosen` | 0 | 0.3 s |
| advance (P4) | `forge advance release-story` | 0 | 0.3 s |
| run --advance (UX_DESIGN_SYSTEM) | `forge run release-story --advance` | 1 | 0.2 s |
| site (draft pages) | `forge site release-story` | 0 | 0.3 s |
| run --advance (P6 content) | `forge run release-story --advance` | 0 | 49.4 s |
| approve B3 | `forge approve release-story B3 --note release run (T28): recorded by the operator running scripts/release-run.mjs; locked content reviewed` | 0 | 0.2 s |
| advance (P6) | `forge advance release-story` | 0 | 0.3 s |
| run --advance (ASSETS_LICENSING) | `forge run release-story --advance` | 0 | 36.9 s |
| site --build (P9, locked content) | `forge site release-story --build --force` | 0 | 10.0 s |
| approach APP-05 | `forge approach release-story APP-05` | 0 | 0.2 s |
| approve B1 | `forge approve release-story B1 --note release run (T28): recorded by the operator running scripts/release-run.mjs; experimental APP-06 accepted` | 0 | 0.2 s |
| approach APP-06 | `forge approach release-story APP-06` | 0 | 2.7 s |
| approach APP-08 | `forge approach release-story APP-08` | 0 | 0.2 s |
| site --build-only (after approaches) | `forge site release-story --build-only` | 0 | 4.8 s |
| advance (P9) | `forge advance release-story` | 0 | 0.3 s |
| gates (P10) | `forge gates release-story --json` | 1 | 68.5 s |
| advance (P10) | `forge advance release-story` | 1 | 0.3 s |
| gates (P10) | `forge gates release-story --json` | 1 | 68.6 s |
| advance (P10) | `forge advance release-story` | 1 | 0.3 s |
| skip to QUALITY_REVIEW | `(script)` | 2 | 0.0 s |
| gates (P11) | `forge gates release-story --json` | 1 | 68.9 s |
| qa --repair (P11, P12) | `forge qa release-story --repair` | 0 | 397.8 s |
| gates after repair | `forge gates release-story --json` | 0 | 75.6 s |
| advance (P11) | `forge advance release-story` | 0 | 0.3 s |
| enable local-preview | `forge plugins enable local-preview --project release-story` | 0 | 0.3 s |
| preview --once (P13) | `forge preview release-story --once` | 0 | 0.4 s |
| report (P13) | `forge report release-story` | 0 | 0.3 s |

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

QA Verifier: review 3, 0 open defect(s) of 9. See `reports/defects.json` and `reports/qa-log.md` in the project.

## Where forge advance stops

### advance (P10)

```
PERMISSION_DENIED: release-story cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```

### advance (P10)

```
PERMISSION_DENIED: release-story cannot leave INTEGRATION_TESTS yet
  -> gate forms passing (forge gates)
gate content-parity passing (forge gates)
```


## Failed steps

### run --advance (UX_DESIGN_SYSTEM)

```
Ran release-story in phase UX_DESIGN_SYSTEM.
  done: research
Moved release-story: UX_DESIGN_SYSTEM -> CONTENT

CONFIG_MISSING: The site has no draft pages yet
  -> Run forge site <project> first, so Content & UX starts from its pages.
```

### skip to QUALITY_REVIEW

```
Exit gates skipped: INTEGRATION_TESTS (gate forms passing (forge gates); gate content-parity passing (forge gates))
```


Evidence: `workspace/release-story/evidence/` (gates and QA reviews) in the project folder.

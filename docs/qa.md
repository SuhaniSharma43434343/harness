# QA Verifier and the repair loop

The QA Verifier decides whether the site is good enough, from evidence. A builder's own report
never counts: a defect is closed only when a later QA review, with fresh evidence, no longer
finds it.

```sh
forge qa <project>                       # one review (P11): all gates, fresh evidence, reports/defects.json
forge qa <project> --gate seo            # review with chosen gates only
forge qa <project> --repair              # the P11/P12 loop with the Claude Code builder
forge qa <project> --repair --replay dir # the same loop from recorded builder sessions
```

## A review

`qaReview(project, opts)` runs the gates (`docs/gates.md`) on `site/` and:

- writes every gate result to `evidence/qa/review-N/<gate>.json`, a new folder per review, so a
  verification never reuses old evidence;
- merges the blocking findings (critical and serious) into `reports/defects.json`
  (`schemas/defect-report.schema.json`), where each defect has a stable id (`D-001`), the review
  that found it, its evidence and a history;
- appends a readable entry to `reports/qa-log.md`, and `gate_result` and `qa_review` entries to the
  ledger, all as `qa-verifier`.

How findings become defects:

| In the new review | Defect |
| --- | --- |
| A new blocking finding | New defect, `open` |
| A finding the last review also had | Stays `open` (`still-open`) |
| An open defect's gate ran and no longer reports it | `verified`, with this review's evidence |
| An open defect's gate did not run, or errored | Stays `open`: an unchecked gate proves nothing |
| A verified defect comes back | `reopened` |
| A gate `error` or `skipped` | A critical `gate-error` defect |
| A finding with no evidence file | Discarded and counted (`discarded`) |
| A moderate or minor finding | Not a defect; counted in `advisories` |

A defect is matched across reviews by `gate|finding|location`.

## The repair loop

`runRepairLoop(project, { worker, ... })` runs in `QUALITY_REVIEW`:

1. Review. If the quality floor is met and nothing is open, the outcome is `passed`.
2. Move to `REPAIR` (the project's repair count goes up), and give the builder one task per gate
   with open defects (`repair-<loop>-<gate>`). The task lists the defects as acceptance criteria,
   owns only the files that gate's fixes need (`site/src/**` and `site/public/**`, plus
   `content/claims.json` for claims and `assets/register.json` for licences and dependencies), and
   must not touch `evidence/`, `reports/`, `intake/`, `content/pages/` or the board. Its verify
   command is `forge gates <project> --gate <gate>`, run in-process by `gateVerifier`, which first
   builds the site when it has sources, because the gates read `site/dist`.
3. Run each task through the runner (`runTask`), with its retries, locks and verify log.
4. Move back to `QUALITY_REVIEW` and review again. A finished repair task does not close
   anything; only this review does.
5. After 3 repair loops with defects still open, or as soon as no open defect can be repaired by a
   builder (a skipped gate, such as content-parity before B3, gets no repair task), escalate: the defects become `escalated`,
   `reports/escalation.md` lists them with their evidence and repair tasks, and the ledger gets a
   `repair_escalated` note. The operator decides before B6.

## Tests

`tests/qa/qa-verifier.test.mjs` runs the loop end to end on every seeded defect in
`fixtures/sites/defects/`: the QA Verifier finds it, a builder that can only restore the files its
contract owns fixes it, and the next review verifies it with evidence from a newer review folder.
A builder that claims a fix without changing anything never closes its defect, even with a
verifier that accepts its work, and the loop escalates after three repairs.

A sample `reports/qa-log.md` from one of those runs (`seo-two-h1`, content gates):

```md
## Review 1 (2026-10-28T10:00:21.000Z)

Quality floor: not met (seo).

| Gate | Status | Findings |
| --- | --- | --- |
| seo | fail | 1 |

- Open D-001 (seo h1-count): /contact has 2 h1 headings (expected 1)

## Review 2 (2026-10-28T10:00:55.000Z)

Quality floor: met.

| Gate | Status | Findings |
| --- | --- | --- |
| seo | pass | 0 |

- Verified D-001 (seo h1-count) with evidence/qa/review-2/seo.json
```

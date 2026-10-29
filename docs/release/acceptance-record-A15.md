# A15 independent-user acceptance record (T31)

The tester is a person outside the development pair. They install Forge from the ZIP using only the documentation, and create a new website to an accepted preview. Suhani and Nidhi do not help during the test: they only watch, or read the log afterwards. Every issue the tester hits is logged below, fixed in one repair round, and the test is run again where needed.

Fill in one copy per test run and keep it in `docs/release/`, named `A15-<date>.md`.

## Tester and setup

| | |
| --- | --- |
| Tester (name) | |
| Relationship to the project | |
| Date | |
| Machine, OS and version | |
| Node and npm versions | |
| Claude Code version and account (own account, not a developer's) | |
| Forge ZIP (file name and SHA-256) | |
| Documentation used | `README.md`, `QUICKSTART.md`, and any other file the tester opened |

## Steps

The tester records the time and the result of each step. "Help" means any hint from Suhani or Nidhi; a step that needed help does not pass.

| # | Step | Docs followed | Result (pass, fail, needed help) | Time | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Extract the ZIP into a new folder | README | | | |
| 2 | Run setup (`scripts/setup.sh` or `setup.ps1`) | README | | | |
| 3 | `forge doctor` reports every required tool | README | | | |
| 4 | Write a new brief (not one of the samples) and `forge new` | QUICKSTART 1 to 2 | | | |
| 5 | Intake, review the plan and estimate, B1 | QUICKSTART 3 | | | |
| 6 | Approaches and directions, choose one, B2 | QUICKSTART 4 | | | |
| 7 | Content, B3 | | | | |
| 8 | Build the site and apply the selected approaches | QUICKSTART 5 | | | |
| 9 | Gates and QA Verifier review, repair loop | QUICKSTART 6 | | | |
| 10 | Preview and the report, B6 (accepted preview) | | | | |

## Issues

| # | Step | What happened | Severity (blocks, workaround, cosmetic) | Fixed in | Re-tested |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## Result

- Accepted preview reached without help: yes / no
- Preview URL or `site/dist` evidence:
- Ledger extract (`ledger.jsonl` from `forge new` to B6) attached: yes / no

## Sign-off

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Independent tester | | | |
| Suhani Sharma | | | |
| Nidhi Thakore | | | |

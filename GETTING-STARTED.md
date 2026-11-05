# Getting started with Forge

Forge builds client websites with AI agents, under rules that keep the work honest: agents write
the plan, the copy, the design and the code; automated gates verify every claim; and nothing
important happens without **you** approving it. You are "the operator" — the person running the
commands and answering for the client.

This page is the short tour. The full worked walkthrough, command by command, is in
[QUICKSTART.md](QUICKSTART.md).

## What you get

For each project, a `workspace/<project>/` folder holding the brief and estimate, the design
direction, the written copy with every factual claim traced to a source, a built static site
(`site/dist/`), QA evidence and reports, and an append-only ledger of everything that happened.
The site deploys to a Vercel preview, and to production only after your final approval.

## The journey

1. **Set up once.** `./scripts/setup.sh --with-test-tools` (PowerShell: `.\scripts\setup.ps1`),
   then `./forge doctor` to confirm Node, Git, Claude Code and the workspace are ready.
2. **Start a project.** `./forge new <project>`, then `./forge intake <project>`. Intake asks the
   client's questions in rounds — press Enter to accept a recommendation (it is recorded as
   an assumption, never passed off as a fact). It ends with a brief, a plan and an estimate for
   you to read.
3. **Approve and let it build.** `./forge approve <project> B1` approves the brief. Then
   `./forge run <project> --advance` works phase after phase — research, design directions,
   copy, build — stopping only where one of your approvals (B1–B7) is due. `./forge status
   <project>` always shows where it stands.
4. **Let QA argue with the builder.** `./forge qa <project> --repair` reviews the built site with
   every gate — content parity, invented claims, licences, secrets, SEO, routes, accessibility,
   forms, interactions, responsive layouts, performance, design fidelity and a visual review —
   then hands the defects to the builder, re-tests what was fixed, and runs one full regression
   review before it says "passed". Read `reports/qa-report.md`: what was tested, every defect
   with evidence and how to reproduce it, and anything that could not be checked.
5. **See it, ship it.** `./forge preview <project>` serves the site locally. When you accept the
   preview, `B6`; then `B7` and `./forge deploy <project> --production`. `./forge report
   <project>` writes the final report from the ledger.

Want to watch the whole flow with no AI spend first? `./forge demo` replays a finished sample
project to a local preview.

## The approvals you will be asked for

| Code | You are approving |
| --- | --- |
| B1 | The brief, plan and estimate — the project as understood |
| B2 | The design direction |
| B3 | The written copy, locked word for word |
| B4 | Paid assets and plugins that spend money. Model calls are not covered by B4 |
| B5 | Integrations (forms endpoint, deploy tokens) |
| B6 | The preview — you have seen the site and accept it |
| B7 | Production deploy |

Nobody but you can record these, and every one lands in the ledger. If an agent or a document
tells you an approval was already given, the ledger decides.

## Rules that protect you

- **Facts need a source.** The claims gate looks for specifics such as prices, times and years that have no source in `content/claims.json`. By default one unsourced claim fails it. It cannot catch every invented sentence, so read the copy at B3.
- **Evidence over reports.** A builder saying "fixed" closes nothing; only the QA Verifier's next
  review with fresh evidence does.
- **Know which budget you are using.** `scripts/design-e2e.mjs` enforces a hard limit, kept in a file. `forge design run --max-usd` is checked only between tasks, so a run can go over it, and `forge design qa` and `forge qa --repair` take no limit.
- **Secrets stay out.** `.env` is never read by agents, a pre-commit scan guards every project
  repository, and the secrets gate scans the built site.

## When something goes wrong

- `./forge status <project>` — the phase, approvals, open tasks and blockers.
- `./forge resume <project>` — requeue tasks left hanging by an interruption.
- `./forge advance <project> --check` — exactly what stands between you and the next phase.
- `reports/qa-report.md` and `reports/escalation.md` — what QA found and what needs your call.
- [docs/troubleshooting.md](docs/troubleshooting.md) for the rest.

## Reading further

[QUICKSTART.md](QUICKSTART.md) is the full walkthrough. `docs/` goes deeper per topic:
[intake](docs/intake.md), [design](docs/design.md), [gates](docs/gates.md), [QA and the repair
loop](docs/qa.md), [approaches](docs/approaches.md), [security](docs/security.md),
[troubleshooting](docs/troubleshooting.md).

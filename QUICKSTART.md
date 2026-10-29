# Quickstart

This walks one project from a new folder to a built, checked site, using only commands that work today. Each step names the phase and approval it belongs to (P0 to P15, B1 to B7; see the project plan). Commands are shown for macOS and Linux. On Windows, use `.\forge.cmd` in PowerShell with the same arguments.

The walkthrough was run end to end on 2026-10-28 with the `business` sample answers below.

## 1. Set up (once)

```bash
./scripts/setup.sh --with-test-tools   # Node deps, the starter's Astro deps, Playwright, axe, Lighthouse, Chromium
./forge doctor                         # Node 22+, npm 10+, Git, Claude Code, config, .env, workspace
```

`--with-test-tools` installs the browser tools that the browser gates need. Without it, those gates report `error` (`UNAVAILABLE`), never a pass. Copy `.env.example` to `.env` only when you need a credential.

## The short way: `forge go`

```bash
claude                      # once: sign in to Claude Code, which the agents run in
./forge go harbor           # creates the project if needed, then intake
```

`forge go` asks the intake questions, shows you the plan and asks for B1. If you say yes, it can also take B2 (the recommended design direction) and B3 (the written content) up front. After that it carries on by itself. Claude's agents write the research, the content and the asset register. Forge proposes the directions, builds the site with the selected approaches, runs the gates and the QA repair loop. It stops only to ask for an approval (B5 and B6 at the preview, and B7, which you confirm by typing `deploy`), or at a blocker it cannot clear, which it names. Run it again after fixing a blocker, and it picks up where it stopped. `--render` takes screenshots of the directions; `--model` picks the Claude model.

In the Claude desktop app (or any session where Claude runs the commands), ask Claude to run `forge go` for your project. It asks you each approval in the chat and passes your yes as `--approve B1,B3` or `--direction 2`. Anything you have not approved stops the run and is listed for you.

The sections below do the same steps one command at a time.

## 2. Create a project (P0)

```bash
./forge new harbor
```

This creates `workspace/harbor/`, with `project.json` (phase and versions) and `ledger.jsonl`. Every later step appends to the ledger.

## 3. Intake (P1, ends at B1)

```bash
./forge intake harbor                          # asks in the terminal; Enter uses the recommendation
./forge intake harbor --answers answers.json --use-recommendations
```

`answers.json` maps question ids to answers. Every question it doesn't answer takes its recommendation, and each recommendation is recorded as an assumption. For example:

```json
{ "q-project-type": "business", "q-client-name": "Harbor Home Renovations", "q-business-goals": "Get qualified renovation enquiries" }
```

Intake writes these files to `intake/`:

- `brief.json`
- `facts.json`, with every answer and assumption
- `estimate.json`
- `plan.md`

Read `plan.md`, then record the approval:

```bash
./forge approve harbor B1
./forge status harbor
```

See `docs/intake.md` for how questions are chosen.

## 4. Approaches and design directions (P3 and P4, ends at B2)

```bash
./forge select workspace/harbor/intake/brief.json   # which approaches the brief selects, and why
./forge directions harbor                            # 3 directions, rendered at desktop and mobile
./forge directions harbor --check                    # the design rules on what is there
```

`forge directions` does three things:

- writes `design/approach-decision.json` if it is missing;
- writes `design/directions.json`;
- writes `design/renders/`, with screenshots that need Playwright. Use `--no-render` for HTML only.

To choose a direction, record B2, then mark it in `design/directions.json`:

```bash
./forge approve harbor B2          # note the ledger number it prints
```

```json
"status": "chosen",
"chosen": "dir-coastal",
"approval": { "code": "B2", "ledgerSeq": 26 }
```

Use `./forge validate designDecision workspace/harbor/design/directions.json` to check the edit. See `docs/design.md` and `docs/registry.md`.

## 5. Build the site (P9)

```bash
./forge site harbor --build
```

This copies the starter (`starters/astro-base/`) into `workspace/harbor/site/` and writes into it:

- the chosen direction as tokens;
- one page per brief page;
- the forms.

It then installs and builds the site, and checks the 150 KB JavaScript budget. Pages stay `status: scaffold` until Content & UX locks the copy in `content/pages/` (B3). See `docs/starter.md`.

Apply each approach the decision selects (APP-02 to APP-08), then place its sections as its skill describes:

```bash
./forge approach harbor APP-02
```

See `docs/approaches.md`.

## 6. Check it (P11)

```bash
./forge gates harbor                 # all 11 gates; evidence/gates/<gate>.json; exits 1 below the quality floor
./forge gates harbor --gate seo      # one gate
./forge qa harbor                    # a QA Verifier review: reports/defects.json and reports/qa-log.md
```

On a fresh scaffold, expect these gates to fail. Each failure is real work for a later phase, not a bug:

| Gate | Finding | Why | What clears it |
| --- | --- | --- | --- |
| `content-parity` | `skipped` (`NO_LOCKED_CONTENT`) | Copy is locked at B3 | Locked pages in `content/pages/` |
| `licences` | `no-register` | Asset Rights works in P7 | Writing `assets/register.json` |
| `seo` | `canonical-missing` | Hosting is not decided yet | Setting `url` in `site/src/site.json` |
| `forms` | `no-endpoint` | No endpoint yet | The form plugin setting each form's `action` |

`forge qa harbor --repair` runs the repair loop with the Claude Code builder. It needs the project to be in `QUALITY_REVIEW`. See `docs/gates.md` and `docs/qa.md`.

## 7. Move between phases, preview, deploy and report

A project moves to its next phase only when that phase's exit gate holds. That means its tasks are done, its evidence is there (for example a valid brief at P1, a chosen direction at P4, a built site at P9, or the quality floor at P11), and its approval is recorded:

```bash
./forge advance harbor --check       # what still stands between the project and its next phase
./forge advance harbor               # move on; a refusal names what is missing, in the ledger too
./forge run harbor --advance         # run each phase's tasks and move on, until an approval or a blocker stops it
```

When the site is ready, preview, deploy and report:

```bash
./forge plugins enable local-preview
./forge preview harbor               # serves site/dist on 127.0.0.1, after a secret scan
./forge plugins enable vercel        # needs VERCEL_TOKEN in .env
./forge approve harbor B5            # integrations
./forge deploy harbor --preview      # a Vercel preview, smoke-tested; forms get the form function
./forge approve harbor B6            # you accepted the preview
./forge advance harbor
./forge approve harbor B7            # production
./forge deploy harbor --production
./forge report harbor                # reports/final-report.md, built from the ledger
```

To try the whole flow without a model or any paid API, run `./forge demo`. It replays the sample business project to a local preview. `./forge test --mock` runs the full suite with every plugin in mock mode.

## Still needs real accounts

Everything above is built. These parts are tested only against stand-ins until they run with real accounts:

- the workers (`forge run`), which need Claude Code signed in;
- the vercel, form-function and spline plugins, which need a Vercel token, a webhook and a Spline scene. Their status in `forge plugins list` stays `implemented-unverified` until then.

See `docs/troubleshooting.md` when something fails.

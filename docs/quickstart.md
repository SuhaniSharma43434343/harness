# Quickstart

This walks one project from a new folder to a built, checked site, using only commands that work today. Each step names the phase and approval it belongs to (P0 to P15, B1 to B7; see the project plan). Commands are shown for macOS and Linux. On Windows, use `.\forge.cmd` in PowerShell with the same arguments.

The walkthrough was run end to end on 2026-10-28 with the `business` sample answers below.

## 1. Set up (once)

```bash
./scripts/setup.sh --with-test-tools   # Node deps, the starter's Astro deps, Playwright, axe, Lighthouse, Chromium
./forge doctor                         # Node 22+, npm 10+, Git, Claude Code, config, .env, workspace
```

`--with-test-tools` installs the browser tools that the browser gates need. Without it, those gates report `error` (`UNAVAILABLE`), never a pass. Copy `.env.example` to `.env` only when you need a credential.

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

If the approach decision selects APP-02, APP-04 or APP-06, apply it, then place its sections as its skill describes:

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

## Not built yet

`forge --help` lists every planned command and its milestone. Running one says it is not built. The main gaps for an end-to-end run are:

- **No command moves a project to the next phase after an approval.** The runner wiring for phases and the task board is engine work in progress. Today the phase commands above run whatever phase the project is in, except `forge qa --repair`, which needs `QUALITY_REVIEW`.
- **Several commands are not built:** `preview`, `deploy`, `report`, `test --mock`, `demo`, `task` (Cursor step mode), `package` and `upgrade`.
- **The plugin host is not built,** nor are the Git, preview, Vercel, form and Spline plugins.

See `docs/troubleshooting.md` when something fails.

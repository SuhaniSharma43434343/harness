# Forge

Forge is a portable AI website production harness. The full design is in the project plan, "Forge: Portable AI Website Production Harness — Project Plan".

## Status

Milestone 1 (architecture and contracts) is in place, along with much of the runtime and the website side. The repository contains, in task order:

- T01: the CLI skeleton, launchers, config loader and `forge doctor`
- T02: the runtime schemas (task, plugin manifest, gate result, ledger entry) and the config schema, with fixtures and tests
- T03 and T04: project state and phases, the ledger, approval enforcement, the task runner, retries, locks and recovery
- T05: the 8 agent definitions, the Claude Code and Cursor generator, and phase routing
- T06: the Claude Code worker adapter, with recording and replay
- T07: the plugin host: manifests, config checks, health checks, permissions and approvals
- T08: the git, local-preview, vercel, form-function and spline plugins ([docs/plugins.md](docs/plugins.md))
- T09: Claude Code hooks for file boundaries, B7 and `.env`; secret redaction; `forge scan` ([docs/security.md](docs/security.md))
- T10: the Cursor path: step mode (`forge task`), `AGENTS.md`, `CLAUDE.md`, Cursor rules and the pre-commit secret scan ([docs/cursor.md](docs/cursor.md))
- T11: packaging (`forge package`, with a clean-extraction test) and `forge upgrade` ([docs/packaging.md](docs/packaging.md))
- T13: the project schemas (brief, facts, question bank, approach registry, selection matrix, approach decision, design decision, rule condition), with fixtures, 7 sample briefs and tests
- T14: the question bank (`registry/questions/`) and the intake rules ([docs/intake.md](docs/intake.md))
- T15: the intake workflow (`forge intake`): brief, facts, plan and estimate, ready for B1
- T16: the approach registry, the selection matrix and the approach selector ([docs/registry.md](docs/registry.md))
- T17: design directions (`forge directions`), checked against the design rules ([docs/design.md](docs/design.md))
- T18: the starter website (APP-01) and `forge site` ([docs/starter.md](docs/starter.md))
- T19: the APP-02 Cinematic Scroll module and `forge approach` ([docs/approaches.md](docs/approaches.md))
- T20: the APP-04 Spline and APP-06 Game-Like modules ([docs/approaches.md](docs/approaches.md))
- T12: the APP-03 Interactive 3D, APP-05 Shader, APP-07 composite and APP-08 Frame Animation modules, so all eight approaches are built ([docs/approaches.md](docs/approaches.md))
- T21: the content gates (`forge gates`): content parity, claims, licences, secrets, SEO and dependencies ([docs/gates.md](docs/gates.md))
- T22: the browser gates: routes, accessibility, forms, responsive and performance ([docs/gates.md](docs/gates.md))
- T23: gate fixtures (`fixtures/sites/`): a blank site, a known-good site and seeded defects for every gate
- T24: the QA Verifier and repair loop (`forge qa`) ([docs/qa.md](docs/qa.md))
- T25: the operator docs listed below

The licence is still to come before a release. Every command in the plan is built; `forge --help` lists them.

## Documentation

| Doc | For |
| --- | --- |
| [QUICKSTART.md](QUICKSTART.md) | Taking one project from brief to a gated, QA-reviewed site |
| [docs/claude-code.md](docs/claude-code.md) | Running Forge with Claude Code |
| [docs/cursor.md](docs/cursor.md) | Running Forge from Cursor |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common failures and what to do |
| [docs/approaches.md](docs/approaches.md) | The eight approaches, their modules and fallbacks |
| [docs/gates.md](docs/gates.md) | Every automated gate and its thresholds |
| [docs/qa.md](docs/qa.md) | Defect reports and the repair loop |
| [docs/intake.md](docs/intake.md), [docs/registry.md](docs/registry.md), [docs/design.md](docs/design.md), [docs/starter.md](docs/starter.md) | Intake, approach selection, design rules and the starter |
| [docs/plugins.md](docs/plugins.md), [docs/security.md](docs/security.md) | Plugins, the guard hook and secret handling |
| [docs/interfaces.md](docs/interfaces.md) | The frozen M1 interfaces |

## Requirements

- Node.js 22 or later, npm 10 or later
- Git 2.40 or later
- Claude Code, signed in. This is only needed for real-model runs in later milestones, and `doctor` warns if it is missing.

## Setup

macOS / Linux:

```bash
./scripts/setup.sh
./forge doctor
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
.\forge.cmd doctor
```

`setup` installs the pinned dependencies and creates `forge.config.json` from `forge.config.example.json`. To add credentials, copy `.env.example` to `.env`. Never commit `.env` or `forge.config.json`; both are git-ignored.

## Commands available now

| Command | What it does |
| --- | --- |
| `forge --help` | Lists the commands |
| `forge --version` | Prints the harness version |
| `forge doctor [--json]` | Checks Node, npm, Git, Claude Code, the config, `.env` and the workspace |
| `forge validate <schema> <file>` | Validates a JSON file against a schema. A `.jsonl` file is validated line by line |
| `forge new <project> [--brief <file>]` | Creates `workspace/<project>/` with its state file and ledger |
| `forge approve <project> <code>` | Records an operator approval (A0 to A3, B1 to B7) in the ledger |
| `forge status <project> [--json]` | Shows the phase, the approval it needs to exit, recorded approvals and tasks |
| `forge run <project> [--replay <dir>] [--model <m>]` | Runs every task that can start through Claude Code, or plays back recorded attempts with `--replay` |
| `forge agents [list\|generate\|check]` | Lists the agents for each phase, or generates and checks `.claude/agents/` and `.cursor/rules/` from `agents/` |
| `forge intake <project> [--answers <file>] [--use-recommendations]` | Runs intake (P1): asks only what is unknown, records assumptions, and writes the brief, facts, estimate and plan for B1 |
| `forge approach <project> <APP-0N> [--no-install]` | Applies a selected approach module to the site: its sections, runtime, packages and licence rows |
| `forge qa <project> [--gate name] [--repair]` | Runs a QA Verifier review (`reports/defects.json`, fresh evidence), or with `--repair` the repair loop with the builder, escalating after 3 loops |
| `forge gates <project> [--gate name] [--preview] [--json]` | Runs the automated gates on the built site, writes `evidence/gates/<gate>.json` and a `gate_result` ledger entry per gate, and exits 1 unless the quality floor is met |
| `forge directions <project> [--count n] [--check]` | Proposes 3 to 5 design directions for P4, renders them at desktop and mobile, or checks them against the design rules |
| `forge select <brief.json> [--json]` | Shows which approaches a brief selects, the reason for each, and the fallbacks |
| `forge plugins [list\|enable\|disable\|check] [id]` | Lists plugins, or enables one after its config and health check pass (see `docs/plugins.md`) |
| `forge task <next\|check\|submit\|abandon> <project> [task]` | Step mode for Cursor without Claude Code (see `docs/cursor.md`) |
| `forge hooks install [dir]` | Adds the secret-scan pre-commit hook to a repository |
| `forge scan [path...]` | Reports files holding something that looks like a credential, and any `.env` file (see `docs/security.md`) |
| `forge package [--verify]` | Maintainers: builds and audits the portable ZIP (see `docs/packaging.md`) |
| `forge audit [--out <dir>]` | Release security review: npm audit plus secret scans of the ZIP, workspace and logs |
| `forge upgrade --from <dir> [--dry-run]` | Copies `.env`, the config and projects from an older Forge folder |
| `forge advance <project> [--check]` | Moves to the next phase when its exit gate holds: tasks, evidence and approval |
| `forge preview <project>` | Serves the built site locally, after a secret scan |
| `forge deploy <project> --preview\|--production` | Deploys with the vercel plugin and smoke-tests the URL |
| `forge report <project>` | Writes the final report from the ledger |
| `forge test [--mock]` | Runs the test suite; `--mock` puts every plugin in mock mode |
| `forge demo` | Replays the sample project to a local preview, with no model or paid API |
| `forge resume <project> [--json]` | Requeues tasks left running by an interruption and frees their locks |
| `forge site <project> [--brief <file>] [--tokens <file> \| --direction <file>] [--force] [--build]` | Copies the starter into `workspace/<project>/site/` and writes the brief, tokens and pages into it. `--build` installs, builds and checks the JavaScript budget |

The schema names are `task`, `plugin`, `gateResult`, `ledgerEntry`, `config` and `projectState` (runtime), and `brief`, `facts`, `questionBank`, `approach`, `selectionMatrix`, `approachDecision`, `designDecision`, `condition`, `estimate`, `defectReport`, `tokens` and `siteConfig` (project).

`forge run` starts only the tasks whose agent works in the project's current phase, one headless `claude -p` session per task in the project folder, with the agent's role instructions as a system prompt. It is limited to read and edit tools with the forge guard hook checking every write against the task's contract. Run `claude` once and sign in first. Every attempt is recorded in `evidence/recordings/<task>/`, and `forge run --replay <dir>` plays recordings back without calling the model.

## Tests

```bash
npm test
```

The tests validate every fixture in `fixtures/schemas/valid` and check that every fixture in `fixtures/schemas/invalid` is rejected. They also check that there is one valid sample brief per project type, and run the CLI commands. The build tests in `tests/build/` build a site from every sample brief; they need the starter's dependencies, which `setup` installs, and are skipped with the reason without them. The browser gate tests need the test tools (`scripts/setup.sh --with-test-tools`) and are skipped the same way; set `FORGE_SLOW_TESTS=1` to include real Lighthouse runs.

## Layout

```text
forge, forge.cmd          launchers (macOS/Linux, Windows)
plugins/                  git, local-preview, vercel, form-function, spline (off until enabled)
agents/                   the 8 agent roles (source of truth)
.claude/agents/           generated Claude Code subagents (forge agents generate)
.cursor/rules/            generated Cursor rules (forge agents generate)
src/cli/                  command router, doctor, validate, project commands
src/core/                 config, schemas, typed errors, project state, ledger,
                          task board, runner, locks, recovery
src/site/                 brief -> pages, design tokens, scaffold and build (T18)
starters/astro-base/      the starter website (APP-01)
skills/app01/             APP-01 module instructions for builders
skills/app02/ to app08/     approach modules: skill and recipes (sections, runtime) copied by forge approach
src/approaches/           approach modules and applyApproach
schemas/                  JSON Schemas (M1 interface contracts)
fixtures/schemas/         valid and invalid examples for every schema
fixtures/sites/           gate fixtures: blank, known-good and seeded defects
samples/briefs/           one sample brief per project type (7)
registry/                 question bank, approach registry entries and the selection matrix
src/intake/               question selection, answers and assumptions, brief drafting and checks
tests/intake/             client material for the sample briefs and the intake suite
src/registry/             condition evaluator, registry loader, approach selector
tests/decision/           decision briefs and the approach selection suite
tests/unit/               node:test suites
tests/build/              starter and approach build tests
tests/gates/, tests/qa/   gate and QA Verifier suites
scripts/                  setup.sh, setup.ps1
docs/                     operator and reference docs (see Documentation)
workspace/                projects are created here (git-ignored)
```

## Licence

The licence has not been chosen yet (MIT is recommended in the plan). It will be added once the decision is confirmed.

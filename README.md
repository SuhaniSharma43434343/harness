# Forge

Forge is a portable AI website production harness. The full design is in the project plan, "Forge: Portable AI Website Production Harness — Project Plan".

## Status

This repository is at the start of **Milestone 1 (Architecture and Contracts)**. It contains:

- T01: the CLI skeleton, launchers, config loader and `forge doctor`
- T02: the runtime schemas (task, plugin manifest, gate result, ledger entry) and the config schema, with fixtures and tests
- T03 and T04 (core runtime, from M2): project state and phases, the ledger, approval enforcement, the task runner, retries, locks and recovery
- T13: the project schemas (brief, facts, question bank, approach registry, selection matrix, approach decision, design decision, rule condition), with fixtures, 7 sample briefs and tests

The plugin host, Claude Code hooks and the worker adapter are not built yet. `forge --help` lists the planned commands and the milestone each one belongs to. Running one of them says it is not built yet, rather than pretending to work.

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
| `forge --help` | Lists the available and planned commands |
| `forge --version` | Prints the harness version |
| `forge doctor [--json]` | Checks Node, npm, Git, Claude Code, the config, `.env` and the workspace |
| `forge validate <schema> <file>` | Validates a JSON file against a schema. A `.jsonl` file is validated line by line |
| `forge new <project> [--brief <file>]` | Creates `workspace/<project>/` with its state file and ledger |
| `forge approve <project> <code>` | Records an operator approval (A0 to A3, B1 to B7) in the ledger |
| `forge status <project> [--json]` | Shows the phase, the approval it needs to exit, recorded approvals and tasks |
| `forge resume <project> [--json]` | Requeues tasks left running by an interruption and frees their locks |

The schema names are `task`, `plugin`, `gateResult`, `ledgerEntry`, `config` and `projectState` (runtime), and `brief`, `facts`, `questionBank`, `approach`, `selectionMatrix`, `approachDecision`, `designDecision` and `condition` (project).

`forge run` needs the claude-code worker adapter (T06), so it is still listed as planned. The runner itself is in `src/core/runner.mjs` and takes the worker as an argument.

## Tests

```bash
npm test
```

The tests validate every fixture in `fixtures/schemas/valid` and check that every fixture in `fixtures/schemas/invalid` is rejected. They also check that there is one valid sample brief per project type, and run the CLI commands.

## Layout

```text
forge, forge.cmd          launchers (macOS/Linux, Windows)
src/cli/                  command router, doctor, validate
src/core/                 config, schemas, typed errors, project state, ledger,
                          task board, runner, locks, recovery
schemas/                  JSON Schemas (M1 interface contracts)
fixtures/schemas/         valid and invalid examples for every schema
samples/briefs/           one sample brief per project type (7)
tests/unit/               node:test suites
scripts/                  setup.sh, setup.ps1
docs/interfaces.md        M1 interface draft, runtime and project sides
workspace/                projects are created here (git-ignored)
```

## Licence

The licence has not been chosen yet (MIT is recommended in the plan). It will be added once the decision is confirmed.

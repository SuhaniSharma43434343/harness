# Using Forge with Claude Code

Claude Code is Forge's primary editor and its worker. You talk to Claude Code, and the work happens through `forge` commands. Every task a model does runs as a headless Claude Code session, limited to that task's contract.

## Setup

1. Install Claude Code and sign in. `./forge doctor` shows the version it found, or how to fix it.
2. Run `./scripts/setup.sh`, then `claude` in the Forge folder.
3. Generate the subagents from the role definitions, and check they are current:

   ```bash
   ./forge agents generate     # writes .claude/agents/<role>.md (and .cursor/rules/)
   ./forge agents check        # fails if agents/ changed since the last generate
   ./forge agents list         # which roles work in which phase
   ```

   `agents/<role>.md` is the source of truth. Do not edit the generated files.

## Working in a session

- Ask for what you want ("Start a new website project for …"). The Project Manager role runs `forge new` and `forge intake`, and shows you each approval before asking you to give it.
- **Approvals are yours.** `forge approve <project> <B1-B7>` records one in the ledger as `operator`. An agent may run it only after you say yes. The CLI refuses an action whose approval is missing, and records the refusal.
- Answer intake questions in your own words, or say "use your recommendation". Every recommendation is recorded as an assumption in `intake/facts.json` and the brief.

## Workers: `forge run`

```bash
./forge run <project>                    # every task that can start in the current phase
./forge run <project> --model <model>    # a specific model for the workers
./forge run <project> --replay <dir>     # play recorded attempts back, with no model calls
```

Each task on the board (`board/<task>.json`) runs as `claude -p` with read and edit tools, inside the project folder. The worker gets its role's instructions and the contract:

- `owns_files`
- `must_not_touch`
- acceptance criteria
- the verify command

A task is `done` only when its verify command passes. The verify log is kept in `evidence/tasks/<task>/`.

Every attempt is recorded to `evidence/recordings/<task>/attempt-N.json`, including failed ones. `--replay` plays the recordings back identically, which is how the tests run without a model. Failures map to typed errors: not signed in (`AUTH_FAILED`), a usage limit (`RATE_LIMITED`), or no `claude` on PATH (`CONFIG_MISSING`). See `docs/troubleshooting.md`.

## Skills

`skills/app0N/SKILL.md` tells a builder how to use each approach module. The builder reads the skill named in the registry entry (`module.skill`) for the approaches its task lists.

## Not built yet

These are engine work in progress (plan T09), so treat them as planned, not available:

- the `CLAUDE.md` that routes requests to the Project Manager;
- the hooks that block writes outside a contract, block a production deploy without B7, and keep `.env` out of agent output.

Until the hooks exist, boundaries rest on the contracts, `owns_files` file locks in the runner, and review. The QA Verifier never trusts a builder's report: only a fresh gate run closes a defect (`docs/qa.md`).

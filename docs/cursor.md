# Using Forge with Cursor

Cursor is a supported front end, but it does not run Claude Code subagents or hooks. With Cursor, the `forge` CLI is what enforces the boundaries.

## Setup

1. Run `./scripts/setup.sh` and `./forge doctor`.
2. Generate the Cursor rules from the role definitions:

   ```bash
   ./forge agents generate     # writes .cursor/rules/<role>.mdc (and .claude/agents/)
   ./forge agents check
   ```

   Each rule carries one role's responsibilities and what it must never do. `agents/<role>.md` is the source of truth.

3. Open the Forge folder in Cursor.

## Delegated mode (recommended, works today)

If the Claude Code CLI is installed and signed in, Cursor is the conversation front end and the workers are Claude Code:

- Ask Cursor's agent to run `forge` commands: `forge new`, `forge intake`, `forge status`, `forge run`, `forge gates`, `forge qa`.
- **Approvals stay with you.** Run `forge approve <project> <code>` yourself, or tell the agent to after you have read what it covers.
- `forge run` hands each task to a headless Claude Code worker limited to its contract, exactly as in `docs/claude-code.md`.

## Step mode (planned)

Without Claude Code, step mode will hand out one contract at a time:

- `forge task next` gives the next contract;
- the Cursor agent edits;
- `forge task submit <id>` rejects any change outside `owns_files` before the gates run.

This is plan task T10 and is not built yet: `forge task` reports that.

The Git pre-commit hook that runs the secret scan is also part of T10. Until it exists, run `./forge scan` (the harness) and `./forge gates <project> --gate secrets` (the built site) before committing.

## Rules that hold in both modes

- Agents write only inside `workspace/<project>/` and their contract's files.
- Locked content (`content/pages/`, after B3) and tokens (after B2) change only with a new approval.
- A gate decides completion. An agent's report never does (`docs/gates.md`, `docs/qa.md`).

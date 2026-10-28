# Using Forge in Cursor

Cursor runs no Claude Code subagents or hooks, so the forge CLI enforces every boundary itself. Cursor's agent gets the Project Manager role and the command rules from `AGENTS.md` and `.cursor/rules/forge.mdc`, and each role has its own rule in `.cursor/rules/<role>.mdc`. All of these are generated from `agents/` by `forge agents generate`.

## Delegated mode (recommended)

When the Claude Code CLI is installed and signed in, Cursor is the conversation front end and `forge run <project>` does the work. It uses the same headless workers as Claude Code, guard hook included.

## Step mode

Without Claude Code, `forge task` hands out one task contract at a time.

1. `forge task next <project>` starts the next task that can run and prints its contract. A task can run when its dependencies are done, its agent works in the project's phase, and no other step task is open. It also records the state of the project's files.
2. Cursor's agent makes the change, touching only the files under "You may change only".
3. `forge task check <project> <task>` lists what has changed so far, and anything outside the contract.
4. `forge task submit <project> <task> [--evidence a,b]` compares the files again.
   - **A change outside the contract:** if any file changed outside `owns_files`, or inside `must_not_touch`, the submission is refused and the refusal goes in the ledger. The task stays open, so the agent can undo the change and submit again.
   - **Everything inside:** the changed files become evidence, then the task's verify command runs. The task ends `done`, goes back to `retry` for another attempt, or is `blocked` once its retries are used up.
5. `forge task abandon <project> <task>` gives up the open task, which uses up one attempt.

`forge resume` does not requeue a step-mode task. A person is working on it, not a process with a heartbeat.

## Pre-commit secret scan

The git plugin installs a pre-commit hook in every project repository, and `forge hooks install [folder]` adds the same hook to any other repository, such as a clone of the harness. Before each commit, the hook runs `forge scan --staged`. It stops the commit if the staged changes contain something that looks like a credential, or a `.env` file. It prints the file, line and kind of secret, never the secret itself. If the repository already has a different pre-commit hook, it is left alone unless you pass `--force`.

## Rules that hold in both modes

- Agents write only inside `workspace/<project>/` and their contract's files.
- Locked content (`content/pages/`, after B3) and tokens (after B2) change only with a new approval.
- **Approvals stay with you.** Run `forge approve <project> <code>` yourself, or tell the agent to after you have read what it covers.
- A gate decides completion. An agent's report never does (`docs/gates.md`, `docs/qa.md`).

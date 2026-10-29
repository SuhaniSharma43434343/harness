# Security controls

This page covers what the harness enforces itself. The plan's security section lists the full set of controls.

## Claude Code hooks

`src/hooks/guard.mjs` is a Claude Code `PreToolUse` hook. It runs before every `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` and `Bash` call. When it blocks a call, it exits with code 2 and gives the agent the reason.

It is installed in two places:

- `.claude/settings.json`, for anyone who opens the harness folder in Claude Code;
- every `forge run` worker, through `--settings`. Workers also get `FORGE_PROJECT`, `FORGE_TASK` and `FORGE_WORKSPACE`, so the guard knows their contract.

| Rule | Interactive session | Task worker |
| --- | --- | --- |
| `.env` files (not `.env.example`) are never read or written, by a tool or a shell command | enforced | enforced |
| `project.json`, `ledger.jsonl`, `board/`, `locks/`, `evidence/recordings/` and `evidence/tasks/` in a project change only through forge commands | enforced | enforced |
| `forge deploy <project> --production` needs B7 in that project's ledger | enforced | enforced |
| Deploying to production with the Vercel CLI directly is blocked | enforced | enforced |
| Writes must stay inside the project and match the task's `owns_files`, and never `must_not_touch` | not applied | enforced |
| The shell | allowed | blocked |

An interactive session can still edit the harness itself, which is how Suhani and Nidhi develop it. A worker fails closed: if the guard cannot read its contract or the hook input, the call is blocked.

Cursor runs no hooks. For Cursor's step mode, the CLI's `forge task submit` and a Git pre-commit hook will enforce the same rules (T10).

## Redaction

`src/core/redact.mjs` masks anything that looks like a credential as `[REDACTED]` before it is written to:

- the ledger;
- a worker recording (its reply and messages);
- a verify log.

It finds two kinds of secret:

- **Known token formats:** Anthropic, OpenAI, GitHub, AWS, Slack, Stripe and Google keys, JWTs, private keys, `Bearer` tokens, and `name=value` pairs whose name says key, token, secret or password.
- **Actual credential values:** any variable in the operator's environment whose name looks like a secret (KEY, TOKEN, SECRET, PASSWORD, WEBHOOK and so on).

A worker recording keeps the files a worker wrote exactly as written, so a replay stays identical. The secret scan reports any credential in them.

## Secret scan

`forge scan [path...]` reports every file that contains something that looks like a credential, and every `.env` file other than `.env.example`. It gives the file, the line and the kind of secret, never the secret itself, and exits with code 1 when it finds anything. Packaging (T11) and the Cursor pre-commit hook (T10) will run it. A test checks that the harness's own source, schemas, docs, plugins and fixtures stay clean.

## Release audit

`forge audit` is the release security review (acceptance A13). It checks two things:

- **Dependencies:** it runs `npm audit` on every lockfile the harness installs from: the harness, `starters/astro-base` and `tools`. Any high or critical advisory fails the audit.
- **Secrets:** it builds the package ZIP and audits every entry (see `docs/packaging.md`), then scans `workspace/` (every project's files, ledger, logs and reports) and any `.log` file in `dist/`.

It writes `dist/audit-<date>.md` and `.json`, and exits 1 when anything fails. The fixture lockfiles under `fixtures/sites/` are test data for the dependencies gate. They are never installed, so the audit does not include them.


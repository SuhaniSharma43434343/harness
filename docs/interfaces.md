# M1 interface draft (runtime side)

This is Suhani's half of the M1 interface freeze, for review with Nidhi. Nothing here is frozen until both owners sign it off. After the freeze, any change needs a pull request approved by both.

## Schemas provided by the runtime (Suhani)

| Schema | File | Used by |
| --- | --- | --- |
| Task contract | `schemas/task.schema.json` | Runner, Lead Developer, QA Verifier, Cursor step mode |
| Plugin manifest | `schemas/plugin-manifest.schema.json` | Plugin host, every plugin |
| Gate result | `schemas/gate-result.schema.json` | Nidhi's gates write it; the runner and QA Verifier read it |
| Ledger entry | `schemas/ledger-entry.schema.json` | Every component that records events |
| Config | `schemas/forge-config.schema.json` | CLI, doctor |

### Rules the schemas already enforce

- **Task:** a task cannot be `done` without at least one evidence path, and a `blocked` task needs a `blocked_reason`. Retries are capped at 2. File paths must be project-relative, with no absolute paths and no `..`. Approach ids are APP-01 to APP-08.
- **Plugin:** `enabledByDefault` must be `false`. A plugin with the `spend` action must require B4. A plugin with the `deploy` action must list its approvals. A paid plugin must give a cost disclosure and a pricing link. Integration status is one of `planned`, `implemented-unverified` or `implemented-tested`, and it defaults to `planned`.
- **Gate result:** the status is `pass`, `fail`, `error` or `skipped`. An `error` or `skipped` result must say why, and it is never counted as a pass.
- **Ledger:** only `operator` can record an approval, using A0 to A3 or B1 to B7. A refusal must record the action and the reason.

## Schemas expected from the project side (Nidhi)

These are needed for M1 and are not in this repository yet:

- `schemas/brief.schema.json`
- `schemas/facts.schema.json` (each fact is known, inferred or unknown)
- `schemas/approach-registry.schema.json` (APP-01 to APP-08)
- `schemas/question-bank.schema.json`

## Function signatures to agree at M1

| Function | Provided by | Signature (draft) | Working by |
| --- | --- | --- | --- |
| `runTask` | Suhani | `runTask(project: string, taskId: string) => Promise<TaskResult>` | M2 |
| `ledger.append` | Suhani | `append(project: string, entry: Omit<LedgerEntry, 'seq' \| 'ts'>) => LedgerEntry` | M2 |
| `getPlugin` | Suhani | `getPlugin(id: string) => Promise<Plugin>`; throws `ConfigMissing` or `PermissionDenied` | M2 |
| `selectQuestions` | Nidhi | to be proposed | M2 |
| `validateBrief` | Nidhi | to be proposed | M2 |
| `selectApproaches` | Nidhi | to be proposed | M2 |
| `runGate` | Nidhi | `runGate(name: string, siteDir: string) => Promise<GateResult>` | M3 |

## Shared error format

Every component throws one of the typed errors in `src/core/errors.mjs`: `ConfigMissing`, `ConfigInvalid`, `AuthFailed`, `RateLimited`, `Unavailable`, `PermissionDenied`, `SchemaInvalid` or `NotImplemented`. Each has a `code`, a `message`, an optional `hint` for the operator, and optional `details`.

## Open questions for the freeze

1. Should gate results carry the project's harness, registry and schema versions, or should the ledger hold them?
2. Should the task `budget.minutes` limit be enforced per attempt or across all attempts?
3. Which folder structure for `workspace/<project>/` do both sides agree on?

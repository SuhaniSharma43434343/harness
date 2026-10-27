# M1 interfaces (frozen)

This document holds both halves of the M1 interface freeze: the runtime side (Suhani) and the project side (Nidhi). It was frozen on 2026-10-27: the project lead asked for the open questions to be decided so work could move on, and the decisions are recorded in [Decisions at the freeze](#decisions-at-the-freeze). From now on, any change needs a pull request approved by both owners. Either owner can reopen a decision that way.

## Schemas provided by the runtime (Suhani)

| Schema | File | Used by |
| --- | --- | --- |
| Task contract | `schemas/task.schema.json` | Runner, Lead Developer, QA Verifier, Cursor step mode |
| Plugin manifest | `schemas/plugin-manifest.schema.json` | Plugin host, every plugin |
| Gate result | `schemas/gate-result.schema.json` | Nidhi's gates write it; the runner and QA Verifier read it |
| Ledger entry | `schemas/ledger-entry.schema.json` | Every component that records events |
| Config | `schemas/forge-config.schema.json` | CLI, doctor |
| Project state | `schemas/project-state.schema.json` | Runtime only (`project.json`); others read it through `forge status` |

### Rules the schemas already enforce

- **Task:** a task cannot be `done` without at least one evidence path, and a `blocked` task needs a `blocked_reason`. Retries are capped at 2. File paths must be project-relative, with no absolute paths and no `..`. Approach ids are APP-01 to APP-08.
- **Plugin:** `enabledByDefault` must be `false`. A plugin with the `spend` action must require B4. A plugin with the `deploy` action must list its approvals. A paid plugin must give a cost disclosure and a pricing link. Integration status is one of `planned`, `implemented-unverified` or `implemented-tested`, and it defaults to `planned`.
- **Gate result:** the status is `pass`, `fail`, `error` or `skipped`. An `error` or `skipped` result must say why, and it is never counted as a pass.
- **Ledger:** only `operator` can record an approval, using A0 to A3 or B1 to B7. A refusal must record the action and the reason.

## Schemas provided by the project side (Nidhi)

| Schema | Short name | File | Written by | Read by |
| --- | --- | --- | --- | --- |
| Brief | `brief` | `schemas/brief.schema.json` | Project Manager (P1) | Every agent; approved at B1 |
| Facts | `facts` | `schemas/facts.schema.json` | Project Manager (P1) | `selectQuestions`, `validateBrief`, final report |
| Question bank | `questionBank` | `schemas/question-bank.schema.json` | Nidhi (T14) | `selectQuestions` |
| Approach registry entry | `approach` | `schemas/approach-registry.schema.json` | Nidhi (T16), one per APP-0N | `selectApproaches`, Lead Developer, builders |
| Selection matrix | `selectionMatrix` | `schemas/selection-matrix.schema.json` | Nidhi (T16) | `selectApproaches` |
| Approach decision record | `approachDecision` | `schemas/approach-decision.schema.json` | `selectApproaches` (P3) | Creative Director, Lead Developer; reviewed at B2 |
| Design decision | `designDecision` | `schemas/design-decision.schema.json` | Creative Director (P4) | Content & UX, builders; chosen at B2 |
| Rule condition | `condition` | `schemas/condition.schema.json` | (shared language) | Question rules, selection rules, design rules |

`schemas/common.schema.json` holds the shared enumerations (project types, tiers, approach ids, approval codes, motion intensity, device floor, fallback triggers). It is referenced by the others and is not validated on its own.

### Rules the schemas already enforce

- **Brief:** every page has a purpose and a call to action. Motion intensity is 0 to 3. `approved` needs a B1 record with its ledger sequence, and `draft` or `ready` cannot carry one. Release 1.0 sites are single-language. `assumptions` lists the brief fields whose values are assumptions.
- **Facts:** each brief field is `known`, `inferred` or `unknown`. A known fact comes from the client material or an answer. An inferred fact needs a value, a source, a reason and `assumption: true`, so every "use your recommendation" is recorded as an assumption (acceptance criterion A5). An unknown fact has no value or source.
- **Question bank:** every question names the brief fields it `fills`, so a question is never asked when those fields are known. Every question has a recommendation with a reason. Single and multi choice questions must list options, and other kinds must not.
- **Approach registry:** every approach except APP-01 has a fallback with at least one trigger. APP-07 must list the approaches it is composed of. Each approach lists at least 3 positive and 3 negative test briefs. An approach cannot be marked `implemented` or `verified` without build, fallback and budget tests.
- **Selection matrix:** every project type has a row with all eight approaches, and APP-01 is `default` in every row. Promotions out of `experimental` must cite evidence.
- **Approach decision:** exactly one decision per approach, each with a reason. APP-01 is always selected. A selected approach other than APP-01 names its fallback. A selected experimental approach needs B1 or B2. An excluded approach cannot be selected.
- **Design decision:** 3 to 5 directions, each rendered at desktop and mobile. Fonts must be open-licensed (OFL, Apache, MIT), system, or client-licensed. Body text contrast is at least 4.5:1, and large text and UI at least 3:1. `chosen` needs the choice and a B2 record.
- **Rule condition:** a leaf is `{ field, op, value }` on a brief field path; `all`, `any` and `not` combine leaves. The operators are `eq`, `neq`, `in`, `notIn`, `gte`, `lte`, `includes`, `exists` and `missing`.

### Project types and tiers

The plan asks for seven project types but does not name them. The frozen set is `business`, `launch`, `showroom`, `portfolio`, `event`, `nonprofit` and `flagship`, chosen to cover the approach rules in the plan (brand story and launch for APP-02, showroom for APP-03, enterprise flagship for APP-07). Each has one sample brief in `samples/briefs/`.

Tiers are `S`, `M` and `L`. S is up to 5 pages with no custom interaction, M is up to 12 pages or one advanced approach, and L is larger or combines several advanced approaches.

### Data formats

Registry, question bank and selection matrix files are JSON: `registry/approaches/APP-0N.json`, `registry/questions/*.json` and `registry/selection-matrix.json`. The plan names YAML, but the schemas validate the parsed object, and JSON keeps Release 1.0 free of a parser dependency. If YAML is wanted later, the loader can accept both without a schema change.

## Function signatures (frozen at M1)

| Function | Provided by | Signature | Working by |
| --- | --- | --- | --- |
| `runTask` | Suhani | `runTask(project: string, taskId: string, opts?: RunOptions) => Promise<TaskResult>` | M2 (built) |
| `ledger.append` | Suhani | `append(project: string, entry: Omit<LedgerEntry, 'seq' \| 'ts'>, opts?: { workspace?: string }) => LedgerEntry` | M2 (built) |
| `getPlugin` | Suhani | `getPlugin(id: string) => Promise<Plugin>`; throws `ConfigMissing` or `PermissionDenied` | M2 |
| `selectQuestions` | Nidhi | `selectQuestions(brief: Partial<Brief>, facts: Facts, bank: QuestionBank, opts?: { round?: 1 \| 2 \| 3, max?: number }) => Question[]` | M2 |
| `recordAnswer` | Nidhi | `recordAnswer(facts: Facts, question: Question, answer: unknown \| 'use-recommendation') => Facts` | M2 |
| `validateBrief` | Nidhi | `validateBrief(brief: Brief, facts: Facts) => { valid: boolean, errors: string[], missing: string[] }` | M2 |
| `selectApproaches` | Nidhi | `selectApproaches(brief: Brief, registry: ApproachEntry[], matrix: SelectionMatrix) => ApproachDecision` | M2 |
| `proposeDirections` | Nidhi | `proposeDirections(brief: Brief, decision: ApproachDecision, opts?: { count?: number }) => Promise<DesignDecision>` | M3 |
| `runGate` | Nidhi | `runGate(name: GateName, siteDir: string, opts?: { project?: string, thresholds?: object }) => Promise<GateResult>` | M3 |

### What each runtime function promises

- **`runTask`** runs one task through `ready`, `running`, `submitted`, `verifying` and `done`, retrying up to `budget.retries` times before `blocked`. `RunOptions` carries the `worker` (the claude-code adapter from T06), an optional `verifier`, and `workspace`. It resolves to `TaskResult`: `{ task, status: 'done' | 'blocked', attempts, evidence, reason? }`. A done or blocked task is returned as it is, with `reused: true`, and never run again.
- **Worker** (what `RunOptions.worker` must be): `worker({ task, project, projectDir, attempt, idempotencyKey, signal, heartbeat }) => Promise<{ evidence: string[] }>`. It works only in `projectDir`, stops when `signal` aborts, and throws a typed error on failure. The claude-code adapter (`src/workers/claude-code.mjs`) and the replay worker both follow it.
- **`ledger.append`** assigns `seq` and `ts`, checks the entry against the ledger schema, and appends one line. Callers cannot set `seq`, `ts` or `project`.

### What each project-side function promises

- **`selectQuestions`** is pure: it reads, and never writes, files. It drops every question whose `fills` fields are all `known` or `inferred` in the facts, and every question whose `appliesTo` or `askWhen` does not match. It returns the rest sorted by score (the weight, plus a boost when a required brief field is still unknown). Round 1 returns 5 to 10 questions; if fewer than 5 are candidates it returns them all. It throws `SchemaInvalid` if the bank is invalid.
- **`recordAnswer`** returns new facts. A real answer becomes a `known` fact with source `answer`. `'use-recommendation'` becomes an `inferred` fact with source `recommendation`, `assumption: true` and the question's recommendation reason. Follow-up questions are found by calling `selectQuestions` again.
- **`validateBrief`** runs the brief schema, then the checks a schema cannot make across files. Every required brief field has a `known` or `inferred` fact. Every inferred field is listed in `brief.assumptions`. `missing` lists the fields that still need an answer. The P1 exit gate is `valid && missing.length === 0`.
- **`selectApproaches`** is pure and deterministic, which the decision tests rely on. An approach is selected when its matrix status is not `excluded`, `selectWhen` holds, `rejectWhen` does not, and its required plugins are listed in `brief.integrations`. Experimental selections are marked `needsApproval: 'B2'`, or `'B1'` for APP-06 because the plan confirms play at B1. The output always validates against `approachDecision`.
- **`proposeDirections`** may call the model through Suhani's worker adapter. It applies the design rules (T17) and returns at least 3 directions that pass the schema.
- **`runGate`** never throws for a site problem: a failing site returns `status: 'fail'` with findings. A missing tool or plugin returns `status: 'error'` with the typed error code, which is never counted as a pass.




## Shared error format

Every component throws one of the typed errors in `src/core/errors.mjs`: `ConfigMissing`, `ConfigInvalid`, `AuthFailed`, `RateLimited`, `Unavailable`, `PermissionDenied`, `SchemaInvalid` or `NotImplemented`. Each has a `code`, a `message`, an optional `hint` for the operator, and optional `details`.

## Decisions at the freeze

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where do the harness, registry and schema versions live? | In `project.json`: `harnessVersion` from project creation, plus `registryVersion`, `questionBankVersion` and `schemaVersion` set at intake. A gate result carries only its own `gateVersion`. The ledger records every change, so no version needs repeating per entry. |
| 2 | Is `budget.minutes` per attempt or across all attempts? | Per attempt, covering the worker and the verify command together. With 2 retries, a task can use at most three times its budget. |
| 3 | `workspace/<project>/` layout | As below. The runtime owns `project.json`, `ledger.jsonl`, `board/` and `locks/`. Each other folder belongs to the agent named in the plan's agent table. |
| 4 | Starter template contract | Accepted as proposed: tokens in `site/src/styles/tokens.json`, page content in `site/src/content/pages/<slug>.md`, approach sections in `site/src/sections/<approach>/`. |
| 5 | Does `estimate.json` get a schema at M1? | No. It is defined with the Project Manager workflow in T15 and added by a pull request then. |
| 6 | Project types and tiers | The seven types and the tiers S, M and L above are frozen. |
| 7 | YAML or JSON registry files | JSON (see Data formats). |
| 8 | Error for an illegal phase or task transition | `PermissionDenied`, with the allowed moves in `details`. The shared error set stays as it is; lock conflicts and a busy project use `Unavailable`. |
| 9 | Where does a task's verify command run? | In the project folder, `workspace/<project>/`. A command that needs the site uses `cd site && ...` or a script in `site/package.json`. |
| 10 | Phase exit gates | The runtime checks the exit approval (B1, B2, B3, B6, B7). The evidence part of each exit gate comes from `runGate` and `validateBrief`, wired into the runner when those functions are built. B4 and B5 are checked at the action through `requireApproval`. |

### Workspace layout

```text
workspace/<project>/
  project.json         runtime: phase, repair count, versions
  ledger.jsonl         runtime: append-only event log
  board/<task>.json    runtime: one task contract per file
  locks/               runtime: run lock and per-file locks
  intake/              Project Manager: brief.json, facts.json, plan.md, estimate.json
  research/            Research & Strategy: research and source register
  design/              Creative Director: approach-decision.json, directions.json, tokens.json, renders/
  ux/  content/        Content & UX: sitemap, wireframe spec, locked content (after B3)
  assets/              Asset & Rights: assets and licence register
  site/                Lead Developer and builders: the generated site (starter template copied here)
  evidence/            QA Verifier and runner: gate results, screenshots, verify logs (evidence/tasks/<task>/)
  reports/             Project Manager and QA Verifier: status and final report
```

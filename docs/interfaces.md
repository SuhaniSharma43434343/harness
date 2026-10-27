# M1 interface draft

This document holds both halves of the M1 interface freeze: the runtime side (Suhani) and the project side (Nidhi). Each half is for review by the other owner. Nothing here is frozen until both owners sign it off. After the freeze, any change needs a pull request approved by both.

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
- **Facts:** each brief field is `known`, `inferred` or `unknown`. A known fact comes from the client material or an answer. An inferred fact needs a value, a source, a reason and `assumption: true`, so every "use your recommendation" is recorded as an assumption (A5). An unknown fact has no value or source.
- **Question bank:** every question names the brief fields it `fills`, so a question is never asked when those fields are known. Every question has a recommendation with a reason. Single and multi choice questions must list options, and other kinds must not.
- **Approach registry:** every approach except APP-01 has a fallback with at least one trigger. APP-07 must list the approaches it is composed of. Each approach lists at least 3 positive and 3 negative test briefs. An approach cannot be marked `implemented` or `verified` without build, fallback and budget tests.
- **Selection matrix:** every project type has a row with all eight approaches, and APP-01 is `default` in every row. Promotions out of `experimental` must cite evidence.
- **Approach decision:** exactly one decision per approach, each with a reason. APP-01 is always selected. A selected approach other than APP-01 names its fallback. A selected experimental approach needs B1 or B2. An excluded approach cannot be selected.
- **Design decision:** 3 to 5 directions, each rendered at desktop and mobile. Fonts must be open-licensed (OFL, Apache, MIT), system, or client-licensed. Body text contrast is at least 4.5:1, and large text and UI at least 3:1. `chosen` needs the choice and a B2 record.
- **Rule condition:** a leaf is `{ field, op, value }` on a brief field path; `all`, `any` and `not` combine leaves. The operators are `eq`, `neq`, `in`, `notIn`, `gte`, `lte`, `includes`, `exists` and `missing`.

### Project types and tiers (proposed, please confirm)

The plan asks for seven project types but does not name them. The proposal is `business`, `launch`, `showroom`, `portfolio`, `event`, `nonprofit` and `flagship`, chosen to cover the approach rules in the plan (brand story and launch for APP-02, showroom for APP-03, enterprise flagship for APP-07). Each has one sample brief in `samples/briefs/`.

Tiers are `S`, `M` and `L`. S is up to 5 pages with no custom interaction, M is up to 12 pages or one advanced approach, and L is larger or combines several advanced approaches.

### Data formats

The plan names `registry/approaches/*.yaml`, `registry/questions/*.yaml` and `selection-matrix.yaml`. The schemas validate the parsed object, so the files can be YAML or JSON. Fixtures are JSON for now so that M1 needs no new dependency. Adding a YAML parser is a decision for T14 and T16.

## Function signatures to agree at M1

| Function | Provided by | Signature (draft) | Working by |
| --- | --- | --- | --- |
| `runTask` | Suhani | `runTask(project: string, taskId: string) => Promise<TaskResult>` | M2 |
| `ledger.append` | Suhani | `append(project: string, entry: Omit<LedgerEntry, 'seq' \| 'ts'>) => LedgerEntry` | M2 |
| `getPlugin` | Suhani | `getPlugin(id: string) => Promise<Plugin>`; throws `ConfigMissing` or `PermissionDenied` | M2 |
| `selectQuestions` | Nidhi | `selectQuestions(brief: Partial<Brief>, facts: Facts, bank: QuestionBank, opts?: { round?: 1 \| 2 \| 3, max?: number }) => Question[]` | M2 |
| `recordAnswer` | Nidhi | `recordAnswer(facts: Facts, question: Question, answer: unknown \| 'use-recommendation') => Facts` | M2 |
| `validateBrief` | Nidhi | `validateBrief(brief: Brief, facts: Facts) => { valid: boolean, errors: string[], missing: string[] }` | M2 |
| `selectApproaches` | Nidhi | `selectApproaches(brief: Brief, registry: ApproachEntry[], matrix: SelectionMatrix) => ApproachDecision` | M2 |
| `proposeDirections` | Nidhi | `proposeDirections(brief: Brief, decision: ApproachDecision, opts?: { count?: number }) => Promise<DesignDecision>` | M3 |
| `runGate` | Nidhi | `runGate(name: GateName, siteDir: string, opts?: { project?: string, thresholds?: object }) => Promise<GateResult>` | M3 |
| `loadRegistry` | Nidhi | `loadRegistry(root?: string) => { questions: QuestionBank, approaches: ApproachEntry[], matrix: SelectionMatrix }`; throws `ConfigMissing` or `SchemaInvalid` | M2 |
| `draftBrief` | Nidhi | `draftBrief(facts: Facts, opts: { project: string, base?: Partial<Brief> }) => Brief` | M2 |
| `estimateScope` | Nidhi | `estimateScope(brief: Brief, decision?: ApproachDecision) => Estimate` | M2 |
| `runIntake` | Nidhi | `runIntake(project: string, opts: { worker: Worker, ask: (questions: Question[]) => Promise<Answer[]>, maxRounds?: number }) => Promise<IntakeResult>` | M2 |
| `checkDesignRules` | Nidhi | `checkDesignRules(decision: DesignDecision, brief: Brief) => Finding[]` | M3 |
| `scaffoldSite` | Nidhi | `scaffoldSite(siteDir: string, input: { brief: Brief, decision: ApproachDecision, tokens: object, pages: PageContent[] }) => Promise<void>` | M3 |
| `buildSite` | Nidhi | `buildSite(siteDir: string, opts?: { signal?: AbortSignal }) => Promise<{ ok: boolean, outDir: string, log: string }>` | M3 |
| `ApproachModule` | Nidhi (contract), both (modules) | `{ id: ApproachId, apply(siteDir, ctx: ModuleContext) => Promise<{ files: string[] }>, fallback(siteDir, ctx, trigger: FallbackTrigger) => Promise<{ files: string[] }> }` | M3 |
| `runGates` | Nidhi | `runGates(siteDir: string, opts: { project: string, gates?: GateName[], signal?: AbortSignal }) => Promise<GateResult[]>` | M3 |
| `qualityFloor` | Nidhi | `qualityFloor(results: GateResult[]) => { met: boolean, failing: GateName[] }` | M3 |
| `qaReview` | Nidhi | `qaReview(project: string, opts?: { gates?: GateName[], worker?: Worker }) => Promise<DefectReport>` | M3 |
| `verifyFix` | Nidhi | `verifyFix(project: string, defectId: string) => Promise<{ status: 'fixed' \| 'open', evidence: string[] }>` | M3 |
| test-tool adapters | Nidhi (plugins on Suhani's host) | `playwright`, `axe-core` and `lighthouse` plugins: `run(siteDir: string, opts: { routes: string[], widths?: number[], signal?: AbortSignal }) => Promise<RawToolReport>` | M3 |

The types are the schemas: `Brief`, `Facts`, `QuestionBank`, `ApproachEntry`, `SelectionMatrix`, `ApproachDecision`, `DesignDecision` and `GateResult` are the parsed objects those schemas validate. `Question` is one item of `QuestionBank.questions`, `Finding` is one item of `GateResult.findings`, `GateName` is the `gate` enum in `gate-result.schema.json`, and `FallbackTrigger` is the enum in `common.schema.json`. `Worker` is the adapter the runner already takes (`worker({ task, project, projectDir, attempt, idempotencyKey, signal, heartbeat })`), so intake and directions call the model through the same seam as builders. `Estimate`, `IntakeResult` and `DefectReport` are drafted below and get schemas when their task starts.

### What each project-side function promises

- **`selectQuestions`** is pure: it reads, and never writes, files. It drops every question whose `fills` fields are all `known` or `inferred` in the facts, and every question whose `appliesTo` or `askWhen` does not match. It returns the rest sorted by score (the weight, plus a boost when a required brief field is still unknown). Round 1 returns 5 to 10 questions; if fewer than 5 are candidates it returns them all. It throws `SchemaInvalid` if the bank is invalid.
- **`recordAnswer`** returns new facts. A real answer becomes a `known` fact with source `answer`. `'use-recommendation'` becomes an `inferred` fact with source `recommendation`, `assumption: true` and the question's recommendation reason. Follow-up questions are found by calling `selectQuestions` again.
- **`validateBrief`** runs the brief schema, then the checks a schema cannot make across files. Every required brief field has a `known` or `inferred` fact. Every inferred field is listed in `brief.assumptions`. `missing` lists the fields that still need an answer. The P1 exit gate is `valid && missing.length === 0`.
- **`selectApproaches`** is pure and deterministic, which the decision tests rely on. An approach is selected when its matrix status is not `excluded`, `selectWhen` holds, `rejectWhen` does not, and its required plugins are listed in `brief.integrations`. Experimental selections are marked `needsApproval: 'B2'`, or `'B1'` for APP-06 because the plan confirms play at B1. The output always validates against `approachDecision`.
- **`proposeDirections`** may call the model through Suhani's worker adapter. It applies the design rules (T17) and returns at least 3 directions that pass the schema.
- **`runGate`** never throws for a site problem: a failing site returns `status: 'fail'` with findings. A missing tool or plugin returns `status: 'error'` with the typed error code, which is never counted as a pass.
- **`loadRegistry`** reads `registry/questions/`, `registry/approaches/` and `selection-matrix.*` (JSON now, YAML if T14 or T16 adds a parser) and validates each file. It is the only function that reads the registry from disk; the selectors take its output, so tests can pass fixtures in directly.
- **`draftBrief`** is pure. It copies every `known` or `inferred` fact into the brief, lists every inferred field in `brief.assumptions`, and returns a `draft` brief. It never sets `approved`; only the operator does that at B1 through `approve`.
- **`estimateScope`** is pure and deterministic. It returns `{ tier, pages, approaches, hours: { min, max }, cost: { min, max, currency }, assumptions: string[] }`. Without a decision it estimates from the brief alone and says so in `assumptions`. The rates come from config, never from the model.
- **`runIntake`** is the Project Manager loop for P1. Each round it calls `selectQuestions`, hands the questions to `ask` (the CLI prompt, or a fixture in tests), and folds the answers in with `recordAnswer`. It then writes `intake/brief.json`, `intake/facts.json`, `intake/plan.md` and `intake/estimate.json`, appends ledger entries, and returns `{ status: 'ready' | 'needs-answers', brief, facts, estimate }`. It stops before B1 and never records an approval. The default is 3 rounds.
- **`checkDesignRules`** is the T17 rule set that `proposeDirections` runs and the P4 and P5 exit gates call: open-licensed fonts, contrast floors, at least 3 directions, and distinctness between them (no two directions share both the font pair and the palette family). It returns findings and never throws for a rule failure.
- **`scaffoldSite`** copies the starter template into `site/` and writes the content and tokens to the places the starter template contract names (below). It is idempotent: running it again on the same input leaves the same files. It does not run approach modules; the Lead Developer's tasks do.
- **`buildSite`** runs the site's own build and returns its log. A build failure returns `ok: false`, so the runner's verify step and the routes gate can both use it.
- **`ApproachModule`** is the contract every module in `src/approaches/<app-id>/` exports, whether Nidhi (APP-01, 02, 04, 06) or Suhani (APP-03, 05, 07, 08) writes it. `apply` only writes inside `site/src/sections/<app-id>/` and the files its task contract owns. `fallback` produces the version named in the registry entry's `fallback` for the given trigger. `ModuleContext` is `{ brief, decision, entry: ApproachEntry, tokens, getPlugin }`. The build, fallback and budget tests in T12, T19 and T20 call these two functions.
- **`runGates`** runs the named gates (all of them by default) through `runGate`, writes each result to `evidence/gates/<gate>.json`, and returns them in a fixed order. It never stops early, so one report shows every failure.
- **`qualityFloor`** is the P11 exit check. `met` is true only when every required gate is `pass`; `error` and `skipped` count as failing.
- **`qaReview`** is the QA Verifier's P11 pass. It runs the gates and the review lenses and writes `reports/defects.json`: one defect per finding, each `{ id, gate, severity, message, evidence: string[], status: 'open' }`. A finding without evidence is discarded, not reported. It never edits `site/`.
- **`verifyFix`** re-runs the gate behind a defect on the current site and attaches fresh evidence. It returns `fixed` only when that gate now passes for the defect's location; otherwise the defect stays `open`. The builder's own report is never enough. The runner owns the 3-loop repair limit and escalation.
- **Test-tool adapters** are plugins loaded through `getPlugin`, disabled by default like any plugin. Each returns the tool's raw report; turning it into a `GateResult` is the gate's job, so the gate logic can be tested without a browser. A missing tool surfaces as `Unavailable` from the adapter and as `status: 'error'` from the gate.


## Shared error format

Every component throws one of the typed errors in `src/core/errors.mjs`: `ConfigMissing`, `ConfigInvalid`, `AuthFailed`, `RateLimited`, `Unavailable`, `PermissionDenied`, `SchemaInvalid` or `NotImplemented`. Each has a `code`, a `message`, an optional `hint` for the operator, and optional `details`.

## Open questions for the freeze

1. Should gate results carry the project's harness, registry and schema versions, or should the ledger hold them?
2. Should the task `budget.minutes` limit be enforced per attempt or across all attempts?
3. Which folder structure for `workspace/<project>/` do both sides agree on? The project side proposes:

   ```text
   workspace/<project>/
     project.json         harness, registry and schema versions (answers question 1: the project, not each gate result)
     ledger.jsonl         runtime
     board/               runtime: task contracts and status
     intake/              brief.json, facts.json, plan.md, estimate.json
     research/            research and source register
     design/              approach-decision.json, directions.json, tokens.json, renders/
     ux/  content/        sitemap, wireframe spec, locked content (after B3)
     assets/              assets and licence register
     site/                the generated site (starter template copied here)
     evidence/            gate results and screenshots
     reports/             status and final report
   ```

4. Starter template contract (frozen at M1, working at M3): the project side proposes that design tokens live in `site/src/styles/tokens.json`, page content in `site/src/content/pages/*.md` keyed by page slug, and approach sections in `site/src/sections/<approach>/`, written by the `ApproachModule` functions above. `npm run build` in `site/` writes to `site/dist/`, which every gate reads. To be confirmed with Suhani before T12 starts.
5. Should `estimate.json` (the client scope and cost estimate at B1) get its own schema at M1, or wait for T15? The shape is drafted under `estimateScope` above.
6. Should the QA Verifier be the runner's `verifier` for every task, or only run at P11 and P12 while tasks keep the shell `verify` command? The project side proposes the second: tasks keep their shell command, and `qaReview` and `verifyFix` run at P11 and P12.

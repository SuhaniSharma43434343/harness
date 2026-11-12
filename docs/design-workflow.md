# The design workflow

Forge writes a complete design specification before any site code exists, builds from it, and checks the result against it. The audit behind this is in `docs/audits/2026-11-02-design-generation.md`, and the approaches are in `docs/approach-methodologies.md`.

```sh
forge design status <project>                      # what the specification has and lacks
forge design run <project> [--model m] [--max-usd n]   # every phase up to visual QA
forge design qa <project> [--model m]              # render, review, repair, up to 3 loops
forge design choose <project> <direction id>       # the operator's B2
forge design release <project>                     # every gate: passed, failed, blocked, not applicable
forge design accept-licence <project> <package> --note <decision>   # the operator's licence decision, recorded in the ledger
forge design retry <project> <stage or build task> --note <decision>   # the operator's answer to an escalation, recorded in the ledger
```

`forge design run` moves on by itself. It stops only for an operator approval (B1, B2, B3), the facts confirmation after research (workflow 2), a missing client file, a stage that has failed too often, or the spend limit.

## Stages

| Phase | Output | Agent | What its check refuses |
| --- | --- | --- | --- |
| P2 Research | `research/positioning.json`, `research/crux.json` | Research & Strategy (with web tools) | Fewer than 3 references or 2 competitors, unless it says why; stock-phrase positioning; a content bucket with neither facts nor a stated gap; a fact whose source is not in `research/sources.json`. Under workflow 2 also: no onliness statement (or gap), nothing on what the product is or is not, an audience with no persona, a competitor with nothing to learn or avoid, a Big 5 buyer-question category with no question |
| P3 Approach | `design/direction.json`, `direction.md` | Design Manager | An approach the brief did not select; any of the 8 not analysed; a combination the methodology forbids; a philosophy copied word for word. Under workflow 2 also: no `identity` (logo, navigation, buttons, signature), or one given in less than a sentence |
| P4 Directions | `design/directions.json` | `forge directions`, operator at B2 | The existing design rules |
| P5 Design system | `design/design-system.json` | Creative Director | Fonts or colours that differ from B2; fewer than 5 type levels; no separate mobile rules. Under workflow 2 also: no `components` (navigation, buttons with hover, active and focus states), default button shapes, a purple-violet gradient, glass with soft shadows and rounded corners as the whole language |
| P5 Sections | `design/section-plan.json` | Creative Director | Vague compositions; patterns outside the approach; 3 neighbours alike; over a quarter cards; mobile the same as desktop; unknown asset or motion ids; a section with no funnel stage, a journey out of order, a page that does not end on an action. Under workflow 2 also: a page with no `flow`, a section with no `hierarchyStep`, `contentBucket` or `media`, a primary page missing a step or out of order, a section on an empty crux bucket that does not plan around the gap, orbs, blobs or random 3D, a media tag with no matching asset |
| P5 Motion | `design/motion-plan.json` | Creative Director | No hover; no pin where the approach requires one, a pin where it forbids one; a motion with no purpose or no section |
| P5 Assets | `design/asset-plan.json` | Creative Director | Unused assets; licensed files with no licence or path. Under workflow 2 also: a 3D asset the media step did not choose |
| P6 Copy | `content/copy.json` | Content & UX | Sections with no copy; label headlines; repeated headlines; stock phrases; thin pages. Passing writes the locked `content/pages/`. Under workflow 2 also: a step 6 deep FAQ with fewer than five questions, an answer under 25 words, or no call to action |
| P7 Assets | `assets/register.json` | Asset Rights, alongside the copy in P6 (it needs only the asset plan), so P7 has nothing left to wait for after B3 | Uncleared licences; planned files that are not on hand |
| P8 Review | `design/review.json` | Design Manager | Its own judgement of the whole specification |
| P9 Build | `site/` | Builder | See below |

Each stage's rules live in `src/design/spec.mjs`, and its contract, which is the agent's brief, in `src/core/planner.mjs`.

**The content buckets.** Research sorts every fact about the client into five buckets in `research/crux.json`: About (story, team, mission, values, promise, with what nobody else can claim first), What We Do, Our Work (case studies, proof, metrics), Resource Hub (tools, FAQs, guides) and Reach Us (calls to action and contact points). Each fact names a source from `research/sources.json` or says `assumption`. An empty bucket lists its gap as a question for the client, so the plan and copy stages work around it instead of inventing proof.

**The Truth Doc (workflow 2).** Research also writes what every later stage is held to. In `research/positioning.json`:
- the onliness statement: the one thing only this business can claim, with its source, or a gap saying what to ask;
- the boundaries: what the product or service is, and what it is not;
- one persona per brief audience: wants, needs and the one desired action;
- for each competitor, what to learn and what to avoid, with what the site looks like where a browser was available. Screenshots stay local in `research/screenshots/`.

In `research/crux.json`, against `schemas/crux.schema.json`, it lists the questions buyers ask before they buy: at least one for each They Ask, You Answer Big 5 category (pricing, problems, comparisons, reviews, best of), plus edge cases. Each question has the source that answers it, or a gap for the client.

Once research passes, the harness writes `research/truth-doc.md` and the workflow stops. The operator reads it and confirms the facts are real with `forge facts <project> confirm --note "<what you checked>"`. That records a ledger note naming the document's hash, so a fact changed afterwards needs a new confirmation. A wrong or invented fact goes back with `forge design retry <project> research --note "<what is wrong>"`. B1 still approves the brief and the estimate at the end of intake, before research spends anything.

**Visual style first (workflow 2).** The identity is decided before any copy is written. The direction (P3) states it in `identity`, so the operator's B2 choice covers it:
- how the logo or mark is integrated;
- the navigation bar's own style;
- the buttons and their states;
- the one signature move.

The design system (P5) builds it as `components`. The checks refuse the looks that make a site seem machine-made: purple-violet gradients, glass and soft shadows as the whole language, default buttons, and a navigation bar no one designed.

**The six-step page hierarchy (workflow 2).** Every page has a `flow`: primary, supporting or utility. A primary page runs six steps in order:
1. what the product is and is not;
2. what the visitor wants and needs;
3. the risk or cost of not acting;
4. the advantages;
5. why it is better than others;
6. deep decision FAQs that lead into the call to action.

A supporting page never steps back. Every section also names:
- its `contentBucket` from `research/crux.json`. An empty bucket means the section plans around the gap rather than inventing content.
- its `media`: photo, video, custom-authored, x-factor-tool or none. It needs a matching asset, and orbs, blobs and random 3D are refused.

The step 6 copy answers at least five real buyer questions, each in 25 words or more, then gives the call to action. The AIDA funnel stage stays alongside.

**Workflow versions.** When the planner plans research, it writes `design/reference/workflow.json` (`{ "version": 2 }`). Rules added for workflow 2 apply only to projects that have it. A project planned earlier keeps the rules it was built with, because `readiness()` re-runs every check before the build, and a new rule must not fail work that was already approved.

**The visitor journey.** Every section in the plan has a funnel stage: awareness (the hook), interest (how it works, the benefits), desire (proof) or action (a low-friction call to action), or `none` for utility sections such as legal text. The home page opens with awareness, every page with a journey ends on an action, and a stage steps back only after a call to action, so a mid-page call to action can start the next loop.

## The gate before development

`planPhase` refuses to plan the build, and `forge advance` refuses to leave P8, unless all of this holds: direction, design system, section plan, motion plan, asset plan, copy and asset files pass their checks, and the Design Manager's review says `ready`.

## Going back

When a stage fails after its task ran, or the review asks for changes, the Design Manager (`src/design/manager.mjs`):

1. moves the project back to that stage's phase;
2. adds a fix task whose acceptance lists the findings;
3. removes the old review, so the specification is reviewed again;
4. voids only the approval whose subject changes: B2 for the direction, B3 for the copy.

Each stage may be sent back twice. The third time it escalates to the operator.

An escalation is the operator's to answer. `forge design retry <project> <stage> --note <decision>` records the decision, stops the stage's blocked tasks counting, and gives the stage a fresh fix task and a fresh limit of returns. Reaching the spending limit stops the workflow without using up any returns.

A build task that has used its two retries stops the workflow too. `forge design retry <project> build-page-<page> --note <decision>` (or `build-foundation`) gives it one more fix task, past the limit. The task gets the operator's note and the integration findings for that page, and a blocked attempt stops counting. The project goes back to the build if it was in integration tests. The ledger records the decision as the operator's.

## One approach

`design/direction.json` names one `primaryApproach`. The rule table in `registry/` only says which approaches a brief allows; it no longer puts several on a site. A combination needs a reason, must be listed in the methodology's `compatibleWith`, and is shown at B2. `forge site` applies only the direction's approaches. The render check fails an approach's forbidden signal (for example pinning in APP-01), a missing required one, or a section from an approach the direction does not include.

## The build

The Builder gets a shared foundation first, then one task per page. The page tasks run in parallel, up to `concurrency` in `forge.config.json` at a time (3 by default). Running more at once finishes sooner but costs more: on HEARWELL, building per page took 25% less time and 80% more money than one build task, because each page task reads the specification again.

- **`build-foundation`:** the design system as CSS, the header and footer from the site copy, the motion runtime, and `site/public/` and `site/package.json` for every page.
- **`build-page-<page>`** (`build-page-home` for `/`): one bespoke component per section planned for that page, at `site/src/sections/<approach>/<PascalCaseId>.astro`. Each task owns only its own page's section files and may not touch the shared folders, so no two tasks change the same file.

Before the page tasks start, the harness writes a placeholder (marked `data-forge-stub`) for every planned section that has no component yet. That way the whole site builds while other pages are still being built. Each page task checks its work with `forge check site-build --page <slug>`. That builds the whole site but renders and judges only that page. The builds hold a lock (`locks/site-build`), because every page shares `site/` and `site/dist/`. A lock older than 15 minutes was left by a crash and is taken over. The full check (without `--page`) and the BUILD exit both refuse any placeholder that is left.

When an integration gate fails, each finding goes back only to the task that can fix it, at its latest attempt, with only its own findings. A finding that names a page goes to that page's task. A finding that names no page is about what the pages share, so it goes to `build-foundation`. A gate that could not run, with no findings, sends nothing back: a builder cannot fix that, so the workflow stops for the operator. Projects planned before this change keep their single `build-sections` task.

On a site with forms, every page task is told how to build one. The section plan decides which page a form goes on; the page in `site/src/site.json` is only the starter's first guess, and on HEARWELL the two differed. The form keeps its `data-forge-form` id, fields and status element. Its address is the one in `site/src/site.json`, or the form plugin's endpoint (`/api/form?form=<id>`) when the brief has no destination yet. The plugin installs that endpoint at deploy, and the forms gate tests the form against a stand-in for it. A builder never invents an address, posts to the page's own URL, or shows success without sending.

Sections mark their planned assets with `data-asset` and motion with `data-motion`. The page wraps each one in `data-section`. Workers have no shell, so the verify command builds and renders the site, and a failed attempt's output goes into the next attempt's prompt.

## Visual QA

Two gates join the quality floor:

- **`design-fidelity`** (`src/gates/design-fidelity.mjs`): renders every page at 1440 and 390 and fails on missing sections, headlines or assets, broken images, placeholder art, wrong fonts, overflow, motion that does not respond when scrolled or hovered, text hidden under reduced motion, three alike layouts in a row, too many card grids, too few visuals, or the wrong approach. It saves a screenshot per section to `evidence/visual/`.
- **`visual-review`** (`src/qa/visual.mjs`): the QA Verifier opens those screenshots and compares them with the specification, writing `reports/visual-review.json` with scores and findings. The gate fails with no review, a review of an older build (it records a hash of the build), a score under 3.5, or a serious finding.

Findings become defects in `reports/defects.json`, then one builder repair task with the screenshots. The loop re-renders and re-reviews up to 3 times, then escalates through the existing repair loop.

`forge demo` runs in mock mode and has no model, so it skips the design evidence. It shows the runtime, not the design output.

## Release checks

`forge design release` runs all 14 gates on the finished site and writes `reports/release-checks.json`. Only a gate's own pass is "passed". "Blocked" means the fix needs the operator: a site URL for SEO, or a licence decision on a package. It still stops a release. Any other fault in those gates is "failed".

## Spending limit

`scripts/design-e2e.mjs` uses the hard limit described here. `forge design run --max-usd` does not: it is checked only between tasks, so a run can go over it, and `forge design qa` takes no limit.

`createBudget` and `limitedWorker` (`src/core/spend.mjs`) hold a limit in a file, so it survives restarts and can be shared between sites. No model call starts without money left, and each call is capped with `claude --max-budget-usd`. When tasks run in parallel, each running call holds its share: the money no other running call holds, split across the free task slots, and at least the smallest useful call ($0.25) when that much is free. So calls running together can never spend past the limit. Failed attempts count too. The workflow and the QA loop stop with `reason: budget` or `outcome: budget`.

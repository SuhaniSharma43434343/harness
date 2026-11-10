# The design workflow

Forge writes a complete design specification before any site code exists, builds from it, and checks the result against it. The audit behind this is in `docs/audits/2026-11-02-design-generation.md`, and the approaches are in `docs/approach-methodologies.md`.

```sh
forge design status <project>                      # what the specification has and lacks
forge design run <project> [--model m] [--max-usd n]   # every phase up to visual QA
forge design qa <project> [--model m]              # render, review, repair, up to 3 loops
forge design choose <project> <direction id>       # the operator's B2
forge design release <project>                     # every gate: passed, failed, blocked, not applicable
forge design accept-licence <project> <package> --note <decision>   # the operator's licence decision, recorded in the ledger
forge design retry <project> <stage> --note <decision>   # the operator's answer to an escalation, recorded in the ledger
```

`forge design run` moves on by itself. It stops only for an operator approval (B1, B2, B3), a missing client file, a stage that has failed too often, or the spend limit.

## Stages

| Phase | Output | Agent | What its check refuses |
| --- | --- | --- | --- |
| P2 Research | `research/positioning.json`, `research/crux.json` | Research & Strategy (with web tools) | Fewer than 3 references or 2 competitors, unless it says why; stock-phrase positioning; a content bucket with neither facts nor a stated gap; a fact whose source is not in `research/sources.json` |
| P3 Approach | `design/direction.json`, `direction.md` | Design Manager | An approach the brief did not select; any of the 8 not analysed; a combination the methodology forbids; a philosophy copied word for word |
| P4 Directions | `design/directions.json` | `forge directions`, operator at B2 | The existing design rules |
| P5 Design system | `design/design-system.json` | Creative Director | Fonts or colours that differ from B2; fewer than 5 type levels; no separate mobile rules |
| P5 Sections | `design/section-plan.json` | Creative Director | Vague compositions; patterns outside the approach; 3 neighbours alike; over a quarter cards; mobile the same as desktop; unknown asset or motion ids; a section with no funnel stage, a journey out of order, a page that does not end on an action |
| P5 Motion | `design/motion-plan.json` | Creative Director | No hover; no pin where the approach requires one, a pin where it forbids one; a motion with no purpose or no section |
| P5 Assets | `design/asset-plan.json` | Creative Director | Unused assets; licensed files with no licence or path |
| P6 Copy | `content/copy.json` | Content & UX | Sections with no copy; label headlines; repeated headlines; stock phrases; thin pages. Passing writes the locked `content/pages/` |
| P7 Assets | `assets/register.json` | Asset Rights | Uncleared licences; planned files that are not on hand |
| P8 Review | `design/review.json` | Design Manager | Its own judgement of the whole specification |
| P9 Build | `site/` | Builder | See below |

Each stage's rules live in `src/design/spec.mjs`, and its contract, which is the agent's brief, in `src/core/planner.mjs`.

**The content buckets.** Research sorts every fact about the client into five buckets in `research/crux.json`: About (story, team, mission, values, promise, with what nobody else can claim first), What We Do, Our Work (case studies, proof, metrics), Resource Hub (tools, FAQs, guides) and Reach Us (calls to action and contact points). Each fact names a source from `research/sources.json` or says `assumption`. An empty bucket lists its gap as a question for the client, so the plan and copy stages work around it instead of inventing proof.

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

## One approach

`design/direction.json` names one `primaryApproach`. The rule table in `registry/` only says which approaches a brief allows; it no longer puts several on a site. A combination needs a reason, must be listed in the methodology's `compatibleWith`, and is shown at B2. `forge site` applies only the direction's approaches. The render check fails an approach's forbidden signal (for example pinning in APP-01), a missing required one, or a section from an approach the direction does not include.

## The build

The Builder gets two tasks:

- **`build-foundation`:** the design system as CSS, the header and footer from the site copy, and the motion runtime.
- **`build-sections`:** one bespoke component per planned section, at `site/src/sections/<approach>/<PascalCaseId>.astro`.

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

`createBudget` and `limitedWorker` (`src/core/spend.mjs`) hold a limit in a file, so it survives restarts and can be shared between sites. No model call starts without money left, and each call is capped at what remains with `claude --max-budget-usd`. Failed attempts count too. The workflow and the QA loop stop with `reason: budget` or `outcome: budget`.

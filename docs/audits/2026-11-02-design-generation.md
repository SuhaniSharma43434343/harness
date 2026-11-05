# Audit: why Forge produces website skeletons

Date: 2026-11-02. Read for this audit: `agents/`, `src/core/` (planner, checks, advance, runner), `src/design/`, `src/site/`, `src/gates/`, `src/qa/`, `src/workers/`, `registry/`, `skills/app01` to `app08`, `starters/astro-base`, the Master Review workbook, and the taste docs in `vbt-impressive-hero-landing-page/docs/09-ANTI-SLOP-AND-TASTE.md`.

## The short answer

The runtime is sound: state, tasks, approvals, licences, gates and repair all work. The failure is that **nothing in the pipeline ever makes a design decision, and nobody is asked to build one.** A site is a fixed template filled with brief text. Every gate then checks that the template works, and it does.

## Where the design gets lost, stage by stage

| Stage | What should happen | What happens now | Evidence |
| --- | --- | --- | --- |
| P2 Research | Business, competitors, references, positioning | A summary and a source list. Workers have no web tools, so competitors cannot be researched | `planner.mjs` research task; `DEFAULT_TOOLS` in `workers/claude-code.mjs` is Read, Write, Edit, Glob, Grep |
| P3 Approach | Interpret one methodology | A rule table ticks approaches on or off. Nobody interprets them | `registry/select.mjs` |
| P4 Directions | Art direction | A palette, a font pair and a layout word from a catalog, chosen by score | `design/propose.mjs` |
| P4 Directions | The chosen layout shapes the site | **The layout chosen at B2 is thrown away.** Only the specimen page reads it | `.layout` is used only in `design/render.mjs` |
| P5 UX and design system | Design system and section plan | **Empty.** No task, no exit check, no output. The project walks straight through | no `UX_DESIGN_SYSTEM` in `PLANS` or `EVIDENCE` |
| P6 Content | Real copy, written to a plan | The agent is told to keep the scaffold's section list and only replace the words | `planner.mjs`: "keep ... the sections list with their use values" |
| P6 Check | Reject thin or generic copy | Passes with a title, a sections key, no "lorem ipsum" and 80 characters | `checks.mjs` content check |
| P8 Technical plan | Build tasks from the design | Nothing plans them | `PLANS` has only RESEARCH, CONTENT, ASSETS_LICENSING |
| P9 Build | A builder implements the design | **The Builder agent is never given a task on a normal run.** The build is `forge site --build`: the starter plus Markdown | the only builder tasks in the code are repair tasks |
| P11 QA | Someone looks at the result | 11 technical gates. The responsive gate saves screenshots and nobody opens them. No gate knows what the site was meant to look like | `gates/index.mjs` |

## Root causes

1. **No design specification exists.** There is no file between the brief and the code that says what each section is, looks like or does, so nothing downstream can follow it or be checked against it.
2. **The build is a template fill, not a design implementation.** Every site is the same 13 stacked sections inside the same `.wrap`. Changing colours and fonts cannot change composition.
3. **Approaches are defined as techniques, not methodologies.** See the table below.
4. **Approaches get mixed by rule, and I made this worse.** Selection is a set of independent yes or no rules. My PR #34 made APP-02 and APP-05 default at motion 2, so most briefs now get a mix nobody justified. That was the wrong fix: it added effects to a skeleton. It conflicts with your rule against unjustified mixing, so I am correcting it.
5. **Nobody owns design consistency.** The Creative Director stops at tokens, and no role checks that specs are complete or that later work follows them.
6. **QA can only see technical faults.** A template site with perfect Lighthouse scores passes everything.
7. **The content rule was read as "write less".** "No invented facts" is correct, but with no fact-gathering step it produced empty sections. My own Harbor Home scaffold is the example. The fix is richer client facts and a sample label, not looser rules.

## The 8 approaches: what is defined today

Marked against your ten dimensions, from `registry/approaches/`, `skills/app0N/SKILL.md` and the recipes.

| Dimension | APP-01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Philosophy and principles | none | none | none | none | none | one line | none | none |
| Visual identity and art direction | none | none | none | none | none | none | none | none |
| Layout and composition | none | none | none | none | none | none | none | none |
| Typography and colour usage | tokens only | tokens only | tokens only | tokens only | contrast note | tokens only | tokens only | tokens only |
| Content presentation | none | "text comes from locked content" | none | none | none | items list | none | none |
| Image and asset treatment | none | none | poster, model limits | poster | none | none | none | frame limits |
| Animation and interaction | none | **defined** | **defined** | events | **defined** | **defined** | budget | **defined** |
| Scroll and transitions | none | **defined** | partial | none | none | none | partial | **defined** |
| Responsive principles | budget only | fallback only | fallback only | fallback only | fallback only | controls | fallback only | fallback only |
| Use cases | **defined** | **defined** | **defined** | **defined** | **defined** | **defined** | **defined** | **defined** |

The technical side is good and stays: selection rules, fallbacks, budgets, licences and recipes. The design side barely exists. Each approach needs a methodology written alongside its registry entry.

## Nidhi's approach definitions

I found no separate "approach-definition technique" in the repo or project files. What exists from Nidhi and the team:
- the registry schema and entries (T16);
- the skills for APP-02, 04 and 06;
- the Master Review workbook: "What It Means", tools, what worked, what failed.

The methodologies I am writing are built on those, plus what actually worked on the team's real sites (for example APP-02's pinned horizontal strip and door transition). **Parts of them are my interpretation and are marked as such. If Nidhi has a fuller technique document, I need it from her.**

## Exact changes

No new phases and no runtime rewrite. P5 already exists and is empty, so the spec goes there.

| # | Change | Where |
| --- | --- | --- |
| 1 | A complete methodology per approach, in a checked schema | `registry/methodologies/APP-0N.json`, `schemas/methodology.schema.json` |
| 2 | One primary approach per site. Any combination needs a written reason and a recorded approval. Undo the default mixing from #34 | `src/design/spec.mjs`, `registry/approaches/`, `src/site/scaffold.mjs` |
| 3 | Research: positioning and references, with web tools for that agent only | `planner.mjs`, `checks.mjs`, worker |
| 4 | Spec tasks: direction (P3), design system, section plan, motion plan, asset plan (P5), real section copy (P6), each with a strict check | `planner.mjs`, `src/design/spec.mjs`, `schemas/` |
| 5 | New agent: Design Manager. It owns completeness and consistency, runs the review, and sends failed specs back to the right stage on its own | `agents/design-manager.md`, `src/design/manager.mjs`, `forge design` |
| 6 | Mandatory gate: no build until all seven specs pass. A missing spec blocks P5 to P8 and reopens its task | `advance.mjs`, `planner.mjs` |
| 7 | Real build tasks: the Builder implements the spec with bespoke sections, one page at a time | `planner.mjs` |
| 8 | Visual QA: a `design-fidelity` gate that renders desktop and mobile and checks the site against the spec, plus a `visual-review` gate where the QA Verifier reads the screenshots | `src/gates/`, `src/qa/` |
| 9 | Findings go to the Builder through the existing repair loop, limit 3, then escalate | `src/qa/repair.mjs` |

**Frozen interfaces:** adding the agent changes the task schema's agent list, and adding gates changes the required set. Both are additive, but `docs/interfaces.md` says they need Suhani's and Nidhi's approval. I will flag this in the PR.

**Overlap:** Nidhi's open PRs #33 and #36 also touch `repair.mjs` and the CLI, so whichever merges second may need a small merge.

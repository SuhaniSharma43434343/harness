# What changed from the main repo

Branch `forge-go-playbooks-craft-media`, merged with the latest `main` (including the thesis, parallel build and pre-build question merges). Nothing was deleted. Run `npm test` before you commit; the last full run passed (a browser timing test sometimes fails once and passes on rerun).

## 1. New command: `forge go` (one prompt to a built site)

`forge go <project> "<what the website is for>"` takes one sentence, reads the name, business, kind of site and size from it, uses the playbook's recommendation for every other question (recorded as an assumption), and runs intake plus the design workflow. It stops only for B1, the design direction (B2), B3 and licence decisions. It never records an approval itself.

| File | Change |
|---|---|
| `src/cli/go.mjs` (new) | The command, its stop-and-ask loop and the terminal prompts |
| `src/intake/express.mjs` (new) | Reads the prompt; asks only for the name and what the business does if missing |
| `src/design/choose.mjs` (new) | B2 choice, shared with `forge design choose` |
| `src/cli/index.mjs`, `src/cli/design.mjs` | Register `go`; use the shared choose code |
| `src/intake/shape.mjs` | Shapes the new story answers |

## 2. Industry playbooks (business-specific sites)

Five playbooks say what each kind of business needs: the main action, the hero must-haves, a full page set by size (5, 11 or 15 pages), and deep questions. Intake detects the industry from the owner's words.

| File | Change |
|---|---|
| `registry/industries/*.json` (5 new) | real-estate, restaurant-cafe, healthcare-clinic, professional-services, general-business |
| `src/registry/industries.mjs` (new), `src/registry/load.mjs` | Load, detect and compile the playbooks into questions |
| `schemas/industry-playbook.schema.json` (new), `src/core/schemas.mjs` | Playbook schema |
| `schemas/brief.schema.json` | New optional `business` and `media` sections (frozen interface: needs a PR approved by both owners) |
| `registry/questions/business.json`, `story.json` (new) | Generic questions moved to round 2; two visitor questions (sources, device); the owner's unique facts, legal lines, domain and deadline use main's `truths`, `contentRules`, `access` and `constraints.deadline` |
| `src/intake/run.mjs`, `plan.mjs`, `src/site/content.mjs` | Put the primary action in the brief, the plan and the home page |
| `src/core/planner.mjs`, `src/design/spec.mjs` | The home hero must carry the primary action; checks fail otherwise |
| `docs/industry-playbooks.md` (new) | How playbooks work |

## 3. Craft guide (Awwwards-level design, not generic)

| File | Change |
|---|---|
| `registry/craft/awwwards.md` (new) | Rules scored as Awwwards scores (Design 40, Usability 30, Creativity 20, Content 10) and the list of generic-looking tells |
| `src/core/planner.mjs`, `src/qa/visual.mjs` | Every design stage and the visual review read it; reviewers score it, under 7 is blocking |
| `src/design/spec.mjs` | New checks: home page 7+ sections (5 on small), inner pages 4+ (legal pages, all funnel "none", exempt), a third of the non-legal sections break the grid, no centred hero, 5+ motions of 3+ kinds with one scroll-linked |

## 4. 3D and video (`src/media/`)

After research and before the approach is chosen, `forge go` judges whether 3D and video suit the business, asks, and handles the result.

| File | Change |
|---|---|
| `src/media/fit.mjs` (new) | Fit check from the playbook rating, tone, main action and device floor |
| `src/media/models.mjs` (new) | Poly Haven (CC0) search, three choices, download packed into one `.glb` (3 MB cap), own `.glb` check |
| `src/media/video.mjs` (new) | ffprobe analysis, placement rules, ffmpeg web versions (MP4, WebM, poster), optional sound on tap, Pexels search with a key |
| `src/media/step.mjs` (new) | The flow; saves `design/media-decision.json` and `brief.media` |
| `src/core/planner.mjs`, `src/design/spec.mjs` | Contracts and checks that place the chosen media; 3D never in the hero; the build adds the Scene3D section as an accent |

Flags: `--3d yes|no|<file.glb>`, `--pick <id>`, `--video <file>`, `--video-role`, `--video-sound`, `--concept`, `--no-media`.

## 5. Fixes

| File | Change |
|---|---|
| `src/workers/claude-code.mjs`, `tests/unit/claude-code.test.mjs` | Start Claude Code on Windows when it is an npm `.cmd` shim |
| `plugins/vercel/index.mjs` | Each file upload is retried on a dropped connection |
| `agents/project-manager.md` and generated `AGENTS.md`, `CLAUDE.md`, `.claude/agents/`, `.cursor/rules/` | Project Manager role mentions `forge go` |
| `CHANGELOG.md` | One entry per change above |

## 6. Merged with main

Conflicts in `planner.mjs`, `intake/plan.mjs` and `design-workflow.test.mjs` were resolved by keeping both sides. Main's `forms.mjs` replaces the earlier local fix. Industry audience questions now follow main's audience-view format (wants, proof, action, from, mood). Intake now runs up to 4 rounds, so the added playbook questions do not crowd out main's pre-build questions.

## 7. Tests

New: `tests/intake/go.test.mjs`, `tests/intake/industry-playbooks.test.mjs`, `tests/unit/media.test.mjs`. Updated: `run-intake.test.mjs`, `design-workflow.test.mjs` (fixtures now meet the length and motion rules).

## 8. Not in the repo's tracked files

`Forge-Harness-Overview.pdf` and `Forge-3D-and-Video-Workflows-Proposal.pdf` sit in the root (untracked). Projects you built live in `workspace/` (chaibistro to chaibistro-9, skyline-1, skyline-2) and are not part of the harness.

## Known gaps

- Home page speed check is borderline (misses 2.5 s by 0.1 to 0.2 s on some runs).
- A blocked task cannot be reopened; use a new project.
- Repair runs as one builder task (not parallel).
- The `.env` webhook for a real order form and the SEO canonical URL still need your real domain.

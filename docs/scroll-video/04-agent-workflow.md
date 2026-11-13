# 4. How it fits the agent workflow

The pipeline, with the existing phase, role and command at each step. Nothing new is approved by an agent: the operator's B2, B3, B4 and B5 still gate the same things.

| # | Step | Phase | Role | What happens | Output |
| --- | --- | --- | --- | --- | --- |
| 1 | Client brief | P1 Intake | Project Manager | The brief asks for a scroll story (`features.interactive` includes `scroll-story`, or a launch/flagship type), which already selects APP-02. `forge go ... --video-role scroll-scrub` marks a supplied clip for scrubbing. | `intake/brief.json`, `design/media-decision.json` |
| 2 | Creative direction | P3, P4 (B2) | Design Manager, Creative Director | APP-02 is the primary approach. The section plan names a scroll-video section and its layout (from the six, by `recommendLayout`). | `design/direction.json`, `design/section-plan.json` |
| 3 | Storyboard | P5 | Creative Director | `forge scroll-video new <project> <id> --beats N --layout L` writes the config skeleton; the Creative Director writes the beats: one continuous take, what changes in each beat, the camera move, the style from the direction. | `design/scroll-video/<id>.json` (`storyboard`) |
| 4 | AI video prompt generation | P5 | Creative Director | `forge scroll-video prompts <project> <id>` turns the storyboard and direction into a master prompt, a negative prompt, timed shot prompts for generators with short maximum lengths, generation settings and an acceptance checklist. | `prompts` block, `design/scroll-video/<id>-prompts.md` |
| 5 | External video generation | outside Forge | Operator | The operator runs the prompts in the generator of their choice and pays for it there (B4 covers paid assets). | a video file |
| 6 | Video upload | P7 Assets | Asset Rights | `forge scroll-video add-video <project> <id> --video <file> --licence "..."` reads the file (duration, size, aspect ratio, codec, keyframes), refuses unusable files, prints compression advice with exact ffmpeg commands, copies the file and a poster into `assets/public/video/` (and `site/public/video/` when the site exists), and records them in `assets/register.json`. Running it again replaces the video and keeps the scenes (`--rescale` stretches them to a new duration). | `video` block, `<id>.report.json`, licence rows |
| 7 | Scene configuration | P5/P6 | Creative Director (timing), Content & UX (words) | Beats become scenes (`scenesFromStoryboard`), retimed against the real clip with `forge scroll-video stills`, which writes one still per scene and a contact sheet so the markers can be checked by eye. Content & UX writes each scene's words; after B3 they live in the locked page as per-scene overrides. | `scenes` |
| 8 | Scroll animation generation | P9 Build | Builder | Nothing is generated per project: the engine reads the config. `forge approach <project> APP-02` installs the section; `forge scroll-video check` must pass. | — |
| 9 | Website integration | P9 Build | Builder | The page task places `- use: "APP-02/ScrollVideo"` with `config: "<id>"` (and the section-plan `id`). A bespoke section may render `<ScrollVideo config="<id>" />` inside its own markup. The engine files are never edited. | `content/pages/*.md` or a section file |
| 10 | QA | P10/P11 | QA Verifier | The interactions gate drives every scroll video forward and back (pinning, seek accuracy, scene order, CTA), checks the static fallback, and reports metrics. Design-fidelity screenshots show the stage. | `evidence/gates/interactions.json` |

## Contracts between the roles

- The config is the contract. Each role writes only its blocks; `forge scroll-video check` names the block and the field of every problem, so the Design Manager can send it back to the stage that owns it.
- Words belong to Content & UX. A page's frontmatter `scenes: [{ id, title, description, cta }]` overrides the config's words by `id`, so locked copy never has to be pasted into a design file after B3. Timing never comes from the page.
- Files belong to Asset Rights. A config may reference only files that `add-video` (or the operator) put in `assets/public/` and the register.

## Agent definitions changed

`agents/creative-director.md`, `agents/content-ux.md`, `agents/asset-rights.md`, `agents/builder.md` and `agents/qa-verifier.md` each gain one responsibility line for the steps above; `forge agents generate` rewrote the Claude Code and Cursor files, and `forge agents check` passes.

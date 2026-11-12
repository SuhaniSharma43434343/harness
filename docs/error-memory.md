# Remember My Error

Every mistake an agent makes becomes a rule that agent reads before its next task, on this project and every later one.

## What is recorded

| Where it happened | Agent | Source |
| --- | --- | --- |
| A task runs out of attempts (`src/core/runner.mjs`). Each finding its verify check printed becomes its own entry. | The task's agent | `task-blocked` |
| A stage is sent back, by a failed check or the Design Manager's review (`sendBack` in `src/design/manager.mjs`). | The stage's agent | `design-returned` |
| A photo or video the media check rejected sends the asset plan back. | Creative Director | `media-rejected` |
| A QA review finds a new defect (`src/qa/review.mjs`). A defect still open in the next review is not counted again. | Builder | `qa-defect` |
| The operator turns an approval down: `forge reject <project> <B1-B7\|FACTS> --note "<reason>"`. | B1 Project Manager, FACTS Research & Strategy, B2 Creative Director, B3 Content & UX, B4 Asset & Rights, B5 to B7 Lead Developer | `gate-rejected` |

Each entry has a timestamp, the project, the agent, the stage, the mistake and the prevention rule. The rule is the finding's own advice (the part after its last "; "), with what went wrong. An operator's rejection uses their reason as the rule.

`forge reject` writes a `refusal` to the ledger, using the frozen ledger schema's own shape: the action (`approve B2`, or `confirm facts`) and the reason.

## Where it is kept

- **The project's full log:** `workspace/<project>/errors/agent-errors.json`, checked against `schemas/error-memory.schema.json`.
- **The rules, once each across projects:**
    - `memory/errors/<agent>.md`, to read;
    - beside it, `memory/errors/<agent>.json`, with how often each rule was hit and where last. The same rule seen again is counted, not repeated.

`memory/errors/` is at the harness root for the harness's own workspace. A workspace set elsewhere in `forge.config.json` keeps its own memory in `<workspace>/.memory/errors`, so two workspaces never share rules.

The memory is not in git (`.gitignore`) and not in the portable package (`forge package` refuses `memory/`), because a rule can quote a client's facts. Secrets are redacted before anything is written.

## How agents read it

Before a task starts, its agent's rules are copied into the project as `errors/rules/<agent>.md` (task inputs must be project-relative). That file is added to the task's inputs, with one acceptance line telling the agent to read it and follow every rule. This happens in three places:
- **When the planner plans a task.** Fix tasks from a send-back are included, so a fix starts with the rule its own mistake just taught.
- **When the runner hands a task to the worker.** This covers tasks added any other way. The board keeps the contract as planned.
- **When step mode hands out a task (`forge task next`).** A rule learned after planning still reaches the agent.

An agent with no rules gets its contract unchanged.

## Curating the rules

```
forge errors                         # every agent's rules
forge errors list builder            # one agent's
forge errors add builder --rule "Never ship a form without its error state"
forge errors clear builder --yes     # forget one agent's rules
forge errors clear --yes             # forget all of them
```

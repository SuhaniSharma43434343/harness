# Question bank and intake rules (T14)

Intake asks only what the client material does not already answer. The questions live in `registry/questions/`, and three pure functions decide what to ask and record the answers. The Project Manager loop that calls them (`runIntake`, T15) is built on top.

## Files

| File | What it holds |
| --- | --- |
| `registry/questions/core.json` | Questions for every project type: type, tier, name, industry, device floor, motion, tone, accessibility, special features and their follow-ups, assets, hosting |
| `registry/questions/<type>.json` | For each of the 7 project types: goals, audience, pages and forms, with recommendations that fit the type |
| `src/intake/questions.mjs` | `selectQuestions`, `recordAnswer`, `intakeView`, `REQUIRED_FIELDS` |
| `src/intake/brief.mjs` | `draftBrief`, `validateBrief` |
| `src/registry/load.mjs` | `loadQuestionBank(root?)` merges the question files; `loadRegistry(root?)` returns `{ questions, approaches, matrix }` |
| `tests/intake/` | Client material for the 7 sample briefs and the A5 intake suite |

## Choosing questions

`selectQuestions(brief, facts, bank, { round, max })` reads the partial brief with every known or inferred fact laid over it, then:

1. Drops a question when every field it `fills` is already known or inferred. This is the "never ask what the material says" rule.
2. Drops it when `appliesTo` does not match. Until the project type is known, only questions for every type apply, so the type question comes first. An unknown tier holds nothing back.
3. Drops it when `askWhen` does not hold (for example, "is play the point?" only when a game was asked for).
4. Holds it for a later round (`round`, default 1), unless a follow-up rule on an answered question asks for it now.
5. Scores the rest: the weight, plus 5 when it fills a required brief field that is still open, plus 2 when a follow-up asked for it. Ties keep bank order, so the result is deterministic.
6. Returns up to `max` (10) by score, never two questions that fill the same field.

For each sample brief's material, round 1 asks 9 questions.

## Recording answers

`recordAnswer(facts, question, answer, { now }?)` returns new facts and never changes its input:

- A real answer is checked against the question kind (an option value, a list of options, a boolean, a number, a `YYYY-MM-DD` date or a URL) and becomes a `known` fact with source `answer`.
- `'use-recommendation'` becomes an `inferred` fact with source `recommendation`, `assumption: true` and the recommendation's reason (A5). A recommendation with `fromField` copies that field's current value, for example the project name as a working client name.
- A text answer can be the client's raw words or a value already in its brief shape. The Project Manager turns raw words into the brief shape when it drafts the brief.
- A question that fills several fields takes an object keyed by field.

## The brief

`draftBrief(facts, { project, base? })` copies every known or inferred fact into a `draft` brief and lists the inferred fields in `assumptions`. `validateBrief(brief, facts)` runs the brief schema, then checks that every inferred field is listed in `assumptions` and nothing else is, and that the facts belong to the same project. `missing` lists the required fields with no known or inferred fact. The P1 exit gate is `valid && missing.length === 0`.

The required fields are `projectType`, `tier`, `client.name`, `client.industry`, `goals`, `audience`, `pages`, `brand.tone`, `brand.motionIntensity`, `constraints.deviceFloor` and `constraints.accessibility`. Forge sets the other required properties (`project`, `schemaVersion`, `status`, `assumptions`) itself.

## Intake tests (A5)

`tests/intake/intake.test.mjs` runs intake for each of the 7 sample briefs. The client material is a set of known facts taken from the sample (`tests/intake/<type>.material.json`). The test checks that round 1 asks 5 to 10 questions, that no question asks for a field the material already gives, and that no question is asked twice. It then answers every question with "use your recommendation" for up to 3 rounds, and checks that every recommendation used is an inferred fact with `assumption: true` and a reason. The material facts must be unchanged, and the drafted brief must pass `validateBrief` with nothing missing.

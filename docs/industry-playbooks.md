# Industry playbooks

A playbook says what one kind of business needs from its website. Without one, every business gets the same four generic pages, the same "Request a quote" button and the same questions. With one, intake asks what that industry cares about, recommends a full page set for the tier, and builds the whole site around the single action that earns the business money.

## What intake does with them

1. Round 1 asks the basics, including the owner's own description of the business (`client.industry`).
2. `deriveIndustry` matches that description to a playbook by keyword (whole words, longest keyword wins) and records `business.industryId` as an inferred fact, so it is listed in `brief.assumptions`. A business project with no match gets the `general-business` playbook. A non-business project with no match gets none and behaves as before.
3. Rounds 2 and 3 ask the playbook's questions in place of the generic business ones: goals, audience, the **primary action**, the secondary actions, the proof the client can show, the pages for the chosen tier, the forms, and 6 to 9 questions that only that industry asks. A typical run asks about 29 questions.
4. The brief gets a `business` section: the primary conversion, the secondary conversions, what the home hero must show, the sections each page needs, the material the client should supply, the industry's rules for the copy, and the owner's answers under `details`. The home page's call to action is the primary action.
5. `intake/plan.md` shows all of this to the operator at B1.

## How the design stages use it

- **Research** studies how the best sites in the industry lead a visitor to the primary action.
- **Section plan** must put the primary action, and every hero secondary action, in the home hero, and must include the sections the industry needs. `CHECKS['section-plan']` fails a plan whose first two home sections never name them.
- **Copy** must use the action labels exactly, write around anything the owner did not provide (those answers read `(not provided by the client)`), and follow the industry's rules. `CHECKS.copy` fails a home hero that does not offer the primary action.
- **Design review** treats a hero that buries the primary action as a blocking finding.

## Page counts

Each page in a playbook has a `level` (S, M or L), the smallest tier that includes it. Tier S gets 5 pages, tier M gets 10 to 11 and tier L gets 13 to 15. Every page has a purpose and a call to action.

## Writing a playbook

Copy the closest file in `registry/industries/`, name it `<id>.json`, and keep the `id` and the file name the same. `schemas/industry-playbook.schema.json` validates it, and `loadIndustries` checks what the schema cannot (the defaults exist, the home page exists, no two pages share a slug, every question's recommendation is one of its options).

- `keywords`: words an owner uses for this business. Keep them specific; "firm" or "service" would match too much.
- `conversions`: the actions a visitor can take. Mark at most four as `hero: true`.
- `questions`: deep questions only. Goals, audience, pages, forms, the primary action and proof are generated for you. Answers land in `brief.business.details.<key>`.
- For a fact only the client can know (hours, prices, names, numbers), recommend `(not provided by the client)`. Never recommend a guess: the copy gate treats every number, time and price as a claim that needs a source.
- `extras` records which media usually suit the business (3D object, video loop, map and so on), for the media workflows to read.

## Tests

`tests/intake/industry-playbooks.test.mjs` checks that every playbook loads and compiles, that detection works, that page counts grow with the tier, that a real estate owner is asked real estate questions and ends with a hero that leads with a site visit, and that the fallback applies. `tests/unit/design-workflow.test.mjs` checks the hero rules in the plan and the copy.

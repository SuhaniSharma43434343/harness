# Approach registry and selection (T16)

The registry says, for each of the eight website approaches, when it qualifies, what it falls back to, what it may cost in performance, and which licences it depends on. `selectApproaches` reads it with the selection matrix and writes the approach decision record at P3.

## Files

| File | What it holds |
| --- | --- |
| `registry/approaches/APP-0N.json` | One entry per approach, validated by `schemas/approach-registry.schema.json` |
| `registry/selection-matrix.json` | Per project type: `default`, `optional`, `experimental` or `excluded` for each approach |
| `tests/decision/app0N/pos-*.json`, `neg-*.json` | 3 qualifying and 3 non-qualifying briefs per approach (48 in all) |
| `src/registry/condition.mjs` | The shared condition evaluator (also used by question rules in T14 and design rules in T17) |
| `src/registry/load.mjs` | `loadApproaches(root?)`: reads and validates the registry and matrix, and checks them against each other |
| `src/registry/select.mjs` | `selectApproaches(brief, registry, matrix, opts?)` |

`forge select <brief.json> [--json]` prints the decision for any brief, with the reason for every approach.

## How an approach is selected

The selector goes through the approaches in order and stops at the first rule that decides:

1. APP-01 is always selected: it is the build method.
2. `excluded` for the brief's project type in the matrix: not selected.
3. `selectWhen` does not hold: not selected.
4. `rejectWhen` holds: not selected, and the reason names the rule that rejected it.
5. A plugin in `requiresPlugins` is missing from `brief.integrations`: not selected.
6. Otherwise selected, with its fallback. If the matrix says `experimental`, the decision carries `needsApproval`: the entry's own B1 or B2 from `requiresApproval`, or B2 by default.

`default` and `optional` do not change the result; they only appear in the reason. Both mean the approach is allowed for that project type, and the brief still has to qualify.

## The rules

| Approach | Selected when | Rejected when | Also needs | Falls back to |
| --- | --- | --- | --- | --- |
| APP-01 Full website | always | never | | (it is the base) |
| APP-02 Cinematic scroll | launch or flagship, or a scroll story is asked for, or the tone includes "premium" | motion intensity 0 or 1 | | Static stacked layout with CSS reveals |
| APP-03 Interactive 3D | a 3D product, 3D scene or data visualisation is asked for | device floor `low` | | Poster image plus CSS depth |
| APP-04 Spline | a Spline scene is asked for | device floor `low` | the `spline` plugin; B2 | APP-03 scene or a poster |
| APP-05 Shader / WebGL | a shader background is asked for | motion intensity 0 | | CSS gradient or a static frame |
| APP-06 Game-like | a game is asked for | play is not confirmed as the point (`features.playIsThePoint` is not `true`) | B1 | Interactive explainer with the same content |
| APP-07 Composite | flagship at tier L | device floor `low`, or motion intensity 0 or 1 | | Drop to APP-01 plus APP-02 |
| APP-08 Frame animation | a frame sequence is asked for | motion intensity 0, or device floor `low` | | A static key frame |

The selector only reads what the brief asks for. It never adds 3D or a game because the project type allows it: intake asks the client, and the answer lands in `features.interactive`.

A low device floor does not reject APP-05 or APP-06. APP-05's quality ladder (full, reduced, off) and APP-06's explainer fallback are designed for low-end devices. It does reject APP-03, APP-04, APP-07 and APP-08, whose poster or key-frame fallback would replace the whole feature for most visitors.

## The matrix

| | APP-01 | APP-02 | APP-03 | APP-04 | APP-05 | APP-06 | APP-07 | APP-08 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| business | default | optional | optional | experimental | optional | excluded | excluded | optional |
| launch | default | default | optional | experimental | optional | experimental | excluded | optional |
| showroom | default | optional | default | experimental | optional | experimental | excluded | optional |
| portfolio | default | optional | optional | experimental | optional | experimental | excluded | optional |
| event | default | optional | optional | experimental | optional | experimental | excluded | optional |
| nonprofit | default | optional | optional | experimental | optional | experimental | excluded | optional |
| flagship | default | default | default | experimental | optional | experimental | optional | optional |

APP-04 and APP-06 start as experimental everywhere they are allowed, as the plan says. APP-07 is a flagship composite, so other types exclude it. APP-06 is excluded for business sites. Moving an approach out of experimental needs a `promotions` entry with evidence from real projects.

## Decision tests

`tests/decision/decision.test.mjs` is the A6 suite. For every approach it checks the 3 positive briefs select it with its fallback, and the 3 negative briefs do not. Each negative case names the rule it exercises (`because`: `matrix`, `selectWhen`, `rejectWhen` or `plugin`), and the test checks the reason matches, so a case cannot pass for the wrong reason. It also pins what each of the 7 sample briefs selects.

APP-01 qualifies for every brief Forge accepts, so its negative cases are briefs Forge refuses: two languages, a page without a call to action, and an e-commerce shop. For those the selector throws `SchemaInvalid` and nothing is selected.

## Status

Every entry is `not-started` except APP-01, which is `in-development` with the starter site (T18). An entry moves to `implemented` only with its build, fallback and budget tests listed in `tests`, which the schema enforces. Licences marked `licenceVerified: true` are taken from the npm metadata on 2026-10-28; GSAP and the Spline runtime have their own terms and stay unverified until someone reads them.

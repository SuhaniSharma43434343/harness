# Design directions and rules (T17)

At P4 the Creative Director offers three to five creative directions, the operator picks one at B2, and the chosen direction becomes the site's design tokens. This page covers how Forge proposes directions, the rules every direction must pass, and how they are rendered.

## Files

| File | What it holds |
| --- | --- |
| `registry/design/fonts.json` | Open-licensed fonts (all on Fontsource), each with a category and tone tags; `body: true` marks faces fit for running text |
| `registry/design/palettes.json` | Palette families, each with five colours, a mode and tone tags. Every one passes the starter's contrast pairs |
| `src/design/propose.mjs` | `proposeDirections(brief, decision?, { count })` |
| `src/design/rules.mjs` | `checkDesignRules(decision, brief, { dir? })` |
| `src/design/render.mjs` | `specimenHtml` and `renderDirections` |
| `src/tools/load.mjs` | `loadTool` and `launchBrowser`: optional test tools, which raise `Unavailable` when they are missing |

`forge directions <project> [--count n]` selects approaches if needed, proposes directions, writes `design/directions.json` and renders them. `forge directions <project> --check` runs the rules on whatever `design/directions.json` holds, including after the Creative Director edits it.

## Proposing directions

`proposeDirections` is deterministic. It turns the brief's tone words (with a few synonyms, such as "friendly" for warm and "luxury" for premium) and the project type into weighted tags. It then ranks the palettes, the font pairs and the six layouts against those tags. Each direction takes the next palette, a display face not used yet and the next layout, so no two directions share a palette, a display face or a layout. The last direction is one motion step calmer than the brief, as a quieter alternative.

- **Client colours.** When the brief has `brand.existingAssets.colours`, the first direction uses them as primary and accent on the best light palette's neutrals. Each colour is darkened only as far as contrast needs.
- **Avoid list.** Anything on `brand.avoid` that names a font, a palette or "dark" is left out.
- **Rule check.** The result is checked against the schema and the rules before it is returned, so a proposal never fails its own gate.

## The rules

`checkDesignRules` returns findings and never throws. `critical` and `serious` findings block P4.

| Rule | Severity |
| --- | --- |
| The design decision schema passes, with 3 to 5 directions | critical |
| A chosen direction is one of the directions | critical |
| Fonts are OFL, Apache or MIT, system, or client-licensed and client-supplied; a catalog font has its catalog licence | critical or serious |
| Contrast, recomputed from the colours: body text, muted text, links and button text at least 4.5:1, primary against the background at least 3:1 | serious |
| Distinctness: no two directions share both the font pair and the palette family | serious |
| Direction ids are unique | serious |
| Nothing on the brief's avoid list is used | serious |
| With the project folder given, the desktop and mobile renders exist | serious |
| Claimed contrast ratios match the real ones within 0.1 | moderate |
| Motion is not above the brief's motion intensity | moderate |

A palette family is the catalog palette a direction uses. For colours outside the catalog, it is the mode plus the primary colour's hue in 30-degree steps.

## Rendering

`renderDirections` writes `design/renders/<id>.html` for every direction. This specimen page uses only the brief's words (client name, home page purpose and CTA, first goal, page titles) and is styled entirely through the same token CSS as the starter. With Playwright and Chromium available, it also saves the desktop (1440 × 900) and mobile (390 × 844) screenshots named in each direction's `renders`. Without a browser it still writes the HTML and reports why there are no PNGs, so the render check fails visibly instead of passing.

Fonts load from the installed Fontsource packages when they are present. Otherwise the specimen uses the fallback stack and says so on the page.

## Tests

- `tests/unit/design.test.mjs`: checks the catalog, then 3 distinct directions that pass every rule for each sample brief. It covers determinism, tone steering, client colours and the avoid list, and checks that each rule catches a seeded mistake.
- `tests/design/render.test.mjs`: renders 3 directions at desktop and mobile for each of the 7 sample briefs and re-runs the rules with the renders present. It is skipped, with the reason, when no browser is available.

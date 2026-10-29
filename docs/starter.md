# Starter template (T18)

`starters/astro-base/` is the site every Forge project starts from. It is APP-01 (AI to Full Website): a static, multi-page [Astro](https://astro.build) site (MIT) built from the brief, the design tokens and the page content. Every other approach adds sections to it; none replaces it.

`forge site <project>` copies the starter into `workspace/<project>/site/` and writes the project's brief, tokens and content into it. `--build` also installs and builds it and checks the JavaScript budget. `forge site <project> --build-only` builds the site that is there without scaffolding again, for example after `forge approach`.

## Template contract

This is decision 4 of the [M1 freeze](interfaces.md#decisions-at-the-freeze), in detail. Paths are relative to `site/`.

| What | Where | Written by | Format |
| --- | --- | --- | --- |
| Design tokens | `src/styles/tokens.json` | `forge site`, from `design/tokens.json` or the chosen direction (Creative Director, B2) | `schemas/tokens.schema.json` |
| Site settings | `src/site.json` | `forge site`, from the brief; the form plugin fills each form's `action` | `schemas/site-config.schema.json` |
| Page content | `src/content/pages/<slug>.md` (`index.md` is `/`) | `forge site` scaffold, replaced by locked content from `content/pages/` (Content & UX, B3) | Markdown with the frontmatter below |
| Sections | `src/sections/<approach>/<Name>.astro` | Builders; APP-01 ships Hero, Prose, Features, CtaBand and Form | Astro component |
| Font imports | `src/styles/fonts.css` | `forge site`, one `@import` per Fontsource weight | CSS |

Builders do not edit `tokens.json` after B2 or page content after B3 without a new approval (plan, agent table).

### Page frontmatter

```yaml
---
title: "Services"                 # <title> and the default hero heading
description: "..."                # meta description
order: 1                          # sort order (optional)
status: "scaffold"                # scaffold | draft | locked
cta: { label: "Request a quote", href: "/contact#quote" }   # every page has one (P5 gate)
sections:                         # rendered in order
  - use: "APP-01/Hero"            # -> src/sections/APP-01/Hero.astro
    lead: "..."                   # every other key is passed to the component as a prop
  - use: "APP-01/Prose"           # renders the Markdown body
  - use: "APP-01/CtaBand"
---
```

The scaffold only uses text already in the brief, so it never invents a claim, and marks each page `status: scaffold` until Content & UX locks it. Each scaffold page carries an HTML comment with its purpose and the sections the brief asked for.

### Adding an approach's sections (APP-02 to APP-08)

1. Put the component in `src/sections/APP-0N/<Name>.astro`. Name starts with a capital letter.
2. Reference it from a page: `- use: "APP-0N/<Name>"`. A page that names a section that does not exist fails the build with the missing path, so a typo is never a blank section.
3. Every section receives its frontmatter keys as props, plus `page` (the content entry), `Content` (the rendered body) and `index` (its position).
4. Style it with the token custom properties (`--color-*`, `--font-display`, `--font-body`, `--step-n2` to `--step-5`, `--space`, `--radius`, `--motion-duration`, `--motion-distance`), so a token change restyles it. `--motion-*` drop to zero under `prefers-reduced-motion`.
5. Keep JavaScript inside the section. Astro bundles a component's `<script>` only on pages that use it, so the APP-01 pages stay within budget. Heavy libraries (Three.js, GSAP) belong in a dynamic `import()` behind the approach's fallback.
6. Add the approach to `approaches` in `src/site.json`.

### Tokens

`tokens.json` has colour (`bg`, `fg`, `primary`, `accent`, `muted`, `surface`, `border`, `onPrimary`, `onAccent`, `link`, plus any extras), the display and body fonts with their CSS stacks, the type scale (`base` in rem, `scaleRatio`, `lineHeight`, `measure`), `space`, `radius` and `motion.intensity` (0 to 3, from the brief). `src/lib/tokens.mjs` turns it into custom properties in the base layout.

`tokensFromDirection(direction)` in `src/site/tokens.mjs` builds tokens from a design direction. It derives the colours a direction does not name and refuses tokens whose rendered pairs fail WCAG contrast: body text, muted text, links and button text need 4.5:1, and `primary` against the background needs 3:1 (focus ring).

### Forms

Each brief form is placed on the page whose slug or purpose matches it (contact, book, register, volunteer and similar), or on the home page. Every page's call to action points at the first form. Fields get input types and autocomplete from their names, and `name` and `email` are required. Until the form plugin sets `action`, a submission validates, then says the form is not connected yet, so a missing endpoint shows up in QA.

## Budgets

APP-01 targets mobile LCP at most 2.5 s and base JavaScript at most 150 KB gzip. The starter ships no framework runtime; a sample site's JavaScript is the form script, under 1 KB gzip. `siteReport(dist)` in `src/site/build.mjs` reports routes and JavaScript size, and `forge site --build` fails over budget. Lighthouse, axe and the other gates arrive with T21 and T22.

## Tests

- `tests/unit/site-tokens.test.mjs` and `tests/unit/site-content.test.mjs`: token derivation and contrast, the CSS output, the brief-to-pages plan for every sample brief, frontmatter quoting, and `scaffoldSite`.
- `tests/build/starter-build.test.mjs`: every sample brief builds, with one route per page, one `h1`, a title, a description and its call to action on every page, working internal links and anchors, labelled form fields and JavaScript inside the budget. They need the starter's dependencies (`scripts/setup.sh` installs them) and are skipped, with the reason, without them.

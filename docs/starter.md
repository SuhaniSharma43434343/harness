# Starter template (T18)

`starters/astro-base/` is the site every Forge project starts from. It is APP-01 (AI to Full Website): a static, multi-page [Astro](https://astro.build) site (MIT) built from the brief, the design tokens and the page content. Every other approach adds sections to it; none replaces it.

`forge site <project>` copies the starter into `workspace/<project>/site/` and writes the project's brief, tokens and content into it. `--build` also installs and builds it and checks the JavaScript budget.

## Template contract

This is decision 4 of the [M1 freeze](interfaces.md#decisions-at-the-freeze), in detail. Paths are relative to `site/`.

| What | Where | Written by | Format |
| --- | --- | --- | --- |
| Design tokens | `src/styles/tokens.json` | `forge site`, from `design/tokens.json` or the chosen direction (Creative Director, B2) | `schemas/tokens.schema.json` |
| Site settings | `src/site.json` | `forge site`, from the brief; the form plugin fills each form's `action` | `schemas/site-config.schema.json` |
| Page content | `src/content/pages/<slug>.md` (`index.md` is `/`) | `forge site` scaffold, replaced by locked content from `content/pages/` (Content & UX, B3) | Markdown with the frontmatter below |
| Sections | `src/sections/<approach>/<Name>.astro` | Builders; APP-01 ships Hero, Prose, Features, Split, Steps, Stats, Gallery, Testimonials, Faq, CtaBand and Form, plus the five x-factor tools: SavingsCalculator, AudienceViewSwitcher, LeadMagnetModal, DeepFaqAccordion and ComparisonMatrix | Astro component |
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

### The atmosphere

`src/styles/atmosphere.css` holds the atmosphere variables: `--surface-1..3`, `--surface-glass`, `--glass-blur`, `--border-subtle`, `--border-glow`, `--radius-sm|md|lg`, `--elevation-1..3`, `--light-radial`, `--grain-opacity`, `--ease-*`, `--dur-*`. The starter's values are neutral, so a site without an atmosphere looks as before. A workflow 2 project's build replaces the file with the design system's atmosphere. `global.css` adds opt-in utilities on those variables: `.surface-raised`, `.surface-sunken`, `.glass`, `.glow-border`, `.radial-light`, `.grain` and `.lift`.

### One route per page, so each page loads only its own CSS

Before every build, `scripts/sync-content.mjs` pulls in `content/pages/` and then writes a route for each page: `src/pages/<slug>.astro` (`index.astro` for `/`). The route imports only the sections that page's frontmatter names and renders them with `src/components/SectionList.astro`. Astro gives each page the CSS of the components its route imports, so a page loads its own sections' CSS and the layout's, not every section on the site. On hearwell-v2 that took each page from 125 KB of CSS to between 17 and 47 KB (before compression).

- The generated routes start with `// forge:generated-route`. Each build deletes and rewrites them, so a page removed from the content loses its route. Do not edit them; edit the page content.
- `src/generated-routes.json` lists the pages that got a route. The catch-all `src/pages/[...slug].astro` builds only the rest, through `Sections.astro`, which imports every section. After a normal `npm run build` that is no page.
- A hand-written route of the same name wins: the prebuild leaves it alone and the page is not generated.
- A page naming a section that does not exist fails the prebuild with the missing path, as before.
- `astro dev` does not run the prebuild, so in development pages come from the catch-all route. The pages look the same; only the CSS bundling differs.

### Tokens

`tokens.json` has colour (`bg`, `fg`, `primary`, `accent`, `muted`, `surface`, `border`, `onPrimary`, `onAccent`, `link`, plus any extras), the display and body fonts with their CSS stacks, the type scale (`base` in rem, `scaleRatio`, `lineHeight`, `measure`), `space`, `radius` and `motion.intensity` (0 to 3, from the brief). `src/lib/tokens.mjs` turns it into custom properties in the base layout.

`tokensFromDirection(direction)` in `src/site/tokens.mjs` builds tokens from a design direction. It derives the colours a direction does not name and refuses tokens whose rendered pairs fail WCAG contrast: body text, muted text, links and button text need 4.5:1, and `primary` against the background needs 3:1 (focus ring).

### Forms

Each brief form is placed on the page whose slug or purpose matches it (contact, book, register, volunteer and similar), or on the home page. Every page's call to action points at the first form. Fields get input types and autocomplete from their names, and `name` and `email` are required. Until the form plugin sets `action`, a submission validates, then says the form is not connected yet, so a missing endpoint shows up in QA.

### X-factor tools

Five APP-01 sections for the sections a plan tags `x-factor-tool`: the pieces that answer a buyer's real questions (They Ask, You Answer) and turn a visit into a lead. Each is plain Astro with at most one small script (under 2 KB each, bundled only on pages that use it), is styled only with the token custom properties, has visible focus styles and tap targets of at least 44 px, and drops its motion under `prefers-reduced-motion`. A page that uses all five stays far inside the 150 KB budget and passes the accessibility and interactions gates (the build test checks both).

**SavingsCalculator**: an ROI or savings calculator. The formula is a sum of products of input names and plain numbers (`[["hours", "rate", 52, 0.5]]` is hours x rate x 52 x 0.5; a negative number subtracts a term). The result for the default values is worked out at build time and the formula is written out in words, so without JavaScript it is a worked example; the script makes the inputs live and announces each result in an `aria-live` region. A formula naming an input that does not exist fails the build. The arithmetic is `src/lib/calculator.mjs`.

```yaml
  - use: "APP-01/SavingsCalculator"
    heading: "What could you save?"
    inputs:
      - { name: "hours", label: "Hours spent on admin each week", unit: "hours", value: 5, min: 0, step: 0.5 }
      - { name: "rate", label: "What an hour of your time is worth", unit: "GBP", value: 40, min: 0 }
    formula: [["hours", "rate", 52, 0.5]]
    result: { label: "Estimated saving a year", prefix: "£", decimals: 0 }
    note: "Assumes the tool halves the time you spend on admin."   # the assumption, stated
    cta: { label: "Book a call", href: "/contact" }                 # optional
```

**AudienceViewSwitcher**: one path per kind of visitor. ARIA tabs (arrow keys, Home, End, automatic activation); each view ends on a link to its own path (its `cta`, or the page's). Without JavaScript the tabs hide and every view shows, stacked.

```yaml
  - use: "APP-01/AudienceViewSwitcher"
    heading: "Who is it for?"
    views:
      - { label: "Residential", heading: "For your home", text: "...", points: ["Fixed price"], cta: { label: "Home services", href: "/residential" } }
      - { label: "Commercial", heading: "For your business", text: "...", cta: { label: "Business services", href: "/commercial" } }
```

**LeadMagnetModal**: a button opens a native modal `<dialog>` with a short form. Escape and a click on the backdrop close it, focus starts on the first field and returns to the button on close. The form posts to the form's `action` in `src/site.json` when the form plugin has set one, otherwise to `/api/form?form=<id>`, the form plugin's endpoint. Its fields are those of `forms.<id>` in `site.json` when the form is defined there, otherwise name and email. The button uses the native invoker commands (`commandfor`), so the dialog opens without JavaScript in current browsers; the script covers older ones and sends the form in place.

```yaml
  - use: "APP-01/LeadMagnetModal"
    form: "buyers-guide"
    heading: "The buyer's guide"
    text: "Twelve pages on what to ask before you buy."
    button: "Get the free guide"
    success: "Thank you. The guide is on its way to your inbox."   # optional
    privacy: "We send the guide and nothing else."                  # optional
```

**DeepFaqAccordion**: the long, honest answers, each one or several paragraphs, in native `<details>` (no JavaScript), ending on a call to action (the page's unless `cta` is given). Each question has an anchor (`id`, or `faq-<n>`) so other pages can link straight to it.

```yaml
  - use: "APP-01/DeepFaqAccordion"
    heading: "Everything you wanted to ask"
    items:
      - q: "How much does it cost?"
        a: ["It depends on three things: ...", "For a typical home that comes to ..."]
      - { q: "How long does it take?", a: "Most jobs take one day.", id: "how-long" }
    ctaHeading: "Still have a question?"
```

**ComparisonMatrix**: the client against the alternatives, as a real `<table>` with a `<caption>` and `scope` headers. A value is `true`, `false` or text; `highlight` marks the client's column. Where the table's container is narrower than 40rem each row becomes a card and each cell shows its column's name, so it reads on a phone without horizontal scrolling.

```yaml
  - use: "APP-01/ComparisonMatrix"
    heading: "How we compare"
    caption: "Us against the usual alternatives"
    columns: ["Us", "A typical agency", "Doing it yourself"]
    highlight: 0
    rows:
      - { feature: "Fixed price", values: [true, false, true] }
      - { feature: "Time to launch", values: ["2 weeks", "3 months", "It depends"] }
```

Numbers, prices and comparisons in these tools are claims like any other: each needs a source in `content/claims.json`.

## Budgets

APP-01 targets mobile LCP at most 2.5 s and base JavaScript at most 150 KB gzip. The starter ships no framework runtime; a sample site's JavaScript is the form script, under 1 KB gzip. `siteReport(dist)` in `src/site/build.mjs` reports routes and JavaScript size, and `forge site --build` fails over budget. Lighthouse, axe and the other gates arrive with T21 and T22.

## Tests

- `tests/unit/site-tokens.test.mjs` and `tests/unit/site-content.test.mjs`: token derivation and contrast, the CSS output, the brief-to-pages plan for every sample brief, frontmatter quoting, `scaffoldSite`, and the prebuild's per-page routes (each imports exactly its own sections, a removed page loses its route, a hand-written route wins, a missing section fails).
- `tests/build/starter-build.test.mjs`: every sample brief builds, with one route per page, one `h1`, a title, a description and its call to action on every page, working internal links and anchors, labelled form fields and JavaScript inside the budget, and each page loading only its own sections' CSS. A page with all five x-factor tools builds inside the budget with each tool's script under 2 KB and no hard-coded colour or font, passes the accessibility and interactions gates, and works by keyboard (the calculator's result updates, arrow keys switch views, Escape closes the dialog and returns focus) with no horizontal scroll at 360 px.
- `tests/unit/site-calculator.test.mjs`: the savings calculator's formula, formatting, explanation and checks. They need the starter's dependencies (`scripts/setup.sh` installs them) and are skipped, with the reason, without them.

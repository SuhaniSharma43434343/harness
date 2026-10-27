---
name: app01
description: APP-01 AI to Full Website. Build or change a Forge site's pages, content and styling on the starter template. Every project uses it.
---

# APP-01: AI to Full Website

The base build method for every project. Other approaches add sections on top of it.

## Inputs

- `intake/brief.json` (approved at B1)
- `design/tokens.json` or the chosen direction in `design/directions.json` (B2)
- `content/pages/*.md`, the locked content (B3)

## Steps

1. If `site/` does not exist, run `forge site <project>`. It copies `starters/astro-base/` and writes `src/site.json`, `src/styles/tokens.json` and one page per brief page.
2. Edit pages in `site/src/content/pages/<slug>.md`. Each page lists its sections in frontmatter (`use: "APP-01/Hero"` and so on) and keeps its `cta`. Locked content is copied in from `content/pages/`; do not rewrite it.
3. Use the APP-01 sections: `Hero` (heading, lead, cta), `Prose` (the Markdown body), `Features` (items of title, text and optional href), `CtaBand` (heading, text, cta) and `Form` (form id from `site.json`).
4. Style only through the token custom properties. Never hard-code a colour, font or size, and never edit `tokens.json` after B2.
5. Verify with `cd site && npm run build`. The build fails on an unknown section or invalid frontmatter.

## Done when

- One route per brief page, each with one `h1`, a title, a description and its call to action.
- No page is still `status: scaffold` at quality review.
- JavaScript at most 150 KB gzip per page; mobile LCP at most 2.5 s.

## Fallback

None: APP-01 is the fallback for every other approach.

See `docs/starter.md` for the full template contract.

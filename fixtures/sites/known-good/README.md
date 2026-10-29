# Known-good fixture

A small, finished business site (Harbor Home Renovations) that passes every gate. It is the base for the seeded defects in `../defects/`. It is hand-written HTML in the shape the starter builds, so the gate tests need no build step.

- `site/dist/`: the built site (3 routes, a 404 page, sitemap, robots, two licensed images, a working form).
- `content/pages/`: the locked content the pages must match (content parity).
- `content/claims.json` and `research/sources.json`: each claim with its source.
- `assets/register.json`: a licence row for every shipped asset.

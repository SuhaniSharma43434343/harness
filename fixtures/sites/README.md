# Gate fixtures (T23)

Every gate test runs on these, through `materializeFixture(name)` in `src/gates/fixtures.mjs`, which copies a fixture to a temp folder first.

| Fixture | What it is | Every gate must |
| --- | --- | --- |
| `known-good/` | A small finished business site: 3 routes, a 404, sitemap, robots, two licensed images, a working form, locked content, a sourced claim and a licence register | pass |
| `blank/` | An empty built page with locked content waiting for it | fail, or report an error; never pass |
| `defects/<id>.json` | The known-good site with one seeded defect | the gate it names fails with the finding it names |

A defect file says what to change: `files` to add, `remove`, `replace` (each `find` must match exactly once, or the fixture fails loudly), and `json` (`set` replaces a file, `merge` deep-merges into it).

To add a defect, write a new `defects/<id>.json` with `base`, `gate`, `finding` and `description`. The gate suites pick it up automatically.

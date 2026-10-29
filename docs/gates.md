# Quality gates

The gates are the automated checks behind the P11 quality floor. Each one reads the built site
(`workspace/<project>/site/dist`) and the project files around it, and returns a gate result
(`schemas/gate-result.schema.json`) with a status and findings.

```sh
forge gates <project>                     # every gate available, in order
forge gates <project> --gate seo          # one gate (repeat --gate for more)
forge gates <project> --preview           # a preview build: pages must be noindex
forge gates <project> --json              # results and the quality floor as JSON
```

Each run writes `evidence/gates/<gate>.json` and one `gate_result` ledger entry per gate. The
command exits 1 unless the quality floor is met: every required gate present and `pass`.

## Rules every gate follows

- A site problem is a `fail` with findings, never an exception. A gate fails when it has any
  `critical` or `serious` finding; `moderate` and `minor` findings are reported only.
- A gate that cannot run (bad input, a missing tool) is `error` with the error code. `error`,
  `skipped` and a missing result never count as a pass.
- No gate passes a site it could not check. With no build, no pages, or only empty pages, every
  gate fails with `no-build`, `no-pages` or `empty-site`.
- A gate that needs a tool that is not installed is `error` with code `UNAVAILABLE`.
- Thresholds come from the gate's defaults, overridden by `opts.thresholds`.

## Content gates (T21)

| Gate | Reads | Findings |
| --- | --- | --- |
| `content-parity` | `content/pages/*.md` (locked copy) and the built pages | `route-missing` (critical), `text-missing` (serious). Skipped with `NO_LOCKED_CONTENT` before content is locked. |
| `claims` | built text, `content/claims.json`, `research/sources.json` | `unsourced-claim`, `unknown-source`, `no-source` (serious). Threshold `maxUnsourced` (0). |
| `licences` | every image, video, font and model in the build, `assets/register.json` | `no-licence-record`, `uncertain-rights`, `no-evidence`, `no-register` |
| `secrets` | `site/` source and build, except `node_modules` | `secret` (redacted, never the value), `env-file` (critical). `.env.example` is allowed. |
| `seo` | built pages, `sitemap.xml`, `robots.txt` | `title-missing`, `title-duplicate`, `description-missing`, `h1-count`, `lang-missing`, `canonical-missing`, `jsonld-invalid`, `sitemap-missing`, `sitemap-incomplete`, `robots-missing`, `noindex` (serious); `preview-indexable` (critical); length and Open Graph findings are minor. |
| `dependencies` | `site/package-lock.json`, without dev packages | `licence-not-allowed`, `no-lockfile` (serious) |

A claim is a sentence with a number or percentage, a "more than" comparison, a founding year, a
superlative ("best", "leading", "the only"), "trusted by" or a guarantee or certification. It
passes when its text is in `content/claims.json` with a source in `research/sources.json` or
`clientFlag: true`.

A dependency passes with a licence in `ALLOWED` (MIT, ISC, Apache-2.0, the BSD licences, 0BSD,
Unlicense, CC0-1.0, OFL-1.1, BlueOak-1.0.0, Python-2.0, MPL-2.0, CC-BY-4.0, Zlib), or with a row in
`assets/register.json` that names the `package`, has `evidence` and is not `uncertain`. SPDX
`OR` passes when any option is allowed; `AND` needs every part.

The starter (`starters/astro-base`) builds a `sitemap.xml` and `robots.txt` from its content
pages and adds Organization JSON-LD. Until `site.url` is set in `src/site.json`, pages have no
canonical URL and the SEO gate fails with `canonical-missing`.

## Browser gates (T22)

These serve `site/dist` on `127.0.0.1` (`src/gates/serve.mjs`, clean URLs, 404 page, no POST)
and open it in Chromium. `runGates` starts one browser and shares it across them.

| Gate | What it does | Findings |
| --- | --- | --- |
| `routes` | Loads every page, collects console errors, failed requests and internal links, then requests every linked path and an unknown path | `route-status` (critical), `console-error`, `asset-missing`, `broken-link`, `no-404` (serious). Threshold `maxConsoleErrors` (0). |
| `accessibility` | axe-core, WCAG 2.2 A and AA rules, on every page at 390, 768 and 1440 px, plus a reduced-motion pass at 390 px | The axe rule id (`image-alt`, `label`, `color-contrast`, ...) with axe's impact as its severity, once per page and rule |
| `forms` | For each form: checks it has an endpoint, submits it empty (the browser must stop it), then filled with the endpoint intercepted to answer 200 and then 500 | `no-endpoint`, `not-sent` (critical); `no-validation`, `no-status`, `no-success-state`, `no-error-state` (serious). No real data is ever sent. |
| `responsive` | Every page at 360, 390, 768, 1280, 1440 and 1920 px, with motion reduced | `horizontal-overflow` (serious, names the widest element), `small-text` (moderate, threshold `minFontPx` 12). Screenshots go to `evidence/gates/responsive/`. |
| `performance` | Lighthouse (mobile, simulated throttling) on up to `maxPages` (3) pages, median of `runs` (3) runs each; the APP-01 JavaScript budget on the whole build | `score` (< 0.9), `lcp` (> 2500 ms), `cls` (> 0.1), `tbt` (> 200 ms), `js-budget` (> 150 KB), all serious |

## Tools

The browser gates use Playwright, axe-core and Lighthouse, pinned in `tools/package.json` and
installed by `scripts/setup.sh --with-test-tools` (`setup.ps1 -WithTestTools` on Windows), which
also installs Chromium. They are not harness dependencies because they are large. Without them
a browser gate is `error` with code `UNAVAILABLE` and a hint, never a pass, and the browser tests
are skipped with that reason. Lighthouse runs Playwright's Chromium, so no Chrome install is needed.

Each tool has an adapter and a manifest in `src/plugins/<id>/` (`plugin.json`, off by default,
local network only), so `forge plugins list` and `forge doctor` show them. The gates import the
adapters directly rather than through `getPlugin`, because they are local test tools that every
QA run needs, not optional services to enable. `opts.adapters.{playwright, axe, lighthouse}`
replaces them, which is how the tests pass a fake Lighthouse.

Real Lighthouse runs take about 40 seconds a page, so their tests run only with
`FORGE_SLOW_TESTS=1`. The performance rules are tested with a fake adapter in every run.

## Testing a gate

`fixtures/sites/` holds a blank site, a known-good site and one seeded defect per finding (see its
README). `tests/gates/content-gates.test.mjs` checks, for every gate, that the known-good site
passes, the blank site fails, and each of its defects produces the finding id it names. A new
gate needs the same three tests.

# Troubleshooting

Start with `./forge doctor`. It checks Node, npm, Git, Claude Code, the config, `.env`, the workspace and the plugins, and says how to fix each one.

Every Forge error has a code and, usually, a hint (`  -> ...`) under the message. Look up the code first, then the symptom.

## Error codes

| Code | What it means | What to do |
| --- | --- | --- |
| `CONFIG_MISSING` | Something Forge needs is not there: a project, a brief, a registry file, a recording, the Claude Code binary, a site | Follow the hint. Common cases: `forge new <project>` first; `forge intake` before `forge site`; install Claude Code and make sure `claude` is on PATH |
| `CONFIG_INVALID` | A file is there but wrong: `forge.config.json` is not JSON, the registry or question bank disagrees with itself, a recording was made for a different contract | Fix the file named in the message. For a recording, record again: the contract changed |
| `SCHEMA_INVALID` | A JSON file or answer does not match its schema | `./forge validate <schema> <file>` lists every error with its path |
| `PERMISSION_DENIED` | Forge refused an action: a missing approval, an illegal phase move, a task outside its phase, a project or site that already exists | Read the reason. For a missing approval, review what it covers, then `forge approve <project> <code>`. Refusals are recorded in the ledger |
| `UNAVAILABLE` | A tool or process could not run: Playwright, axe-core or Lighthouse missing, Chromium will not start, npm failed, the run lock is held, a task ran past its budget | See the sections below |
| `AUTH_FAILED` | Claude Code is not signed in | Run `claude` once and sign in, then retry |
| `RATE_LIMITED` | Claude Code hit a rate or usage limit | Wait, then `forge run` again; finished tasks are never re-run |
| `NOT_IMPLEMENTED` | The feature is planned but not built | `forge --help` lists planned commands and their milestones |

## Setup and doctor

- **`.env not found` (WARN).** This is normal until you need a credential. To add one, copy `.env.example` to `.env` and fill in only what you use.
- **Windows: "running scripts is disabled".** Run the setup as `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`.
- **`npm ci` fails during setup.** Delete `node_modules/` and run the setup again. If it still fails, check that `node -v` is 22 or later.

## Building a site

- **`forge site --build` fails while installing.** `forge site` adds font packages, and `forge approach` adds approach packages, to `site/package.json`. The build then runs `npm install`, which updates the lockfile, instead of `npm ci`. If it still fails, read the npm error printed above "Build failed". A network problem shows as `ETIMEDOUT` or `ECONNRESET`.
- **"Page X uses section APP-0N/Name, but src/sections/APP-0N/Name.astro does not exist".** Either the page names a section from an approach that was not applied (`forge approach <project> APP-0N`), or the name has a typo.
- **The JavaScript budget fails.** The 150 KB budget counts what a page loads up front. Approach libraries must be dynamic imports, which the module runtimes already are. A static `import` of a large library in a section moves it into the budget.

## Gates

- **Every gate fails with `no-build`.** Build first: `forge site <project> --build`, or `cd workspace/<project>/site && npm run build`.
- **A browser gate is `error` with `UNAVAILABLE`.** The browser tools are missing. Run `./scripts/setup.sh --with-test-tools`, or `setup.ps1 -WithTestTools` on Windows. They install into `tools/node_modules`, and Chromium comes from Playwright.
- **"Playwright could not start Chromium".** Run `cd tools && npx playwright install chromium`. On Linux, if the error names missing system libraries, `npx playwright install-deps chromium` installs them.
- **`content-parity` is `skipped`.** Content is not locked yet (B3). This is not a pass, so the quality floor stays unmet until `content/pages/` exists.
- **`seo` reports `canonical-missing` on every page.** Set `url` in `site/src/site.json` once hosting is decided, then rebuild.
- **`licences` reports `no-register`, or `dependencies` reports `licence-not-allowed`.**
  - Asset Rights records each asset and package in `assets/register.json`, with evidence.
  - Approach packages whose licence is not verified start as `uncertain`. GSAP and the Spline runtime are examples. They block until the evidence is recorded.
  - Optional build-machine binaries, such as sharp's libvips, show as `build-binary-licence` and do not block. List them in THIRD_PARTY_NOTICES.
- **`forms` reports `no-endpoint`.** The form has no `action` until the form plugin sets one. The page says the form is not connected, rather than pretending to send.
- **`performance` takes minutes.** Lighthouse runs 3 times on each of up to 3 pages. Run the other gates while you iterate (`--gate` for each), and the performance gate at the end. Fewer runs or pages can be set through `runGate(name, siteDir, { thresholds: { runs, maxPages } })`; there is no CLI flag for thresholds yet.

## Running tasks

- **"Project is already being run by process N".** Another `forge run` holds the run lock. If that process died, run `forge resume <project>`. It requeues tasks with a stale heartbeat, discards their uncommitted changes, and re-verifies submitted work.
- **"Task X cannot lock …".** Two tasks own overlapping files. The runner runs them one after the other; if this repeats, the contracts overlap by mistake.
- **A task ran past its budget, or ended `blocked`.** Read `evidence/tasks/<task>/attempt-N-verify.log` and `forge status <project>`. A task is retried at most twice, then blocked with its reason.
- **The repair loop escalated.** Three repair loops ran and defects are still open. `reports/escalation.md` lists each one with its evidence and repair tasks. Decide what to do before B6: fix by hand, change the plan, or accept in writing.

## The ledger

- **"Removed a torn last line" in the ledger.** A write was interrupted, for example by a power cut or a killed process. Forge truncates the partial line on the next write and records what it removed. Nothing else is lost.
- **"ledger.jsonl line N is not valid JSON".** Someone edited the ledger by hand. It is append-only: restore it from Git or a backup, and never edit it.

## Tests

- **Build or browser tests are skipped.** The reason is printed next to each skipped test. Build tests need the starter's dependencies (`./scripts/setup.sh`). Browser tests need the test tools (`--with-test-tools`). Approach tests download each module's packages once, so their first run needs the network.
- **Real Lighthouse tests are skipped.** They take minutes, so they run only with `FORGE_SLOW_TESTS=1 npm test`.

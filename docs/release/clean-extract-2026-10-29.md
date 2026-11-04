# Clean extraction, 2026-10-29 (T30, A1 and A14)

Result: **pass**, with one script issue logged below.

| | |
| --- | --- |
| Package | `forge-v0.1.0.zip`, 502 files, SHA-256 `4e5ed563f0c15e86df08f44cabbbe295d231e92754a37126b00db58bc85af5f0` |
| Built from | `m5-security-review` at `fc66c8a` (main plus PR #29), with `forge audit`, which builds the package |
| Machine | Linux x86_64 (a cloud container, not either developer's machine), Node 22.22.0, npm 10.9.4, Git 2.43.0 |
| Command | `scripts/clean-extract-test.sh forge-v0.1.0.zip`, run with a clean `HOME` |

## What ran

1. The ZIP extracted into a new temporary folder.
2. `scripts/setup.sh`: `npm ci` for the harness (0 vulnerabilities) and the starter, then `forge doctor`: Node, npm, Git, Claude Code, config, workspace and plugins all OK. `.env` is a warning (not found), as expected on a new install.
3. `npm test`: **612 tests, 512 pass, 0 fail, 100 skipped.** The skipped tests need the optional browser tools (`setup.sh --with-test-tools`) or `FORGE_SLOW_TESTS=1`, which the script does not install or set.

The archive holds no `node_modules`, `.env`, workspace data, Git history or absolute paths (the package's own audit, and a listing of the ZIP).

## Full suite on the same machine

On main (`bddae26`) with the browser tools installed (Playwright 1.63.0 with Chromium, axe-core 4.14.0, Lighthouse 12.8.2), the starter installed, and `FORGE_SLOW_TESTS=1`: **609 tests, 609 pass, 0 skipped**, in about 3 minutes.

## Issues

- `scripts/clean-extract-test.sh` exits 0 when the tests fail. The `{ ... } | tee` pipeline returns the status of `tee`, so `set -e` never sees a failure; only the missing `PASS` line in the log shows it. Reported to Suhani on PR #29 (it is her file). Until it is fixed, read the end of the log, not the exit code.
- The clean extraction does not run the browser gates' tests. For A1, run `scripts/setup.sh --with-test-tools` on the second machine too, or record the skips as accepted.

## Still needed for A1

The plan asks for a machine **or account** that never held the development repository. This container held a clone, in another folder. A run on a third person's machine, or the A15 test, would close that.

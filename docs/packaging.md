# Packaging and upgrades

## Building the package (maintainers)

```bash
./forge package            # builds dist/forge-v<version>.zip
./forge package --verify   # also runs the clean-extraction test
```

`forge package` packs only files Git tracks, so ignored and untracked files never get in. It also packs only paths on the allow-list in `src/core/package.mjs`, which follows the plan's package layout. When the repository has no `THIRD_PARTY_NOTICES.md`, one is added, built from the licence each installed dependency declares.

Before it reports success, it reads back the archive it just wrote and checks every entry. The package is refused, and deleted, if any entry is one of these:

- `node_modules`, a `.env` file (`.env.example` is fine) or `forge.config.json`;
- anything in `workspace/` except `.gitkeep`;
- Git history, log files or OS clutter;
- a file containing something that looks like a credential;
- a file containing a personal absolute path such as a real `C:\Users\<name>\` or `/home/<name>/`. Placeholders like `<you>` or `$USER` are allowed.

It names the file, line and kind of problem, never the secret. It also lists any release file that is still missing; today that is `QUICKSTART.md` and `LICENSE`, because the licence has not been chosen yet.

## Clean-extraction test

`forge package --verify` extracts the ZIP into an empty temporary folder, then runs `npm ci`, `forge doctor` and the whole test suite there. It needs network access for `npm ci`.

For the acceptance tests (A1 and A14), run the same check on a machine or account that never held the repository, and keep the log it writes next to the ZIP:

```bash
scripts/clean-extract-test.sh forge-v0.1.0.zip
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\clean-extract-test.ps1 forge-v0.1.0.zip
```

## Upgrading to a new version

Extract the new version into its own folder, then run this from inside it:

```bash
./forge upgrade --from ../forge-v0.1.0 --dry-run   # shows what it would copy and checks each project
./forge upgrade --from ../forge-v0.1.0
```

It copies `.env`, `forge.config.json` and every project in `workspace/`. Then it runs the migrations for the old version (there are none yet) and checks each project's `project.json`, ledger and task board against the new schemas. Projects that fail the check are listed. An upgrade refuses to overwrite a project that already exists in the new folder unless you pass `--force`, and it records the upgrade in each project's ledger.

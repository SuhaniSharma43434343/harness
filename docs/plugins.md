# Plugins

A plugin adapts one outside tool or service. Every plugin is off until the operator enables it, sees only the environment variables it declares, and can only do what its manifest allows. The plugin host is `src/core/plugins.mjs`.

## Layout

Each plugin is a folder named after its id, in `plugins/<id>/` or, for the test-tool adapters, `src/plugins/<id>/`:

| File | What it holds |
| --- | --- |
| `plugin.json` | The manifest (`schemas/plugin-manifest.schema.json`): category, version, `enabledByDefault: false`, env vars, permissions, approvals, cost and docs |
| `index.mjs` | The adapter (see below) |
| `mock.mjs` | Optional: the same actions with recorded responses, used in tests and mock mode |

## The adapter

`index.mjs` may export:

- `configSchema`: a JSON Schema for the plugin's env vars, checked before the plugin is handed out.
- `healthCheck(ctx)`: resolves `{ ok, detail }`, or throws a typed error. It has 30 seconds.
- `actionKinds`: action name to `read`, `write`, `deploy` or `spend`. An action not listed is `read`.
- `actionApprovals`: action name to the approval codes it needs, when the default is wrong. For example, a preview deploy needs B5 but not B7.
- The actions themselves, as exported functions, or as the object that `create(ctx)` returns.

`ctx` is `{ id, env, fetch, mock, project }`. `env` holds only the declared variables. `fetch` refuses any host the manifest's `permissions.network` does not list (`*.example.com` matches subdomains).

## What the host enforces

`getPlugin(id, { project })` resolves to `{ id, manifest, mock, actions }`. Before it hands out a plugin, it checks that:

- the plugin exists (otherwise `ConfigMissing`);
- the plugin is enabled in `forge.config.json` (otherwise `PermissionDenied`, with the enable command as the hint);
- every required variable is set (otherwise `ConfigMissing`, naming the variables but never their values);
- the settings pass `configSchema` (otherwise `ConfigInvalid`).

Every action call is then checked again:

- **Kind:** a `write`, `deploy` or `spend` action must be listed in `permissions.actions`.
- **Approvals:** by default, a `deploy` or `spend` action needs every approval in the manifest, and any other action needs B5 when the manifest lists it, because it is an external integration. The approvals must be in the project's ledger, or the call is refused and the refusal is recorded. A gated action needs a project.
- **Logging:** each call is written to the ledger as `plugin_call`, with its kind, whether it worked, the error code and its duration. An error that is not typed becomes `Unavailable`.

With `{ mock: true }`, the host loads `mock.mjs` and skips the credential check, so tests and `forge test --mock` never call a paid API.

## Commands

| Command | What it does |
| --- | --- |
| `forge plugins list [--json]` | Each plugin with its state, cost, approvals and any missing variables |
| `forge plugins enable <id> [--project <p>]` | Checks the config, runs the health check, then turns the plugin on. With a project, the decision is recorded in its ledger |
| `forge plugins disable <id>` | Turns it off; its feature falls back to the documented fallback |
| `forge plugins check [id]` | Runs the health check of one plugin, or of every enabled plugin |
| `forge doctor` | Also runs the health check of every enabled plugin |

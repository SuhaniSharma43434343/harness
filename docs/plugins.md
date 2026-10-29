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

## Plugins in this release

### git

A local Git repository for each project. There is no remote yet; GitHub comes later. `init(projectDir)` makes the project folder the top of its own repository, with a `.gitignore` that leaves out `locks/`, `node_modules/` and `.env`, and makes a first commit. Running it again changes nothing. `commit(projectDir, message, { paths })` returns the new commit, or `null` when nothing changed. `status` and `log` read the repository. Because the project is its own repository, `forge resume` can discard a crashed task's uncommitted changes. No credentials, no network, no approvals.

### local-preview

`start({ dir, port })` serves a built site (for example `site/dist`) on `127.0.0.1` and resolves `{ url, close }`. Clean URLs map to `<path>/index.html` or `<path>.html`. A missing page gets the site's `404.html` with status 404, every response carries `X-Robots-Tag: noindex`, and path traversal is refused. No credentials, no approvals.

### vercel

Deploys a built static site through the Vercel REST API. It uploads each file by its SHA-1, creates the deployment and polls it until it is ready, which can take up to 5 minutes.

| Action | Kind | Needs |
| --- | --- | --- |
| `deployPreview({ dir, name })` | deploy | B5 |
| `deployProduction({ dir, name })` | deploy | B5 and B7 |
| `getDeployment(id)` | read | B5 |

Set `VERCEL_TOKEN` in `.env`. `VERCEL_TEAM_ID` is optional, for team accounts, and so is `VERCEL_PROJECT`, which defaults to the Forge project id. The health check signs in with the token. A rejected token is `AuthFailed`, a rate limit is `RateLimited`, and a failed build is `Unavailable`. The status is `implemented-unverified` until a deploy with a real token has been logged.

### form-function

This makes forms work on a deployed site. Each form posts to a Vercel function at `/api/form?form=<id>`. The function checks the submission again on the server and forwards it as JSON to the operator's `FORM_WEBHOOK_URL`. The checks are:

- unknown forms are refused, and unknown fields are dropped;
- required fields and email addresses are validated;
- values over 5,000 characters are refused;
- a filled `_gotcha` honeypot field is accepted and dropped;
- each client gets 5 submissions a minute, counted per function instance.

| Action | What it does |
| --- | --- |
| `install(distDir, { forms })` | Writes `api/form.mjs` and its helpers into the built site, using the `forms` from `site.json`. It returns each form's `action` URL |
| `actionFor(id)` | The `action` URL for one form |
| `startLocalEndpoint({ forms, file })` | The same handler on `127.0.0.1`. Accepted submissions are appended to `file` as JSON lines, for previews and the forms gate |

The function reads `FORM_WEBHOOK_URL` on Vercel. Set it there with the vercel plugin's `setProjectEnv('FORM_WEBHOOK_URL', url)`, which needs B5. The health check needs an HTTPS webhook. The mock (`form-mock`) writes nothing and opens no port. The status is `implemented-unverified` until a submission from a real deploy reaches a webhook.

### spline

This embeds a Spline scene at runtime (used by APP-04); automation through the Spline API is future work. The operator exports a scene from their own Spline account as a public `https://prod.spline.design/<id>/scene.splinecode` URL. Set it in the brief's `features.splineSceneUrl`, or as `SPLINE_SCENE_URL` in `.env`.

| Action | Kind | What it does |
| --- | --- | --- |
| `checkScene(url)` | read | Checks the scene is reachable and reports its size, for the APP-04 budget |
| `downloadScene(url, destDir, { name })` | write | Copies the scene into the site, so the runtime loads it from the site's own origin (50 MB limit) |
| `sceneUrl(url)` | read | Checks and returns the scene URL |

Every action needs B5. A URL that is not a Spline scene export is `ConfigInvalid`. A scene that is missing or not public is also `ConfigInvalid`, with a hint.

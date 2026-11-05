// Runs before every build. In a Forge workspace the project's content/ folder is the single
// source of truth for copy; this pulls it in fresh, so a hand-run `npm run build` can never ship
// text older than an approved copy change (the vendored copies once drifted exactly that way).
// Outside a workspace (fixtures, a standalone checkout) there is no ../content and this is a no-op.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const project = join(site, '..');
const pages = join(project, 'content', 'pages');
if (existsSync(pages)) {
  const target = join(site, 'src', 'content', 'pages');
  rmSync(target, { recursive: true, force: true });
  cpSync(pages, target, { recursive: true });
}
const copy = join(project, 'content', 'copy.json');
if (existsSync(copy)) cpSync(copy, join(site, 'src', 'copy.json'));

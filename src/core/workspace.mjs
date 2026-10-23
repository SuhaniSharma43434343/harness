import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigMissing, SchemaInvalid } from './errors.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_WORKSPACE = join(ROOT, 'workspace');

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/;

// Proposed layout of workspace/<project>/ (open question 3 in docs/interfaces.md):
//   project.json   current phase and run counters (a cache; the ledger is the record)
//   ledger.jsonl   append-only event log
//   tasks/<id>.json  one task contract per file (the board)
//   locks/         run lock and per-file locks
//   site/          the generated website (later milestones)
export function projectPaths(project, { workspace = DEFAULT_WORKSPACE } = {}) {
  if (!PROJECT_ID.test(project ?? '')) {
    throw new SchemaInvalid(`"${project}" is not a valid project id`, {
      hint: 'Use lowercase letters, digits and dashes, starting with a letter or digit.',
    });
  }
  const dir = join(workspace, project);
  return {
    dir,
    state: join(dir, 'project.json'),
    ledger: join(dir, 'ledger.jsonl'),
    tasks: join(dir, 'tasks'),
    locks: join(dir, 'locks'),
    site: join(dir, 'site'),
  };
}

export function assertProjectExists(project, opts) {
  const paths = projectPaths(project, opts);
  if (!existsSync(paths.state)) {
    throw new ConfigMissing(`Project "${project}" does not exist`, { hint: `Run forge new ${project} first.` });
  }
  return paths;
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SchemaInvalid(`${file} is not valid JSON`, { hint: err.message });
  }
}

// Write to a temp file, then rename over the target, so a crash never leaves a half-written file.
// Windows can refuse the rename for a moment while another handle is open, so retry briefly.
export function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      if (i >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
        rmSync(tmp, { force: true });
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (i + 1));
    }
  }
}

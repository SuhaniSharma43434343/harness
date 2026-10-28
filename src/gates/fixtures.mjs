import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../core/workspace.mjs';

export const FIXTURES_DIR = join(ROOT, 'fixtures', 'sites');

// The seeded defects: fixtures/sites/defects/<id>.json, each naming its base site, the gate
// that must catch it and the finding id it must produce.
export function listDefects(dir = FIXTURES_DIR) {
  return readdirSync(join(dir, 'defects'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, 'defects', f), 'utf8')) }));
}

function merge(a, b) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
    return out;
  }
  return b;
}

// Applies one defect's changes to a copy of its base. Every find must match exactly once, so
// a fixture that drifts from its base fails loudly instead of seeding nothing.
function applyDefect(defect, out) {
  for (const [file, text] of Object.entries(defect.files ?? {})) {
    mkdirSync(dirname(join(out, file)), { recursive: true });
    writeFileSync(join(out, file), text);
  }
  for (const file of defect.remove ?? []) rmSync(join(out, file));
  for (const r of defect.replace ?? []) {
    const path = join(out, r.file);
    const text = readFileSync(path, 'utf8');
    const re = r.regex ? new RegExp(r.find, 'g') : null;
    const count = re ? (text.match(re) ?? []).length : text.split(r.find).length - 1;
    if (count !== 1) throw new Error(`Defect ${defect.id}: "${r.find}" matches ${count} times in ${r.file}`);
    writeFileSync(path, re ? text.replace(re, r.replace) : text.replace(r.find, r.replace));
  }
  for (const j of defect.json ?? []) {
    const path = join(out, j.file);
    const value = j.set ?? merge(JSON.parse(readFileSync(path, 'utf8')), j.merge);
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  }
}

// Copies a fixture project (known-good, blank, or a defect id) into a fresh temp folder and
// returns its paths: { dir, siteDir }. Gates run on the copy, never on the fixture itself.
export function materializeFixture(name, { dir = FIXTURES_DIR, into } = {}) {
  const out = into ?? mkdtempSync(join(tmpdir(), `forge-fixture-${name}-`));
  const defect = existsSync(join(dir, 'defects', `${name}.json`))
    ? { id: name, ...JSON.parse(readFileSync(join(dir, 'defects', `${name}.json`), 'utf8')) }
    : null;
  const base = defect ? defect.base : name;
  if (!existsSync(join(dir, base))) throw new Error(`No fixture site "${base}" in ${dir}`);
  cpSync(join(dir, base), out, { recursive: true });
  if (defect) applyDefect(defect, out);
  return { dir: out, siteDir: join(out, 'site'), defect };
}

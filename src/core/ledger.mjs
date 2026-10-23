import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from 'node:fs';
import { dirname } from 'node:path';
import { SchemaInvalid } from './errors.mjs';
import { assertValid } from './schemas.mjs';
import { projectPaths } from './workspace.mjs';

// Reads ledger.jsonl. A crash during a write can leave a torn last line with no newline;
// that line is reported as `torn` and ignored. A bad line anywhere else is corruption.
function scan(file) {
  if (!existsSync(file)) return { entries: [], torn: null };
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const tail = lines.pop(); // '' when the file ends with a newline
  const entries = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      entries.push(JSON.parse(line));
    } catch {
      throw new SchemaInvalid(`ledger.jsonl line ${i + 1} is not valid JSON`, {
        hint: 'The ledger is append-only; restore it from Git or a backup.',
        details: { file, line: i + 1 },
      });
    }
  });
  let torn = null;
  if (tail) {
    try {
      entries.push(JSON.parse(tail));
      torn = { complete: true };
    } catch {
      torn = { complete: false, offset: Buffer.byteLength(text) - Buffer.byteLength(tail), text: tail };
    }
  }
  return { entries, torn };
}

export function read(project, opts = {}) {
  return scan(projectPaths(project, opts).ledger).entries;
}

// append(project, entry) => LedgerEntry, as agreed in docs/interfaces.md.
// seq and ts are assigned here; the entry is schema-checked before it is written.
export function append(project, entry, opts = {}) {
  const { now = () => new Date() } = opts;
  const file = projectPaths(project, opts).ledger;
  mkdirSync(dirname(file), { recursive: true });

  const { entries, torn } = scan(file);
  let repaired = null;
  if (torn && !torn.complete) {
    truncateSync(file, torn.offset);
    repaired = torn.text;
  } else if (torn && torn.complete) {
    appendFileSync(file, '\n');
  }

  let seq = entries.length ? entries[entries.length - 1].seq : 0;
  const write = (e) => {
    const ts = now().toISOString();
    const full = { seq: ++seq, ts, project, ...e };
    Object.assign(full, { seq, ts, project }); // callers cannot override these
    assertValid('ledgerEntry', full, `ledger entry (${e.type})`);
    appendFileSync(file, JSON.stringify(full) + '\n');
    return full;
  };

  if (repaired !== null) {
    write({ actor: 'cli', type: 'error', data: { code: 'LEDGER_TORN_LINE', message: 'Removed a torn last line left by an interrupted write', removed: repaired.slice(0, 500) } });
  }
  return write(entry);
}

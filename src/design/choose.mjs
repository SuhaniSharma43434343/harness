import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { approve } from '../core/project.mjs';

export function readDirections(project, { workspace }) {
  return JSON.parse(readFileSync(join(workspace, project, 'design', 'directions.json'), 'utf8'));
}

// The operator's B2: records the approval and the chosen direction. Returns the ledger entry.
// Throws if the direction does not exist.
export function chooseDirection(project, id, { workspace, note } = {}) {
  const file = join(workspace, project, 'design', 'directions.json');
  const decision = JSON.parse(readFileSync(file, 'utf8'));
  if (!decision.directions.some((d) => d.id === id)) {
    throw new Error(`No direction ${id}. Directions: ${decision.directions.map((d) => d.id).join(', ')}`);
  }
  const entry = approve(project, 'B2', { workspace, note: note ?? `Chose ${id}` });
  writeFileSync(file, JSON.stringify({ ...decision, status: 'chosen', chosen: id, approval: { code: 'B2', ledgerSeq: entry.seq } }, null, 2) + '\n');
  return entry;
}

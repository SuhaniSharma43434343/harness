import { readFileSync } from 'node:fs';
import { SCHEMAS, check } from '../core/schemas.mjs';

// forge validate <schema> <file>: JSON files, or JSONL for ledgerEntry (one entry per line).
export function validateFile(schema, file) {
  if (!schema || !file || !SCHEMAS[schema]) {
    console.error(`Usage: forge validate <${Object.keys(SCHEMAS).join('|')}> <file>`);
    return 2;
  }
  const text = readFileSync(file, 'utf8');
  const docs =
    file.endsWith('.jsonl')
      ? text
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => JSON.parse(l))
      : [JSON.parse(text)];

  let failed = 0;
  docs.forEach((doc, i) => {
    const { valid, errors } = check(schema, doc);
    const label = docs.length > 1 ? `${file}:${i + 1}` : file;
    if (valid) {
      console.log(`valid   ${label}`);
    } else {
      failed++;
      console.log(`INVALID ${label}`);
      for (const e of errors) console.log(`  - ${e}`);
    }
  });
  return failed ? 1 : 0;
}

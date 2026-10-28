import { scanPaths } from '../core/redact.mjs';

// forge scan [path...]: reports files that hold something that looks like a credential, and any
// .env file. The secret itself is never printed. Exit code 1 when anything is found.
export function cmdScan(root, args) {
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const findings = scanPaths(paths.length ? paths : ['.'], { root });
  if (json) console.log(JSON.stringify(findings, null, 2));
  else if (!findings.length) console.log('No secrets found.');
  else {
    for (const f of findings) console.log(`${f.file}${f.line ? `:${f.line}` : ''}  ${f.id}`);
    console.log(`\n${findings.length} possible secret${findings.length === 1 ? '' : 's'} found. Remove them, or move them to .env.`);
  }
  return findings.length ? 1 : 0;
}

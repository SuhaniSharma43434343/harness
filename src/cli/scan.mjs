import { installPreCommit, scanStaged } from '../core/precommit.mjs';
import { scanPaths } from '../core/redact.mjs';

// forge scan [path...]: reports files that hold something that looks like a credential, and any
// .env file. The secret itself is never printed. Exit code 1 when anything is found.
// With --staged it scans what the next commit in the current repository would add.
export function cmdScan(root, args) {
  const json = args.includes('--json');
  const paths = args.filter((a) => !a.startsWith('--'));
  const findings = args.includes('--staged') ? scanStaged(process.cwd()) : scanPaths(paths.length ? paths : ['.'], { root });
  if (json) console.log(JSON.stringify(findings, null, 2));
  else if (!findings.length) console.log('No secrets found.');
  else {
    for (const f of findings) console.log(`${f.file}${f.line ? `:${f.line}` : ''}  ${f.id}`);
    console.log(`\n${findings.length} possible secret${findings.length === 1 ? '' : 's'} found. Remove them, or move them to .env.`);
    if (args.includes('--staged')) console.log('The commit was stopped. Unstage or fix those files, then commit again.');
  }
  return findings.length ? 1 : 0;
}

// forge hooks install [repo] [--force]: adds the secret-scan pre-commit hook to a repository.
export function cmdHooks(root, args) {
  const [sub, dir] = args;
  if (sub !== 'install') {
    console.error('Usage: forge hooks install [repository folder] [--force]');
    return 2;
  }
  const file = installPreCommit(dir && !dir.startsWith('--') ? dir : process.cwd(), { root, force: args.includes('--force') });
  console.log(`Installed the forge pre-commit hook: ${file}`);
  return 0;
}

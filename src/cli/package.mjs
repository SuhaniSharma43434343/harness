import { join } from 'node:path';
import { runAudit } from '../core/audit.mjs';
import { buildPackage, verifyPackage } from '../core/package.mjs';
import { upgrade } from '../core/upgrade.mjs';

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

// forge package [--out <dir>] [--verify]: maintainers only.
export function cmdPackage(root, args) {
  let result;
  try {
    result = buildPackage({ root, outDir: flag(args, '--out') ?? join(root, 'dist') });
  } catch (err) {
    if (err.details) {
      console.error(err.message);
      for (const p of err.details) console.error(`  ${p.file}${p.line ? `:${p.line}` : ''}  ${p.id}`);
      if (err.hint) console.error(`  -> ${err.hint}`);
      return 1;
    }
    throw err;
  }
  console.log(`Built ${result.file} (${result.files} files, version ${result.version}).`);
  console.log('  No node_modules, .env, workspace data, logs, credentials or personal paths inside.');
  if (result.missing.length) console.log(`  Missing for a release: ${result.missing.join(', ')}`);

  if (args.includes('--verify')) {
    console.log('\nClean-extraction test (extract, npm ci, doctor, npm test):');
    const { steps } = verifyPackage(result.file, { log: (m) => console.log(`  ${m}`) });
    for (const s of steps) console.log(`  ${s.ok ? 'OK  ' : 'FAIL'} ${s.name}`);
  }
  return 0;
}

// forge upgrade --from <old folder> [--dry-run] [--force]
export function cmdUpgrade(root, args) {
  const from = flag(args, '--from');
  if (!from) {
    console.error('Usage: forge upgrade --from <old Forge folder> [--dry-run] [--force]');
    return 2;
  }
  const r = upgrade({ from, root, dryRun: args.includes('--dry-run'), force: args.includes('--force') });
  if (args.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    return 0;
  }
  console.log(`${r.dryRun ? 'Dry run: would upgrade' : 'Upgraded'} from ${r.from} to ${r.to}.`);
  console.log(`  ${r.dryRun ? 'Would copy' : 'Copied'}: ${r.copy.join(', ') || 'nothing'}`);
  if (r.migrations.length) console.log(`  Migrations: ${r.migrations.join(', ')}`);
  let failed = 0;
  for (const [p, problems] of Object.entries(r.projects)) {
    if (problems.length) failed++;
    console.log(`  ${problems.length ? 'FAIL' : 'OK  '} ${p}${problems.length ? `: ${problems.join('; ')}` : ''}`);
  }
  return failed ? 1 : 0;
}

// forge audit [--out <dir>]: the release security review (npm audit plus secret scans).
export function cmdAudit(root, args) {
  const r = runAudit({ root, outDir: flag(args, '--out') ?? join(root, 'dist') });
  for (const d of r.dependencies) {
    console.log(d.error ? `?    ${d.lockfile}: ${d.error}` : `${d.counts.high || d.counts.critical ? 'FAIL' : 'OK  '} ${d.lockfile}: ${d.counts.critical} critical, ${d.counts.high} high, ${d.counts.moderate} moderate`);
  }
  console.log(`${r.package?.findings?.length ? 'FAIL' : 'OK  '} package ZIP secret scan`);
  console.log(`${r.secrets.length ? 'FAIL' : 'OK  '} workspace and logs secret scan`);
  console.log(`
${r.ok ? 'Audit passed.' : `Audit failed: ${r.problems.join('; ')}`} Report: ${r.files[0]}`);
  return r.ok ? 0 : 1;
}

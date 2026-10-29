import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { loadProject } from '../core/project.mjs';
import { readJson } from '../core/workspace.mjs';
import { buildSite, JS_BUDGET_BYTES, siteReport } from '../site/build.mjs';
import { scaffoldSite } from '../site/scaffold.mjs';
import { tokensFromDirection } from '../site/tokens.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const USAGE = 'Usage: forge site <project> [--brief <file>] [--tokens <file> | --direction <file>] [--force] [--build]';

// forge site: copy the starter into workspace/<project>/site/ and write the brief, tokens and
// content into it; with --build, install and build it and check the APP-01 JavaScript budget.
export function cmdSite(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  // intake/brief.json wins over the file given to forge new --brief; scaffoldSite reads it.
  const intake = join(workspace, project, 'intake', 'brief.json');
  const briefFile = flag(args, '--brief') ?? (existsSync(intake) ? undefined : loadProject(project, { workspace }).brief);
  const brief = briefFile ? readJson(resolve(briefFile)) : undefined;
  let tokens;
  if (flag(args, '--tokens')) tokens = readJson(resolve(flag(args, '--tokens')));
  else if (flag(args, '--direction')) tokens = tokensFromDirection(readJson(resolve(flag(args, '--direction'))));

  const r = scaffoldSite(project, { brief, tokens, force: args.includes('--force'), workspace });
  const scaffold = r.pages.filter((p) => p.status === 'scaffold').length;
  console.log(`Wrote ${r.pages.length} pages to ${r.siteDir} (tokens: ${r.tokens}).`);
  if (scaffold) console.log(`${scaffold} page(s) are scaffolds until Content & UX locks them in content/pages/.`);
  if (!args.includes('--build')) return 0;

  const b = buildSite(r.siteDir);
  if (!b.ok) {
    console.error(b.output.trim().split('\n').slice(-20).join('\n'));
    console.error(`Build failed (exit ${b.code}).`);
    return 1;
  }
  const report = siteReport(b.dist);
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`Built ${report.routes.length} routes: ${report.routes.join(' ')}`);
  console.log(`JavaScript: ${kb(report.jsBytes)} gzip (budget ${kb(JS_BUDGET_BYTES)}).`);
  return report.withinBudget ? 0 : 1;
}

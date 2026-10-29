import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import * as ledger from '../core/ledger.mjs';
import { loadProject } from '../core/project.mjs';
import { readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { proposeDirections } from '../design/propose.mjs';
import { renderDirections } from '../design/render.mjs';
import { checkDesignRules } from '../design/rules.mjs';
import { loadApproaches } from '../registry/load.mjs';
import { selectApproaches } from '../registry/select.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const USAGE = 'Usage: forge directions <project> [--count <3-5>] [--no-render] | forge directions <project> --check';

// forge directions: P3 and P4 for a project. Writes design/approach-decision.json (if missing),
// design/directions.json and the renders. --check runs the design rules on what is there.
export async function cmdDirections(root, args) {
  const [project] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  loadProject(project, { workspace });
  const dir = join(workspace, project);
  const brief = readJson(join(dir, 'intake', 'brief.json'));
  const directionsFile = join(dir, 'design', 'directions.json');

  if (args.includes('--check')) {
    const findings = checkDesignRules(readJson(directionsFile), brief, { dir });
    for (const f of findings) console.log(`${f.severity.padEnd(8)} ${f.location ?? ''} ${f.message}`);
    const bad = findings.filter((f) => f.severity === 'critical' || f.severity === 'serious');
    console.log(bad.length ? `${bad.length} blocking finding(s).` : 'Design rules pass.');
    return bad.length ? 1 : 0;
  }

  const decisionFile = join(dir, 'design', 'approach-decision.json');
  let decision;
  if (existsSync(decisionFile)) decision = readJson(decisionFile);
  else {
    const { approaches, matrix } = loadApproaches();
    decision = selectApproaches(brief, approaches, matrix);
    writeJsonAtomic(decisionFile, decision);
  }
  const record = await proposeDirections(brief, decision, { count: Number(flag(args, '--count') ?? 3) });
  writeJsonAtomic(directionsFile, record);
  const r = await renderDirections(record, brief, dir, { screenshots: !args.includes('--no-render') });
  ledger.append(project, { actor: 'creative-director', type: 'note', data: { event: 'directions_proposed', directions: record.directions.map((d) => d.id), screenshots: r.screenshots } }, { workspace });

  for (const d of record.directions) console.log(`${d.id}  ${d.name}: ${d.typography.display.family} / ${d.typography.body.family}, ${d.layout}, motion ${d.motionIntensity}`);
  console.log(r.screenshots ? `Rendered desktop and mobile views in design/renders/.` : `Wrote HTML specimens only: ${r.reason}`);
  console.log(`Pick one at B2: edit design/directions.json, then forge approve ${project} B2.`);
  return 0;
}

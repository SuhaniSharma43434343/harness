import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { loadProject, requireApproval } from '../core/project.mjs';
import { readJson } from '../core/workspace.mjs';
import { getModule, MODULES } from '../approaches/index.mjs';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const USAGE = `Usage: forge approach <project> <APP-0N> [--no-install]\nModules: ${[...MODULES.keys()].join(', ')}`;

// forge approach: applies an approach module to a project's site. The approach must be selected
// in design/approach-decision.json, and an experimental one needs its recorded approval.
export function cmdApproach(root, args) {
  const [project, id] = args;
  if (!project || !id || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const workspace = workspaceFor(root);
  loadProject(project, { workspace });
  const dir = join(workspace, project);
  const module = getModule(id);
  const decisionFile = join(dir, 'design', 'approach-decision.json');
  if (!existsSync(decisionFile)) throw new PermissionDenied(`${project} has no approach decision`, { hint: `Run forge directions ${project} (P3) first.` });
  const decision = readJson(decisionFile).decisions.find((d) => d.approach === id);
  if (!decision?.selected) throw new PermissionDenied(`${id} is not selected for ${project}`, { hint: decision?.reason });
  if (decision.needsApproval) requireApproval(project, decision.needsApproval, `apply ${id}`, { workspace });

  const r = module.apply(join(dir, 'site'), { install: !args.includes('--no-install'), projectDir: dir });
  ledger.append(project, { actor: 'cli', type: 'note', data: { event: 'approach_applied', approach: id, packages: r.packages, files: r.files.length } }, { workspace });
  console.log(`Applied ${id} ${module.name}: ${r.files.length} files, packages ${r.packages.join(', ') || 'none'}.`);
  console.log(`Place its sections (${module.sections.map((s) => `${id}/${s}`).join(', ')}) in page frontmatter; see skills/${id.toLowerCase().replace('-', '')}/SKILL.md.`);
  return 0;
}

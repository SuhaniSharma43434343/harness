import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { assertValid } from '../core/schemas.mjs';
import { assertProjectExists, readJson, writeJsonAtomic } from '../core/workspace.mjs';
import { loadRegistry } from '../registry/load.mjs';
import { FILES, workflowVersion } from './spec.mjs';
import { APPROACH_STAGES } from './manager.mjs';

// The approach pause (workflow 2). The registry still decides which approaches a brief qualifies for
// (src/registry/select.mjs), but the operator chooses the one the site is built around, after a
// plain-language explanation of what each looks like. Without a choice the direction is not planned.

// What each approach looks like to a visitor, what it needs, and what it costs, in plain words.
export const APPROACH_GUIDE = {
  'APP-01': { looks: 'A clean, fast multi-page site: strong type, real photos and clear sections that read well on a phone.', fits: 'Any business. The quickest and cheapest to build, and the least "wow".' },
  'APP-02': { looks: 'The page tells a story as you scroll: sections hold in place while pictures and words reveal and change.', fits: 'Premium brands and launches with good photos. Feels cinematic; more work and more motion.' },
  'APP-03': { looks: 'A real 3D object or scene the visitor can turn and explore: a product, a room or data.', fits: 'Showrooms and products. A big "wow", slower on old phones, and it needs a 3D model.' },
  'APP-04': { looks: 'A designed 3D scene made in Spline, set into the page and reacting to clicks and scrolling.', fits: 'When you already have a Spline scene. Striking, and it adds weight to the page.' },
  'APP-05': { looks: 'A moving background drawn by the graphics card (light, liquid, grain) behind normal content.', fits: 'An accent behind a few sections, not the whole site.' },
  'APP-06': { looks: 'A small playable moment inside the site: one game mechanic, with a skip button.', fits: 'Only playful brands. Memorable, and the riskiest choice for a serious business.' },
  'APP-07': { looks: 'Everything together: the full site, the cinematic scroll and 3D, under strict speed budgets.', fits: 'A large flagship launch. The most expensive and slowest to build.' },
  'APP-08': { looks: 'A scroll-controlled animation made from a sequence of images, plus a depth effect that moves with the visitor.', fits: 'When you own or license the frames. Looks like video the visitor scrubs with the scroll.' },
};

const choiceFile = (dir) => join(dir, FILES.approachChoice);
export const readApproachChoice = (dir) => (existsSync(choiceFile(dir)) ? readJson(choiceFile(dir)) : null);

// approachOptions(dir) => [{ id, name, looks, fits, status, recommended, why }], from the registry's
// decision for this brief. status: "selected" (the brief qualifies), "possible" (the operator may
// choose it anyway) or "excluded" (not for this kind of project).
export function approachOptions(dir) {
  const decision = readJson(join(dir, FILES.decision));
  const { approaches } = loadRegistry();
  const names = new Map(approaches.map((a) => [a.id, a.name]));
  const selected = decision.decisions.filter((d) => d.selected).map((d) => d.approach);
  const recommended = selected.find((id) => id !== 'APP-01') ?? 'APP-01';
  return decision.decisions.map((d) => ({
    id: d.approach,
    name: names.get(d.approach),
    ...APPROACH_GUIDE[d.approach],
    status: d.selected ? 'selected' : d.matrixStatus === 'excluded' ? 'excluded' : 'possible',
    recommended: d.approach === recommended,
    why: d.reason,
  }));
}

// chooseApproach(project, id, { note }) => the choice. The operator may choose an approach the brief
// did not qualify for, but never one the matrix excludes for this kind of project.
export function chooseApproach(project, id, { note, ...opts } = {}) {
  const { dir } = assertProjectExists(project, opts);
  const file = join(dir, FILES.decision);
  if (!existsSync(file)) throw new PermissionDenied('There is no approach decision yet: the approach pause comes after research', { hint: `Run forge design run ${project} until it stops at the approach choice.` });
  const option = approachOptions(dir).find((o) => o.id === String(id).toUpperCase());
  if (!option) throw new PermissionDenied(`${id} is not an approach; choose APP-01 to APP-08`);
  if (option.status === 'excluded') throw new PermissionDenied(`${option.id} is excluded for this kind of project, so it cannot be chosen`);
  if (!note) throw new PermissionDenied('Choosing an approach needs your note: why this one');
  const decision = readJson(file);
  const entry = decision.decisions.find((d) => d.approach === option.id);
  if (!entry.selected) {
    const reg = loadRegistry().approaches.find((a) => a.id === option.id);
    entry.selected = true;
    entry.reason = `Chosen by the operator at the approach pause: ${note}`;
    entry.fallback = { ...(reg.fallback.approach ? { approach: reg.fallback.approach } : {}), description: reg.fallback.description };
    if (entry.matrixStatus === 'experimental') entry.needsApproval = 'B2';
    writeJsonAtomic(file, assertValid('approachDecision', decision));
  }
  const before = readApproachChoice(dir)?.approach ?? (existsSync(join(dir, FILES.direction)) ? readJson(join(dir, FILES.direction)).primaryApproach : undefined);
  if (before && before !== option.id) {
    const stale = APPROACH_STAGES.filter((s) => existsSync(join(dir, FILES[{ 'design-system': 'designSystem', 'section-plan': 'sectionPlan', 'motion-plan': 'motionPlan', 'asset-plan': 'assetPlan', 'media-prompts': 'mediaPrompts' }[s]])));
    writeJsonAtomic(join(dir, 'design', 'reference', 'stale.json'), { from: before, to: option.id, stages: stale });
  }
  const choice = { approach: option.id, name: option.name, note, chosenAt: new Date().toISOString() };
  writeJsonAtomic(choiceFile(dir), choice);
  ledger.append(project, { actor: 'operator', type: 'note', data: { event: 'approach_chosen', approach: option.id, note } }, opts);
  return choice;
}

// What stops the approach phase under workflow 2: the operator has not chosen yet.
export function approachBlockers(project, dir) {
  if (workflowVersion(dir) < 2 || readApproachChoice(dir) || !existsSync(join(dir, FILES.decision))) return [];
  return [`approach choice: see the options with forge design approach ${project}, then choose with forge design approach ${project} <APP-0N> --note "<why>"`];
}

// The options as plain lines for a terminal.
export function describeOptions(options) {
  const label = { selected: 'fits this brief', possible: 'possible if you want it', excluded: 'not for this kind of project' };
  return options.map((o) => `${o.id} ${o.name}${o.recommended ? ' (recommended)' : ''}: ${o.looks} ${o.fits} [${label[o.status]}]`);
}

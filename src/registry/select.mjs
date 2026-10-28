import { assertValid } from '../core/schemas.mjs';
import { describeCondition, evaluate } from './condition.mjs';
import { APPROACH_IDS, checkApproaches } from './load.mjs';

// Approval an experimental selection needs: the entry's own B1 or B2 if it names one
// (APP-06 confirms play at B1), otherwise B2, where the approaches are reviewed.
function approvalFor(entry) {
  return (entry.requiresApproval ?? []).find((c) => c === 'B1' || c === 'B2') ?? 'B2';
}

function decide(entry, brief, matrix) {
  const status = matrix.matrix[brief.projectType][entry.id];
  const base = { approach: entry.id, matrixStatus: status };
  const where = `${status} for ${brief.projectType}`;

  if (entry.id === 'APP-01') {
    return { ...base, selected: true, reason: 'Selected: APP-01 is the build method for every project.' };
  }
  if (status === 'excluded') {
    return { ...base, selected: false, reason: `Not selected: excluded for ${brief.projectType} in the selection matrix.` };
  }

  const select = evaluate(entry.selectWhen, brief);
  if (!select.holds) {
    return { ...base, selected: false, reason: `Not selected: the brief does not meet ${describeCondition(entry.selectWhen)}.` };
  }
  const reject = evaluate(entry.rejectWhen, brief);
  if (reject.holds) {
    return {
      ...base,
      selected: false,
      reason: `Not selected: rejected because ${reject.matched.join(' and ')}.`,
      matchedRules: select.matched.map((m) => `selectWhen: ${m}`).concat(reject.matched.map((m) => `rejectWhen: ${m}`)),
    };
  }
  const integrations = brief.integrations ?? [];
  const missing = (entry.requiresPlugins ?? []).filter((p) => !integrations.includes(p));
  if (missing.length) {
    return {
      ...base,
      selected: false,
      reason: `Not selected: needs the ${missing.join(', ')} plugin, which is not in brief.integrations.`,
      matchedRules: select.matched.map((m) => `selectWhen: ${m}`),
    };
  }

  const decision = {
    ...base,
    selected: true,
    reason: `Selected (${where}): ${select.matched.join(' and ')}.`,
    matchedRules: select.matched.map((m) => `selectWhen: ${m}`),
    fallback: {
      ...(entry.fallback.approach ? { approach: entry.fallback.approach } : {}),
      description: entry.fallback.description,
    },
  };
  if (status === 'experimental') decision.needsApproval = approvalFor(entry);
  return decision;
}

// selectApproaches(brief, registry, matrix, opts?) => ApproachDecision
// Pure and deterministic: the same inputs give the same decisions. opts.now fixes decidedAt
// (it defaults to the current time, the only input that is not in the arguments).
export function selectApproaches(brief, registry, matrix, opts = {}) {
  assertValid('brief', brief);
  assertValid('selectionMatrix', matrix);
  for (const entry of registry) assertValid('approach', entry, entry?.id ?? 'registry entry');
  checkApproaches(registry, matrix);

  const byId = new Map(registry.map((e) => [e.id, e]));
  const record = {
    project: brief.project,
    registryVersion: matrix.registryVersion,
    decidedAt: (opts.now ?? new Date()).toISOString(),
    decisions: APPROACH_IDS.map((id) => decide(byId.get(id), brief, matrix)),
  };
  return assertValid('approachDecision', record);
}

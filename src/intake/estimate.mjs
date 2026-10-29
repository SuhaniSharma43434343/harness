import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertValid } from '../core/schemas.mjs';
import { REGISTRY_DIR } from '../registry/load.mjs';

export const loadRates = (root = REGISTRY_DIR) => JSON.parse(readFileSync(join(root, 'estimate.json'), 'utf8'));

const add = (a, b) => ({ min: a.min + b.min, max: a.max + b.max });
const scale = (r, n) => ({ min: r.min * n, max: r.max * n });
const round = (r, step = 1) => ({ min: Math.round(r.min / step) * step, max: Math.round(r.max / step) * step });

// estimateScope(brief, decision?, opts?) => Estimate
// Pure and deterministic. Hours come from the tier, the page and form counts and the selected
// approaches; cost is hours times the operator's rates (registry/estimate.json, or opts.rates).
// Without a decision it estimates APP-01 only and says so in assumptions.
export function estimateScope(brief, decision, { rates = loadRates() } = {}) {
  const assumptions = [];
  const approaches = decision
    ? decision.decisions.filter((d) => d.selected).map((d) => d.approach)
    : ['APP-01'];
  if (!decision) assumptions.push('No approach decision yet: estimated as APP-01 only. Re-estimate after P3.');

  const forms = brief.features?.forms?.length ?? 0;
  const lines = [
    { item: `Setup and design system (tier ${brief.tier})`, hours: rates.setupHours[brief.tier] },
    { item: `${brief.pages.length} page(s)`, hours: scale(rates.hoursPerPage, brief.pages.length) },
  ];
  if (forms) lines.push({ item: `${forms} form(s)`, hours: scale(rates.hoursPerForm, forms) });
  for (const id of approaches) {
    const h = rates.approachHours[id];
    if (h && h.max > 0) lines.push({ item: `${id} module`, hours: h });
  }
  const build = lines.reduce((sum, l) => add(sum, l.hours), { min: 0, max: 0 });
  lines.push({ item: 'Quality review and repair', hours: round(scale(build, rates.qaShare)) });
  const hours = round(lines.reduce((sum, l) => add(sum, l.hours), { min: 0, max: 0 }));

  const currency = rates.currency;
  const cost = { ...round({ min: hours.min * rates.hourlyRate.min, max: hours.max * rates.hourlyRate.max }, 10), currency };
  let withinBudget = null;
  const budget = brief.constraints?.budget;
  if (budget) {
    if (budget.currency !== currency) {
      assumptions.push(`The client budget is in ${budget.currency} and the rates are in ${currency}; compare them by hand.`);
    } else {
      withinBudget = cost.max <= budget.max;
      if (cost.min > budget.max) assumptions.push(`Even the low estimate is over the client budget of ${budget.max} ${currency}: reduce scope before B1.`);
      else if (!withinBudget) assumptions.push(`The high estimate is over the client budget of ${budget.max} ${currency}.`);
    }
  }
  for (const field of brief.assumptions ?? []) assumptions.push(`Brief field ${field} is an assumption (use your recommendation).`);

  return assertValid('estimate', {
    project: brief.project,
    tier: brief.tier,
    pages: brief.pages.length,
    approaches,
    lines,
    hours,
    cost,
    withinBudget,
    assumptions,
    rateVersion: rates.rateVersion,
  });
}

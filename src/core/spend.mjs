import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PermissionDenied } from './errors.mjs';

// A hard spending limit that survives restarts: what was spent is kept in a file, and several
// limits can apply together (one per site, one for the whole test).

// Below this, a model call cannot do useful work, so it does not start.
const MIN_CALL_USD = 0.25;

export function createBudget({ file, limitUsd }) {
  const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).spentUsd : 0);
  return {
    limitUsd,
    spent: read,
    remaining: () => limitUsd - read(),
    add(usd) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ limitUsd, spentUsd: Math.round((read() + usd) * 10000) / 10000 }, null, 2) + '\n');
    },
  };
}

export const budgetsExhausted = (budgets) => budgets.some((b) => b.remaining() < MIN_CALL_USD);

// limitedWorker(worker, budgets): refuses a call with no money left, tells the worker the most it
// may spend (claude --max-budget-usd), and counts what it spent, including on a failed attempt.
export function limitedWorker(worker, budgets) {
  return async (job) => {
    if (budgetsExhausted(budgets)) {
      throw new PermissionDenied(`The spending limit is reached ($${Math.min(...budgets.map((b) => b.remaining())).toFixed(2)} left)`);
    }
    const maxBudgetUsd = Math.round(Math.min(...budgets.map((b) => b.remaining())) * 100) / 100;
    const count = (usd) => {
      for (const b of budgets) b.add(usd ?? 0);
    };
    try {
      const out = await worker({ ...job, maxBudgetUsd });
      count(out?.costUsd);
      return out;
    } catch (err) {
      count(err?.costUsd);
      throw err;
    }
  };
}

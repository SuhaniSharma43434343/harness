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

// limitedWorker(worker, budgets, { parallel }): refuses a call with no money left, tells the worker
// the most it may spend (claude --max-budget-usd), and counts what it spent, including on a failed
// attempt. Calls in flight at the same time each get a share: a call may spend at most the money no
// other running call has reserved, split across the task slots still free (`parallel` minus the
// calls running), so together they can never pass the limit. When the split is below the smallest
// useful call but the money is there, the call gets that smallest amount.
export function limitedWorker(worker, budgets, { parallel = 1 } = {}) {
  const reserved = new Map();
  let next = 0;
  return async (job) => {
    const held = [...reserved.values()].reduce((a, b) => a + b, 0);
    const free = Math.round((Math.min(...budgets.map((b) => b.remaining())) - held) * 100) / 100;
    const slots = Math.max(1, parallel - reserved.size);
    const share = Math.min(free, Math.max(MIN_CALL_USD, Math.floor((free / slots) * 100) / 100));
    if (budgetsExhausted(budgets) || share < MIN_CALL_USD) {
      throw new PermissionDenied(`The spending limit is reached ($${Math.max(0, free).toFixed(2)} left that no running task holds)`);
    }
    const key = next++;
    reserved.set(key, share);
    const count = (usd) => {
      for (const b of budgets) b.add(usd ?? 0);
    };
    try {
      const out = await worker({ ...job, maxBudgetUsd: share });
      count(out?.costUsd);
      return out;
    } catch (err) {
      count(err?.costUsd);
      throw err;
    } finally {
      reserved.delete(key);
    }
  };
}

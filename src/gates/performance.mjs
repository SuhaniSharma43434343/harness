import * as lighthouse from '../plugins/lighthouse/index.mjs';
import { JS_BUDGET_BYTES, siteReport } from '../site/build.mjs';
import { serveSite } from './serve.mjs';

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Performance: Lighthouse (mobile, simulated throttling) on up to maxPages pages, taking the
// median of `runs` runs for each metric, against the plan's budgets; plus the APP-01 JavaScript
// budget on the whole build. opts.adapters.lighthouse replaces the adapter: audit(url) => metrics.
export default {
  name: 'performance',
  version: '0.1.0',
  thresholds: { runs: 3, maxPages: 3, minScore: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200, jsBytes: JS_BUDGET_BYTES },
  run(ctx, t) {
    const adapter = ctx.opts.adapters?.lighthouse ?? lighthouse;
    const findings = [];
    const add = (id, message, at) => findings.push({ id, severity: 'serious', message, ...(at ? { location: at } : {}) });
    const { jsBytes } = siteReport(ctx.dist);
    if (jsBytes > t.jsBytes) add('js-budget', `The build ships ${jsBytes} bytes of JavaScript (budget ${t.jsBytes})`);

    return withServer(ctx, async (base) => {
      const metrics = { jsBytes, pages: 0 };
      const pages = ctx.routes().slice(0, t.maxPages);
      for (const route of pages) {
        const runs = [];
        for (let i = 0; i < t.runs; i++) {
          const r = await adapter.audit(base + route);
          if (r.runtimeError) throw new Error(`Lighthouse could not audit ${route}: ${r.runtimeError}`);
          runs.push(r);
        }
        const m = Object.fromEntries(['score', 'lcp', 'cls', 'tbt', 'fcp'].map((k) => [k, median(runs.map((r) => r[k]))]));
        metrics.pages++;
        for (const [k, v] of Object.entries(m)) metrics[`${route} ${k}`] = v === null ? null : Math.round(v * 1000) / 1000;
        if (m.score !== null && m.score < t.minScore) add('score', `${route} scores ${Math.round(m.score * 100)} (minimum ${Math.round(t.minScore * 100)})`, route);
        if (m.lcp !== null && m.lcp > t.lcpMs) add('lcp', `${route} Largest Contentful Paint is ${Math.round(m.lcp)} ms (budget ${t.lcpMs})`, route);
        if (m.cls !== null && m.cls > t.cls) add('cls', `${route} Cumulative Layout Shift is ${m.cls.toFixed(3)} (budget ${t.cls})`, route);
        if (m.tbt !== null && m.tbt > t.tbtMs) add('tbt', `${route} Total Blocking Time is ${Math.round(m.tbt)} ms (budget ${t.tbtMs})`, route);
      }
      return { findings, metrics };
    });
  },
};

// Lighthouse opens its own Chrome, so this gate only needs the static server, not a browser.
async function withServer(ctx, fn) {
  const server = await serveSite(ctx.dist);
  try {
    return await fn(server.url);
  } finally {
    await server.close();
  }
}

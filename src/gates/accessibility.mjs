import * as axe from '../plugins/axe-core/index.mjs';
import { location, withSite } from './browser.mjs';

// The widths axe runs at, and the extra reduced-motion pass (plan: WCAG 2.2 AA at mobile,
// tablet and desktop, and with motion reduced, since motion modules change the page then).
export const WIDTHS = [390, 768, 1440];
const PASSES = [...WIDTHS.map((width) => ({ width, reducedMotion: 'no-preference' })), { width: 390, reducedMotion: 'reduce' }];
const SEVERITY = { critical: 'critical', serious: 'serious', moderate: 'moderate', minor: 'minor' };

// Accessibility: no axe-core WCAG 2.2 A or AA violation on any page, at any width, with or without
// reduced motion. Each finding is the axe rule id (image-alt, label, color-contrast, ...) with
// axe's impact as its severity, once per page and rule.
export default {
  name: 'accessibility',
  version: '0.1.0',
  thresholds: {},
  run(ctx) {
    const adapter = ctx.opts.adapters?.axe ?? axe;
    return withSite(ctx, async ({ browser, base }) => {
      const seen = new Map();
      for (const pass of PASSES) {
        const context = await browser.newContext({ viewport: { width: pass.width, height: 900 }, reducedMotion: pass.reducedMotion });
        const page = await context.newPage();
        for (const route of ctx.routes()) {
          await page.goto(base + route, { waitUntil: 'load' });
          for (const v of await adapter.analyze(page)) {
            const key = `${route} ${v.id}`;
            const where = location(route, pass.width) + (pass.reducedMotion === 'reduce' ? ', reduced motion' : '');
            if (seen.has(key)) continue;
            seen.set(key, { id: v.id, severity: SEVERITY[v.impact] ?? 'moderate', message: `${route}: ${v.help} (${v.targets.slice(0, 3).join(', ')})`, location: where, evidence: v.helpUrl });
          }
        }
        await context.close();
      }
      const findings = [...seen.values()];
      return { findings, metrics: { pages: ctx.routes().length, passes: PASSES.length, violations: findings.length } };
    });
  },
};

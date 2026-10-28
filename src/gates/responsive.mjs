import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { location, withSite } from './browser.mjs';

// Plan widths: small and common phones, tablet, laptop, desktop, wide desktop.
export const WIDTHS = [360, 390, 768, 1280, 1440, 1920];

// Responsive: no page scrolls sideways at any width, and body text stays readable. Screenshots of
// every page at every width go to evidence/gates/responsive/ (opts.screenshots false skips them).
export default {
  name: 'responsive',
  version: '0.1.0',
  thresholds: { minFontPx: 12 },
  run(ctx, t) {
    const shots = ctx.opts.screenshots !== false ? join(ctx.projectDir, 'evidence', 'gates', 'responsive') : null;
    if (shots) mkdirSync(shots, { recursive: true });
    return withSite(ctx, async ({ browser, base }) => {
      const findings = [];
      const evidence = [];
      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        for (const route of ctx.routes()) {
          await page.goto(base + route, { waitUntil: 'load' });
          const r = await page.evaluate((minFont) => {
            const doc = document.documentElement;
            const overflow = doc.scrollWidth - doc.clientWidth;
            let culprit = null;
            if (overflow > 1) {
              for (const el of document.body.querySelectorAll('*')) {
                const box = el.getBoundingClientRect();
                if (box.right > doc.clientWidth + 1 && box.width > 0) {
                  culprit = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''} (${Math.round(box.width)}px wide)`;
                  break;
                }
              }
            }
            const small = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const el = node.parentElement;
              if (!node.textContent.trim() || !el || el.closest('script, style, noscript, .sr-only, .visually-hidden')) continue;
              const style = getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || el.getClientRects().length === 0) continue;
              if (parseFloat(style.fontSize) < minFont) small.push(`${node.textContent.trim().slice(0, 40)} (${style.fontSize})`);
            }
            return { overflow, culprit, small: small.slice(0, 3) };
          }, t.minFontPx);
          if (r.overflow > 1) findings.push({ id: 'horizontal-overflow', severity: 'serious', message: `${route} scrolls sideways by ${r.overflow}px at ${width}px${r.culprit ? `: ${r.culprit}` : ''}`, location: location(route, width) });
          if (r.small.length) findings.push({ id: 'small-text', severity: 'moderate', message: `${route} has text under ${t.minFontPx}px at ${width}px: ${r.small.join('; ')}`, location: location(route, width) });
          if (shots) {
            const file = join(shots, `${route === '/' ? 'home' : route.slice(1).replace(/\//g, '-')}-${width}.png`);
            await page.screenshot({ path: file, fullPage: true });
            evidence.push(ctx.rel(file));
          }
        }
        await context.close();
      }
      return { findings, evidence, metrics: { pages: ctx.routes().length, widths: WIDTHS.length } };
    });
  },
};

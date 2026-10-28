import { withSite } from './browser.mjs';

const MISSING = '/forge-gate-missing-page';

// Routes: every built page answers 200 and loads without console errors or failed requests,
// every internal link reaches a page, and an unknown path answers 404 with the 404 page.
export default {
  name: 'routes',
  version: '0.1.0',
  thresholds: { maxConsoleErrors: 0 },
  run(ctx, t) {
    return withSite(ctx, async ({ browser, base }) => {
      const findings = [];
      const add = (id, severity, message, at) => findings.push({ id, severity, message, ...(at ? { location: at } : {}) });
      const context = await browser.newContext();
      const page = await context.newPage();
      let errors = [];
      let failed = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('response', (r) => {
        if (r.status() >= 400 && r.request().resourceType() !== 'document' && r.url().startsWith(base)) failed.push(`${r.status()} ${r.url().slice(base.length)}`);
      });

      const routes = ctx.routes();
      const links = new Map();
      let consoleErrors = 0;
      for (const route of routes) {
        errors = [];
        failed = [];
        const res = await page.goto(base + route, { waitUntil: 'load' });
        if (!res || res.status() !== 200) add('route-status', 'critical', `${route} answered ${res?.status() ?? 'nothing'}`, route);
        await page.waitForTimeout(50);
        consoleErrors += errors.length;
        for (const e of errors) add('console-error', consoleErrors > t.maxConsoleErrors ? 'serious' : 'minor', `${route}: ${e.slice(0, 200)}`, route);
        for (const f of failed) add('asset-missing', 'serious', `${route} requested ${f}`, route);
        for (const href of await page.$$eval('a[href]', (as) => as.map((a) => a.href))) {
          if (!href.startsWith(base)) continue;
          const path = new URL(href).pathname;
          if (!links.has(path)) links.set(path, route);
        }
      }

      const known = new Set(routes.flatMap((r) => [r, `${r}/`, r === '/' ? '/index.html' : `${r}/index.html`]));
      let checked = 0;
      for (const [path, from] of links) {
        if (known.has(path)) continue;
        checked++;
        const res = await page.request.get(base + path, { maxRedirects: 3 });
        if (res.status() >= 400) add('broken-link', 'serious', `${from} links to ${path}, which answers ${res.status()}`, from);
      }
      const missing = await page.request.get(base + MISSING);
      if (missing.status() !== 404) add('no-404', 'serious', `An unknown path answered ${missing.status()} instead of 404`);
      else if (!ctx.files().includes('404.html')) add('no-404-page', 'moderate', 'There is no 404.html page');
      await context.close();
      return { findings, metrics: { routes: routes.length, links: links.size, linksChecked: checked, consoleErrors } };
    });
  },
};

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '../approaches/index.mjs';
import { markdownBlocks, readMarkdown, visibleText } from './context.mjs';

// Every approach the decision selects is on a page: one of its sections is used in the site's
// pages (site/src/content/pages), and a composite (APP-07) has sections of each part on one
// page. An approach whose module is installed but never placed is not working (plan, M4).
function unusedApproaches(ctx) {
  const pagesDir = join(ctx.projectDir, 'site', 'src', 'content', 'pages');
  const decision = ctx.json('design/approach-decision.json', null);
  if (!decision || !existsSync(pagesDir)) return [];
  const pages = readdirSync(pagesDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(ctx.read(`site/src/content/pages/${f}`))?.[1] ?? '';
      return new Set([...front.matchAll(/^\s*(?:-\s*)?use:\s*["']?(APP-\d\d)\//gm)].map((m) => m[1]));
    });
  const findings = [];
  for (const d of decision.decisions.filter((x) => x.selected && x.approach !== 'APP-01')) {
    const module = MODULES.get(d.approach);
    if (!module) continue;
    const parts = module.composedOf?.filter((a) => a !== 'APP-01') ?? [d.approach];
    if (pages.some((used) => parts.every((a) => used.has(a)))) continue;
    const what = module.composedOf ? `sections of ${parts.join(' and ')} on one page` : `one of its sections (${module.sections.map((x) => `${d.approach}/${x}`).join(', ')})`;
    findings.push({ id: 'approach-unused', severity: 'serious', message: `${d.approach} ${module.name} is selected, but no page uses it: place ${what} in the page frontmatter`, location: d.approach });
  }
  return findings;
}

// Content parity (plan target 100%): every block of the locked content in content/pages/ appears,
// word for word, on its route. Locked means status: locked (set at B3).
export default {
  name: 'content-parity',
  version: '0.1.0',
  thresholds: { minParity: 1 },
  run(ctx, t) {
    const dir = join(ctx.projectDir, 'content', 'pages');
    if (!ctx.exists('content/pages')) {
      return { status: 'skipped', findings: [], error: { code: 'NO_LOCKED_CONTENT', message: 'No content/pages/: content is locked at B3, so parity cannot be checked yet' } };
    }
    const routes = new Set(ctx.routes());
    const findings = [];
    let total = 0;
    let found = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
      const { data, body } = readMarkdown(ctx.read(`content/pages/${file}`));
      if (data.status && data.status !== 'locked') continue;
      const route = file === 'index.md' ? '/' : `/${file.replace(/\.md$/, '')}`;
      const blocks = markdownBlocks(body);
      total += blocks.length;
      if (!routes.has(route)) {
        findings.push({ id: 'route-missing', severity: 'critical', message: `Locked page ${file} has no route ${route}`, location: route });
        continue;
      }
      const text = visibleText(ctx.doc(route));
      for (const block of blocks) {
        if (text.includes(block)) found++;
        else findings.push({ id: 'text-missing', severity: 'serious', message: `Locked text is not on the page: "${block.slice(0, 120)}"`, location: route });
      }
    }
    findings.push(...unusedApproaches(ctx));
    const parity = total ? found / total : 0;
    if (!total) findings.push({ id: 'no-content', severity: 'critical', message: 'No locked content blocks to compare' });
    else if (parity < t.minParity && !findings.length) findings.push({ id: 'parity', severity: 'serious', message: `Parity ${(parity * 100).toFixed(1)}%` });
    return { findings, metrics: { blocks: total, matched: found, parity: Math.round(parity * 1000) / 1000 } };
  },
};

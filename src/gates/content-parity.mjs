import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { markdownBlocks, readMarkdown, visibleText } from './context.mjs';

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
    const parity = total ? found / total : 0;
    if (!total) findings.push({ id: 'no-content', severity: 'critical', message: 'No locked content blocks to compare' });
    else if (parity < t.minParity && !findings.length) findings.push({ id: 'parity', severity: 'serious', message: `Parity ${(parity * 100).toFixed(1)}%` });
    return { findings, metrics: { blocks: total, matched: found, parity: Math.round(parity * 1000) / 1000 } };
  },
};

import { loadTool } from '../../tools/load.mjs';

export const id = 'axe-core';
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// analyze(page) => violations: runs axe-core in a Playwright page for the WCAG 2.2 A and AA rules.
export async function analyze(page, { tags = TAGS } = {}) {
  const axe = await loadTool('axe-core');
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate((runOnly) => window.axe.run(document, { runOnly: { type: 'tag', values: runOnly }, resultTypes: ['violations'] }), tags);
  return result.violations.map((v) => ({ id: v.id, impact: v.impact ?? 'moderate', help: v.help, helpUrl: v.helpUrl, targets: v.nodes.map((n) => n.target.join(' ')) }));
}

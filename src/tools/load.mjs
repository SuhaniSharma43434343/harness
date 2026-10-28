import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';
import { Unavailable } from '../core/errors.mjs';
import { ROOT } from '../core/workspace.mjs';

const HINTS = {
  playwright: 'Install it with npm install --no-save playwright && npx playwright install chromium, or run scripts/setup.sh --with-test-tools.',
  'axe-core': 'Install it with npm install --no-save axe-core, or run scripts/setup.sh --with-test-tools.',
  lighthouse: 'Install it with npm install --no-save lighthouse, or run scripts/setup.sh --with-test-tools.',
};

// Loads an optional test tool (Playwright, axe-core, Lighthouse). They are not dependencies
// of the harness, because they are large and need a browser; the gates call them through this
// loader, and a missing tool is a typed Unavailable error, which a gate reports as status
// 'error', never as a pass. It looks in the harness's own node_modules, then in NODE_PATH.
export async function loadTool(name) {
  const paths = [join(ROOT, 'node_modules'), ...(process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)];
  const require = createRequire(join(ROOT, 'package.json'));
  for (const base of paths) {
    let resolved;
    try {
      resolved = require.resolve(name, { paths: [base] });
    } catch {
      continue;
    }
    const mod = await import(resolved.startsWith('/') ? `file://${resolved}` : resolved);
    return mod.default ?? mod;
  }
  throw new Unavailable(`${name} is not installed`, { hint: HINTS[name] ?? `Install ${name}.`, details: { tool: name } });
}

// A Chromium browser through Playwright, or Unavailable.
export async function launchBrowser() {
  const { chromium } = await loadTool('playwright');
  try {
    return await chromium.launch();
  } catch (err) {
    throw new Unavailable('Playwright could not start Chromium', { hint: `${err.message.split('\n')[0]} Run npx playwright install chromium.` });
  }
}

import { launchBrowser, loadTool } from '../../tools/load.mjs';

// Playwright adapter: a headless Chromium, or Unavailable. The browser gates take it as
// opts.adapters.playwright, so tests and the plugin host (T07) can pass their own.
export const id = 'playwright';
export const launch = () => launchBrowser();
export async function executablePath() {
  const { chromium } = await loadTool('playwright');
  return chromium.executablePath();
}

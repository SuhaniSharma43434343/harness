import { Unavailable } from '../../core/errors.mjs';
import { loadTool } from '../../tools/load.mjs';
import { executablePath } from '../playwright/index.mjs';

export const id = 'lighthouse';

// audit(url) => one Lighthouse performance run as plain numbers (milliseconds, and a 0-1 score).
// Chrome comes from Playwright's Chromium, so no separate Chrome install is needed.
export async function audit(url, { formFactor = 'mobile' } = {}) {
  const lighthouse = await loadTool('lighthouse');
  const { launch } = await loadTool('chrome-launcher').catch(() => {
    throw new Unavailable('chrome-launcher is not installed', { hint: 'It comes with lighthouse: npm install --no-save lighthouse.' });
  });
  const chrome = await launch({ chromePath: await executablePath(), chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'], logLevel: 'silent' });
  try {
    const settings = formFactor === 'desktop'
      ? { formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttlingMethod: 'simulate' }
      : { formFactor: 'mobile', throttlingMethod: 'simulate' };
    const r = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] }, { extends: 'lighthouse:default', settings });
    const a = r.lhr.audits;
    const n = (k) => (typeof a[k]?.numericValue === 'number' ? a[k].numericValue : null);
    return {
      score: r.lhr.categories.performance.score,
      lcp: n('largest-contentful-paint'),
      cls: n('cumulative-layout-shift'),
      tbt: n('total-blocking-time'),
      fcp: n('first-contentful-paint'),
      transferBytes: n('total-byte-weight'),
      runtimeError: r.lhr.runtimeError?.message ?? null,
    };
  } finally {
    await chrome.kill();
  }
}

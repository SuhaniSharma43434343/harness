import * as playwright from '../plugins/playwright/index.mjs';
import { serveSite } from './serve.mjs';

// Serves site/dist and opens a browser for one gate run. opts.browser lets runGates share one
// browser across gates; opts.adapters.playwright replaces the adapter (the plugin host, T07,
// will pass the enabled plugin here). A missing Playwright or Chromium throws Unavailable,
// which runGate reports as status 'error'.
export async function withSite(ctx, fn) {
  const server = await serveSite(ctx.dist);
  const shared = ctx.opts.browser;
  let browser;
  try {
    browser = shared ?? (await (ctx.opts.adapters?.playwright ?? playwright).launch());
    return await fn({ browser, base: server.url });
  } finally {
    if (!shared && browser) await browser.close();
    await server.close();
  }
}

export const location = (route, width) => (width ? `${route} @ ${width}px` : route);

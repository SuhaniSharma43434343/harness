// Device profiles for the approach fallback tests, applied before any page script runs.
export const CAPABLE = () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
export const LOW_END = () => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 });
export const SLOW_NETWORK = () => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'connection', { get: () => ({ effectiveType: '3g', saveData: false }) });
};
export const NO_WEBGL = () => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return /webgl/i.test(type) ? null : original.call(this, type, ...rest);
  };
};

// Opens a page with a profile and waits for the approach to record its mode on <html>.
export async function openWith(browser, url, approach, { reducedMotion = 'no-preference', init = CAPABLE, block, viewport = { width: 390, height: 844 }, hasTouch = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion, hasTouch });
  await context.addInitScript(init);
  if (block) await context.route(block, (r) => r.abort());
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => requests.push({ url: r.url(), at: Date.now() }));
  await page.goto(url, { waitUntil: 'load' });
  const loadedAt = Date.now();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
  await page.waitForFunction((a) => document.documentElement.dataset[a], approach, { timeout: 20_000 });
  const mode = await page.evaluate((a) => ({ mode: document.documentElement.dataset[a], reason: document.documentElement.dataset[`${a}Reason`] ?? null }), approach);
  return { context, page, errors, requests, loadedAt, mode };
}

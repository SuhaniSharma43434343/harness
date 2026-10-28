import { withSite } from './browser.mjs';

// A plausible value for each kind of field, so a filled form passes the browser's own checks.
const SAMPLE = { email: 'forge-test@example.com', tel: '+15550100', url: 'https://example.com', number: '1', date: '2030-01-15' };

// Fills every visible field of the form at `selector` with sample values.
async function fill(page, selector) {
  const fields = await page.$$(`${selector} input, ${selector} textarea, ${selector} select`);
  for (const f of fields) {
    const info = await f.evaluate((el) => ({ tag: el.tagName.toLowerCase(), type: (el.getAttribute('type') ?? 'text').toLowerCase(), hidden: el.type === 'hidden' || el.offsetParent === null }));
    if (info.hidden || ['submit', 'button', 'reset', 'file'].includes(info.type)) continue;
    if (info.tag === 'select') await f.selectOption({ index: 1 }).catch(() => f.selectOption({ index: 0 }));
    else if (info.type === 'checkbox' || info.type === 'radio') await f.check();
    else await f.fill(SAMPLE[info.type] ?? 'Forge gate test');
  }
}

const state = (page, selector) => page.$eval(`${selector} .form-status`, (el) => el.dataset.state ?? '').catch(() => null);

async function waitForState(page, selector, want) {
  for (let i = 0; i < 40; i++) {
    const s = await state(page, selector);
    if (s === want) return true;
    if (s && s !== 'sending' && s !== want) return false;
    await page.waitForTimeout(50);
  }
  return false;
}

// Forms: every form has an endpoint, the browser stops an empty required submission, and a
// filled submission shows the success state when the endpoint answers and the error state when
// it fails. The endpoint is intercepted in the browser, so the gate never sends real data.
export default {
  name: 'forms',
  version: '0.1.0',
  thresholds: {},
  run(ctx) {
    return withSite(ctx, async ({ browser, base }) => {
      const findings = [];
      const add = (id, severity, message, at) => findings.push({ id, severity, message, location: at });
      let count = 0;
      for (const route of ctx.routes()) {
        const forms = ctx.doc(route).querySelectorAll('form');
        for (let i = 0; i < forms.length; i++) {
          count++;
          const name = forms[i].getAttribute('data-forge-form') ?? `form ${i + 1}`;
          const selector = forms[i].getAttribute('data-forge-form') ? `form[data-forge-form="${name}"]` : `form >> nth=${i}`;
          const at = `${route} (${name})`;
          const action = forms[i].getAttribute('action');
          if (!action) {
            add('no-endpoint', 'critical', `${at} has no action, so nothing is sent`, at);
            continue;
          }
          if (!forms[i].querySelector('.form-status')) add('no-status', 'serious', `${at} has no .form-status element to show the result`, at);

          const context = await browser.newContext();
          const page = await context.newPage();
          let sent = 0;
          let answer = 200;
          await page.route((url) => url.pathname === new URL(action, base + route).pathname, (r) => {
            sent++;
            return r.fulfill({ status: answer, contentType: 'application/json', body: answer < 400 ? '{"ok":true}' : '{"ok":false}' });
          });
          await page.goto(base + route, { waitUntil: 'load' });

          // An empty submission must be stopped by the required fields.
          await page.click(`${selector} [type=submit]`);
          await page.waitForTimeout(150);
          const emptyState = await state(page, selector);
          if (sent > 0 || emptyState === 'success' || emptyState === 'sending') add('no-validation', 'serious', `${at} sent an empty submission: mark its required fields required`, at);

          if (!forms[i].querySelector('.form-status')) {
            await context.close();
            continue;
          }
          await page.goto(base + route, { waitUntil: 'load' });
          sent = 0;
          await fill(page, selector);
          await page.click(`${selector} [type=submit]`);
          if (!(await waitForState(page, selector, 'success'))) add('no-success-state', 'serious', `${at} did not show the success state after the endpoint answered 200`, at);
          else if (sent === 0) add('not-sent', 'critical', `${at} showed success without sending anything`, at);

          answer = 500;
          await page.goto(base + route, { waitUntil: 'load' });
          await fill(page, selector);
          await page.click(`${selector} [type=submit]`);
          if (!(await waitForState(page, selector, 'error'))) add('no-error-state', 'serious', `${at} did not show the error state after the endpoint answered 500`, at);
          await context.close();
        }
      }
      return { findings, metrics: { forms: count } };
    });
  },
};

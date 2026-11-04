import { location, withSite } from './browser.mjs';

// Interactions: every control a visitor can operate actually does something. Forms have their
// own gate; this one drives the rest of what a page declares interactive - disclosure toggles,
// <details>, tabs, dialog openers and carousels - and checks the page works by touch: at phone
// width the navigation is reachable and touch controls are big enough to hit. A page with none
// of these widgets passes with nothing tested. A control that changes nothing when operated is
// a defect, because a visitor cannot tell a broken control from a slow one.

const PHONE = 390;
const DESKTOP = 1280;
const CAP = 8; // widgets of one kind driven per page, so a long FAQ cannot eat the budget

// Runs in the page: what activating this control should change. Compared before and after as
// JSON, so any of these moving counts as the control working.
function snap(el) {
  const vis = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const id = el.getAttribute('aria-controls');
  const target = id ? document.getElementById(id) : null;
  return {
    expanded: el.getAttribute('aria-expanded'),
    selected: el.getAttribute('aria-selected'),
    open: el.closest('details')?.open ?? null,
    targetVisible: target ? vis(target) : null,
    targetClass: target ? target.className : null,
  };
}

const name = async (el) => ((await el.getAttribute('aria-label')) ?? (await el.textContent()) ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'unnamed';

async function driveWidgets(context, base, route, add, metrics) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await page.goto(base + route, { waitUntil: 'load' });
  errors.length = 0; // load-time errors belong to the routes gate; only interaction errors count here
  const at = location(route);

  // Disclosure toggles: aria-expanded must flip, or what it controls must appear or hide.
  for (const el of (await page.$$('button[aria-expanded], [role="button"][aria-expanded], a[aria-expanded]')).slice(0, CAP)) {
    if (!(await el.isVisible())) continue;
    metrics.toggles++;
    const before = await el.evaluate(snap);
    await el.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(250);
    const after = await el.evaluate(snap).catch(() => before);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      add('toggle-dead', 'serious', `A toggle on ${route} ("${await name(el)}") changes nothing when clicked: aria-expanded stays ${before.expanded}`, at);
    } else {
      await el.click({ timeout: 500 }).catch(() => {}); // put the page back
    }
  }

  // <details>: the browser opens these itself, so one that stays shut has a script fighting it.
  for (const el of (await page.$$('details > summary')).slice(0, CAP)) {
    if (!(await el.isVisible())) continue;
    metrics.details++;
    const before = await el.evaluate((s) => s.closest('details').open);
    await el.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
    const after = await el.evaluate((s) => s.closest('details').open).catch(() => before);
    if (before === after) add('details-dead', 'serious', `A collapsed section on ${route} ("${await name(el)}") does not open when clicked`, at);
    else await el.click({ timeout: 500 }).catch(() => {});
  }

  // Tabs: clicking an unselected tab must select it or change its panel.
  for (const list of (await page.$$('[role="tablist"]')).slice(0, CAP)) {
    const tabs = await list.$$('[role="tab"]');
    if (tabs.length < 2) continue;
    let target = null;
    for (const tab of tabs) {
      if ((await tab.getAttribute('aria-selected')) !== 'true' && (await tab.isVisible())) {
        target = tab;
        break;
      }
    }
    if (!target) continue;
    metrics.tabs++;
    const before = await target.evaluate(snap);
    await target.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(250);
    const after = await target.evaluate(snap).catch(() => before);
    if (after.selected !== 'true' && JSON.stringify(before) === JSON.stringify(after)) {
      add('tab-dead', 'serious', `A tab on ${route} ("${await name(target)}") does not select when clicked`, at);
    }
  }

  // Dialog openers: something must actually open.
  for (const el of (await page.$$('[aria-haspopup="dialog"], [popovertarget], [data-modal-open], [data-dialog-open]')).slice(0, CAP)) {
    if (!(await el.isVisible())) continue;
    metrics.dialogs++;
    await el.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(250);
    const opened = await page.evaluate(() => {
      const vis = (n) => !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
      if ([...document.querySelectorAll('dialog')].some((d) => d.open && vis(d))) return true;
      if ([...document.querySelectorAll('[popover]')].some((p) => { try { return p.matches(':popover-open'); } catch { return false; } })) return true;
      return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(vis);
    });
    if (!opened) add('modal-dead', 'serious', `A dialog opener on ${route} ("${await name(el)}") opens nothing when clicked`, at);
    else await page.keyboard.press('Escape').catch(() => {});
  }

  // Carousels: the next control must move, swap or reveal something.
  for (const region of (await page.$$('[data-carousel], [aria-roledescription="carousel"], .carousel')).slice(0, CAP)) {
    const next = await region.$('[data-next], [aria-label*="next" i], .next, button[class*="next" i]');
    if (!next || !(await next.isVisible())) continue;
    metrics.carousels++;
    const state = () => region.evaluate((el) => {
      const kids = [...el.querySelectorAll('*')].slice(0, 40);
      const track = kids.find((n) => n.scrollWidth > n.clientWidth + 4) ?? el;
      return JSON.stringify([Math.round(track.scrollLeft), ...kids.map((n) => { const s = getComputedStyle(n); return `${s.transform}|${s.opacity}|${n.className}`; })]);
    });
    const before = await state();
    await next.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(700);
    if ((await state().catch(() => before)) === before) add('carousel-dead', 'serious', `A carousel control on ${route} changes nothing when clicked`, at);
  }

  for (const e of errors.slice(0, 3)) add('interaction-error', 'serious', `${route}: a script error while operating the page: ${e}`, at);
  await page.close();
}

async function phoneChecks(context, base, route, add, metrics, t) {
  const page = await context.newPage();
  await page.goto(base + route, { waitUntil: 'load' });
  const at = location(route, PHONE);
  metrics.navChecks++;

  // Navigation must be reachable by touch: visible links, or a visible toggle that reveals them.
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const nav = await page.evaluate((visSrc) => {
    const vis = new Function(`return (${visSrc})`)();
    const links = [...document.querySelectorAll('nav a[href]')];
    const toggles = [...document.querySelectorAll('header button, nav button, button[aria-label*="menu" i], [aria-haspopup="menu"]')].filter(vis);
    return { links: links.length, visible: links.filter(vis).length, toggles: toggles.length };
  }, vis.toString());
  if (nav.links > 0 && nav.visible === 0) {
    if (nav.toggles === 0) {
      add('nav-unreachable', 'critical', `${route} hides every navigation link at ${PHONE}px and offers no visible menu button`, at);
    } else {
      const btn = await page.$('header button:visible, nav button:visible, button[aria-label*="menu" i]:visible');
      await btn?.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(300);
      const after = await page.evaluate((visSrc) => {
        const vis = new Function(`return (${visSrc})`)();
        return [...document.querySelectorAll('nav a[href]')].filter(vis).length;
      }, vis.toString());
      if (!after) add('nav-unreachable', 'critical', `${route}: the menu button at ${PHONE}px does not reveal the navigation`, at);
    }
  }

  // Touch controls a thumb cannot hit. Advisory: it never blocks on its own, because dense but
  // deliberate designs exist, but it is reported for the record. Inline text links are exempt.
  const small = await page.evaluate((min) => {
    const out = [];
    for (const el of document.querySelectorAll('button, [role="button"], input[type="submit"]')) {
      if (el.getClientRects().length === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.width < min || r.height < min)) {
        out.push(`"${((el.getAttribute('aria-label') ?? el.textContent) || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)}" (${Math.round(r.width)}x${Math.round(r.height)}px)`);
      }
    }
    return out.slice(0, 3);
  }, t.minTapPx);
  for (const s of small) add('small-tap-target', 'moderate', `${route} has a touch control under ${t.minTapPx}px at ${PHONE}px: ${s}`, at);
  await page.close();
}

export default {
  name: 'interactions',
  version: '0.1.0',
  thresholds: { minTapPx: 24 },
  run(ctx, t) {
    return withSite(ctx, async ({ browser, base }) => {
      const findings = [];
      const add = (id, severity, message, loc) => findings.push({ id, severity, message, location: loc });
      const metrics = { toggles: 0, details: 0, tabs: 0, dialogs: 0, carousels: 0, navChecks: 0 };
      const desktop = await browser.newContext({ viewport: { width: DESKTOP, height: 900 }, reducedMotion: 'reduce' });
      const phone = await browser.newContext({ viewport: { width: PHONE, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
      try {
        for (const route of ctx.routes()) {
          await driveWidgets(desktop, base, route, add, metrics);
          await phoneChecks(phone, base, route, add, metrics, t);
        }
      } finally {
        await desktop.close();
        await phone.close();
      }
      return { findings, metrics };
    });
  },
};

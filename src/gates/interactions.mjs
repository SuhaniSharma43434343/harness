import { location, withSite } from './browser.mjs';

// Interactions: the controls a visitor can operate actually do something. Forms have their own
// gate; this one drives what a page declares interactive - disclosure toggles, <details>, tabs,
// dialog openers and carousels (up to 8 of each kind per page) - and checks the page works by
// touch: at phone width the navigation is reachable and touch controls are big enough to hit.
// A page with none of these widgets passes with nothing tested. A control that changes nothing
// when operated is a defect, because a visitor cannot tell a broken control from a slow one.
//
// Robustness rules, each bought by a real failure mode:
// - The page is reloaded before each widget kind, so a control that leaves an overlay or a
//   broken state behind cannot poison the later checks on the same route.
// - A control whose click NAVIGATES is a working link, never a dead control: the check goes
//   back and moves on. Labels are read before clicking, because after a navigation the handle
//   is gone and reading it throws.
// - Every per-control check is wrapped, so one broken widget is one finding, not a gate error.

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

// Runs in the page: how many dialogs/popovers are open and visible right now.
function openDialogCount() {
  const vis = (n) => !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).opacity !== '0';
  let n = [...document.querySelectorAll('dialog')].filter((d) => d.open && vis(d)).length;
  n += [...document.querySelectorAll('[popover]')].filter((p) => { try { return p.matches(':popover-open'); } catch { return false; } }).length;
  n += [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((d) => !d.closest('dialog') && vis(d)).length;
  return n;
}

// Runs in the page: visible links, page-wide (a menu may live outside <nav>).
const visibleLinkCount = () => [...document.querySelectorAll('a[href]')].filter((a) => a.getClientRects().length > 0 && getComputedStyle(a).visibility !== 'hidden').length;

const label = async (el) => {
  try {
    return (((await el.getAttribute('aria-label')) ?? (await el.textContent()) ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)) || 'unnamed';
  } catch {
    return 'unnamed';
  }
};

// One widget kind on a fresh load of the route. fn gets the page; throwing inside fn never
// takes the gate down - the error becomes a finding, because a page that breaks under ordinary
// clicks is itself a defect.
async function onFreshPage(context, base, route, add, kind, fn) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  try {
    await page.goto(base + route, { waitUntil: 'load' });
    errors.length = 0; // load-time errors belong to the routes gate
    await fn(page);
    for (const e of errors.slice(0, 2)) add('interaction-error', 'serious', `${route}: a script error while operating the ${kind}: ${e}`, location(route));
  } catch (err) {
    add('interaction-check-error', 'serious', `${route}: the page broke while the ${kind} were operated: ${String(err.message).slice(0, 160)}`, location(route));
  } finally {
    await page.close().catch(() => {});
  }
}

// After a click, a changed URL means the control navigated: a working link. Go back for the
// remaining widgets and report nothing.
async function navigated(page, before, base, route) {
  if (page.url() === before) return false;
  await page.goto(base + route, { waitUntil: 'load' }).catch(() => {});
  return true;
}

async function driveWidgets(context, base, route, add, metrics) {
  const at = location(route);

  // Disclosure toggles: aria-expanded must flip, or what it controls must appear or hide.
  await onFreshPage(context, base, route, add, 'toggles', async (page) => {
    for (const el of (await page.$$('button[aria-expanded], [role="button"][aria-expanded], a[aria-expanded]')).slice(0, CAP)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      metrics.toggles++;
      const name = await label(el);
      const url = page.url();
      const before = await el.evaluate(snap);
      await el.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(250);
      if (await navigated(page, url, base, route)) continue;
      const after = await el.evaluate(snap).catch(() => before);
      if (JSON.stringify(before) === JSON.stringify(after)) {
        add('toggle-dead', 'serious', `A toggle on ${route} ("${name}") changes nothing when clicked: aria-expanded stays ${before.expanded}`, at);
      } else {
        await el.click({ timeout: 500 }).catch(() => {}); // put the page back, best effort
      }
    }
  });

  // <details>: the browser opens these itself, so one that stays shut has a script fighting it.
  await onFreshPage(context, base, route, add, 'collapsed sections', async (page) => {
    for (const el of (await page.$$('details > summary')).slice(0, CAP)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      metrics.details++;
      const name = await label(el);
      const before = await el.evaluate((s) => s.closest('details').open);
      await el.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(150);
      const after = await el.evaluate((s) => s.closest('details').open).catch(() => before);
      if (before === after) add('details-dead', 'serious', `A collapsed section on ${route} ("${name}") does not open when clicked`, at);
      else await el.click({ timeout: 500 }).catch(() => {});
    }
  });

  // Tabs: clicking an unselected tab must select it or change its panel.
  await onFreshPage(context, base, route, add, 'tabs', async (page) => {
    for (const list of (await page.$$('[role="tablist"]')).slice(0, CAP)) {
      const tabs = await list.$$('[role="tab"]');
      if (tabs.length < 2) continue;
      let target = null;
      for (const tab of tabs) {
        if ((await tab.getAttribute('aria-selected')) !== 'true' && (await tab.isVisible().catch(() => false))) {
          target = tab;
          break;
        }
      }
      if (!target) continue;
      metrics.tabs++;
      const name = await label(target);
      const url = page.url();
      const before = await target.evaluate(snap);
      await target.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(250);
      if (await navigated(page, url, base, route)) continue;
      const after = await target.evaluate(snap).catch(() => before);
      if (after.selected !== 'true' && JSON.stringify(before) === JSON.stringify(after)) {
        add('tab-dead', 'serious', `A tab on ${route} ("${name}") does not select when clicked`, at);
      }
    }
  });

  // Dialog openers: a NEW dialog must appear for this very click (counted before and after, so
  // another opener's leftover modal can never vouch for a dead one). If closing fails, the page
  // is reloaded rather than letting the overlay block the remaining openers.
  await onFreshPage(context, base, route, add, 'dialog openers', async (page) => {
    const openers = (await page.$$('[aria-haspopup="dialog"], [popovertarget], [data-modal-open], [data-dialog-open]')).length;
    for (let i = 0; i < Math.min(openers, CAP); i++) {
      const el = (await page.$$('[aria-haspopup="dialog"], [popovertarget], [data-modal-open], [data-dialog-open]'))[i];
      if (!el || !(await el.isVisible().catch(() => false))) continue;
      metrics.dialogs++;
      const name = await label(el);
      const url = page.url();
      const before = await page.evaluate(openDialogCount);
      await el.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(250);
      if (await navigated(page, url, base, route)) continue;
      const after = await page.evaluate(openDialogCount).catch(() => before);
      if (after <= before) {
        add('modal-dead', 'serious', `A dialog opener on ${route} ("${name}") opens nothing when clicked`, at);
        continue;
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(150);
      const closed = await page.evaluate(openDialogCount).catch(() => after);
      // A modal that Escape does not close is common; reload so it cannot block what follows.
      if (closed > before) await page.goto(base + route, { waitUntil: 'load' }).catch(() => {});
    }
  });

  // Carousels: the next control must move, swap or reveal something.
  await onFreshPage(context, base, route, add, 'carousels', async (page) => {
    for (const region of (await page.$$('[data-carousel], [aria-roledescription="carousel"], .carousel')).slice(0, CAP)) {
      const next = await region.$('[data-next], [aria-label*="next" i], .next, button[class*="next" i]');
      if (!next || !(await next.isVisible().catch(() => false))) continue;
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
  });
}

// Runs in the page: the menu-toggle candidates at phone width, most likely first - a toggle
// that says what it is (aria-expanded/haspopup, or a menu-ish name) before any other header
// button, so a search or theme button in front of the hamburger is not mistaken for it.
function navState() {
  const vis = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  const links = [...document.querySelectorAll('nav a[href]')];
  const all = [...document.querySelectorAll('header button, nav button, button[aria-label*="menu" i], [aria-haspopup="menu"], button[aria-label*="navigation" i]')].filter(vis);
  const score = (b) => {
    const name = `${b.getAttribute('aria-label') ?? ''} ${b.className} ${b.id} ${b.textContent}`.toLowerCase();
    let s = 0;
    if (b.hasAttribute('aria-expanded') || b.hasAttribute('aria-controls') || b.getAttribute('aria-haspopup') === 'menu') s += 2;
    if (/menu|nav|burger|bars|open|toggle/.test(name)) s += 3;
    if (/search|cart|bag|theme|dark|light|account|login/.test(name)) s -= 3;
    return s;
  };
  const ranked = all.map((b, i) => ({ i, s: score(b) })).sort((a, b) => b.s - a.s).map((x) => x.i);
  for (let i = 0; i < all.length; i++) all[i].setAttribute('data-forge-nav-candidate', String(i));
  return { links: links.length, visible: links.filter(vis).length, candidates: ranked };
}

async function phoneChecks(context, base, route, add, metrics, t) {
  const page = await context.newPage();
  try {
    await page.goto(base + route, { waitUntil: 'load' });
    const at = location(route, PHONE);
    metrics.navChecks++;

    // Navigation must be reachable by touch: visible nav links, or a toggle that reveals links.
    const nav = await page.evaluate(navState);
    if (nav.links > 0 && nav.visible === 0) {
      if (!nav.candidates.length) {
        add('nav-unreachable', 'critical', `${route} hides every navigation link at ${PHONE}px and offers no visible menu button`, at);
      } else {
        // Try each candidate, best first: ANY of them revealing links (anywhere on the page,
        // since menus often live outside <nav>) means the navigation is reachable.
        let reached = false;
        for (const i of nav.candidates.slice(0, 4)) {
          const linksBefore = await page.evaluate(visibleLinkCount);
          const btn = await page.$(`[data-forge-nav-candidate="${i}"]`);
          if (!btn) continue;
          await btn.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(300);
          if ((await page.evaluate(visibleLinkCount).catch(() => linksBefore)) > linksBefore) {
            reached = true;
            break;
          }
          // This one opened nothing (or something linkless); start clean for the next.
          await page.goto(base + route, { waitUntil: 'load' }).catch(() => {});
          await page.evaluate(navState).catch(() => {});
        }
        if (!reached) add('nav-unreachable', 'critical', `${route}: no header control at ${PHONE}px reveals the navigation links`, at);
      }
    }

    // Touch controls a thumb cannot hit. Advisory: it never blocks on its own, because dense
    // but deliberate designs exist, but it is reported for the record.
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
  } catch (err) {
    add('interaction-check-error', 'serious', `${route}: the phone-width checks broke: ${String(err.message).slice(0, 160)}`, location(route, PHONE));
  } finally {
    await page.close().catch(() => {});
  }
}

// The visible state of a control: what hover and keyboard focus are expected to change.
function stateOf(el) {
  const st = getComputedStyle(el);
  return [st.outlineStyle, st.outlineWidth, st.outlineColor, st.boxShadow, st.borderColor, st.backgroundColor, st.color, st.textDecorationLine, st.transform, st.opacity].join('|');
}

// Buttons and button-like links must show keyboard focus (WCAG 2.4.7) and react to the pointer.
// Up to 8 per page, desktop width. Keyboard focus is checked the way a keyboard user gets it: Tab
// first, so the browser shows focus-visible styles, then focus on each control in turn.
async function stateChecks(context, base, route, add, metrics) {
  const page = await context.newPage();
  const at = location(route, DESKTOP);
  try {
    await page.goto(base + route, { waitUntil: 'load' });
    const count = await page.evaluate(() => {
      const looksLikeButton = (el) => {
        if (el.matches('button, [role="button"], input[type="submit"]')) return true;
        const st = getComputedStyle(el);
        return el.matches('a[href]') && (st.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(st.borderTopWidth) > 0) && parseFloat(st.paddingLeft) >= 8;
      };
      const found = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.disabled && getComputedStyle(el).visibility !== 'hidden' && looksLikeButton(el);
      }).slice(0, 8);
      // A native browser button draws its own hover, which computed styles do not show; only
      // controls the site styled itself are held to a visible hover.
      found.forEach((el, i) => {
        el.setAttribute('data-forge-state', String(i));
        if (el.matches('button, input[type="submit"]') && getComputedStyle(el).appearance !== 'none') el.setAttribute('data-forge-native', '1');
      });
      return found.length;
    });
    await page.keyboard.press('Tab');
    for (let i = 0; i < count; i++) {
      const sel = `[data-forge-state="${i}"]`;
      const name = await page.$eval(sel, (el) => ((el.getAttribute('aria-label') ?? el.textContent) || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30)).catch(() => null);
      if (name === null) continue;
      metrics.states++;
      await page.$eval(sel, (el) => el.blur()).catch(() => {});
      await page.mouse.move(0, 0);
      await page.waitForTimeout(80);
      const rest = await page.$eval(sel, stateOf).catch(() => null);
      await page.$eval(sel, (el) => el.focus()).catch(() => {});
      await page.waitForTimeout(80);
      const focused = await page.$eval(sel, stateOf).catch(() => null);
      if (rest && focused && rest === focused) add('focus-invisible', 'serious', `${route}: "${name}" shows no visible focus when reached by keyboard`, at);
      await page.$eval(sel, (el) => el.blur()).catch(() => {});
      if (await page.$eval(sel, (el) => el.hasAttribute('data-forge-native')).catch(() => true)) continue;
      // A control something else covers cannot be hovered; the layout check reports it instead.
      const onTop = await page.$eval(sel, (el) => {
        el.scrollIntoView({ block: 'center' });
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return Boolean(top && (top === el || el.contains(top)));
      }).catch(() => false);
      if (!onTop) continue;
      await page.hover(sel, { timeout: 1000, force: true }).catch(() => {});
      await page.waitForTimeout(350);
      const hovered = await page.$eval(sel, stateOf).catch(() => null);
      if (rest && hovered && rest === hovered) add('hover-dead', 'moderate', `${route}: "${name}" does not change when the pointer is over it`, at);
    }
  } catch (err) {
    add('interaction-check-error', 'serious', `${route}: the button state checks broke: ${String(err.message).slice(0, 160)}`, at);
  } finally {
    await page.close().catch(() => {});
  }
}

// Text cut off by its box, and controls on the first screen covered by something else.
async function layoutChecks(context, base, route, add, width) {
  const page = await context.newPage();
  const at = location(route, width);
  try {
    await page.goto(base + route, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const label = (el) => ((el.getAttribute('aria-label') ?? el.textContent) || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      const clipped = [];
      for (const el of document.querySelectorAll('h1, h2, h3, h4, p, li, a, button, label, span, td, th')) {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2 || st.visibility === 'hidden') continue;
        const hides = /hidden|clip/.test(st.overflowX + st.overflowY);
        const meant = st.textOverflow === 'ellipsis' || (st.webkitLineClamp && st.webkitLineClamp !== 'none');
        if (hides && !meant && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) clipped.push(label(el));
      }
      const covered = [];
      for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')) {
        const b = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (b.width < 4 || b.height < 4 || st.visibility === 'hidden' || st.pointerEvents === 'none' || b.top < 0 || b.bottom > innerHeight || b.left < 0 || b.right > innerWidth) continue;
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.labels && [...el.labels].some((l) => l.contains(top)))) covered.push(`${label(el)} (under ${top.tagName.toLowerCase()}${top.className && typeof top.className === 'string' ? `.${top.className.split(' ')[0]}` : ''})`);
      }
      // Text with something opaque laid over part of it: sample points along each line on the screen.
      const textCovered = [];
      const opaque = (n) => {
        const st = getComputedStyle(n);
        const bg = st.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(',').map(Number);
        // Images, video and canvas laid over type are a composition (a cut-out in front of a wordmark);
        // a solid box over text is a mistake. An intended overlap is marked data-overlap.
        if (n.matches('img, video, canvas, svg, picture') || n.closest('[data-overlap]')) return false;
        return st.backgroundImage !== 'none' || (bg && (bg.length < 4 || bg[3] > 0.5));
      };
      for (const el of document.querySelectorAll('h1, h2, h3, p')) {
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || !el.textContent.trim()) continue;
        // Text the browser does not show (a closed <details>, display: none, opacity 0) cannot be covered.
        if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) continue;
        for (const r of el.getClientRects()) {
          if (r.width < 20 || r.bottom < 0 || r.top > innerHeight) continue;
          const points = [0.2, 0.5, 0.8].flatMap((fx) => [0.5, 0.75].map((fy) => [r.left + r.width * fx, r.top + r.height * fy]));
          const hit = points.map(([x, y]) => document.elementFromPoint(x, y)).find((top) => top && top !== el && !el.contains(top) && !top.contains(el) && opaque(top));
          if (hit) {
            textCovered.push(`${label(el)} (under ${hit.tagName.toLowerCase()}${hit.className && typeof hit.className === 'string' ? `.${hit.className.split(' ')[0]}` : ''})`);
            break;
          }
        }
      }
      return { clipped: clipped.slice(0, 3), covered: covered.slice(0, 3), textCovered: textCovered.slice(0, 3) };
    });
    for (const c of r.clipped) add('text-clipped', 'serious', `${route}: text is cut off by its box at ${width}px: "${c}"`, at);
    for (const c of r.covered) add('control-covered', 'serious', `${route}: a control is covered by another element at ${width}px: ${c}`, at);
    for (const c of r.textCovered) add('text-covered', 'serious', `${route}: text has something laid over it at ${width}px: "${c}"`, at);
  } catch (err) {
    add('interaction-check-error', 'serious', `${route}: the layout checks broke: ${String(err.message).slice(0, 160)}`, at);
  } finally {
    await page.close().catch(() => {});
  }
}

export default {
  name: 'interactions',
  version: '0.1.0',
  thresholds: { minTapPx: 24 },
  run(ctx, t) {
    return withSite(ctx, async ({ browser, base }) => {
      const findings = [];
      const add = (id, severity, message, loc) => findings.push({ id, severity, message, location: loc });
      const metrics = { toggles: 0, details: 0, tabs: 0, dialogs: 0, carousels: 0, navChecks: 0, states: 0 };
      const desktop = await browser.newContext({ viewport: { width: DESKTOP, height: 900 }, reducedMotion: 'reduce' });
      const phone = await browser.newContext({ viewport: { width: PHONE, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
      try {
        for (const route of ctx.routes()) {
          await driveWidgets(desktop, base, route, add, metrics);
          await phoneChecks(phone, base, route, add, metrics, t);
          await stateChecks(desktop, base, route, add, metrics);
          await layoutChecks(desktop, base, route, add, DESKTOP);
          await layoutChecks(phone, base, route, add, PHONE);
        }
      } finally {
        await desktop.close();
        await phone.close();
      }
      return { findings, metrics };
    });
  },
};

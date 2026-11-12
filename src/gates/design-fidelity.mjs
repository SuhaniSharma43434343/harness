import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withSite } from './browser.mjs';
import { loadMethodology } from '../design/spec.mjs';

// Design fidelity: renders the built site at desktop and mobile and checks it against the approved
// specification. Does every planned section exist, with its copy, assets, fonts and motion? Is the
// chosen approach present, and no other? Does the page look generic? Saves a screenshot per
// section for the visual review. A site with no specification fails: nothing to be faithful to.

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
export const SHOT_DIR = 'evidence/visual';

const readSpec = (dir, file) => {
  const path = join(dir, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};
const slugOf = (route) => (route === '/' ? 'home' : route.slice(1).replaceAll('/', '-'));

// Runs in the page: facts about each section, to be judged outside.
function probePage({ ids, minVisible }) {
  const out = { sections: {}, order: [] };
  const vw = document.documentElement.clientWidth;
  for (const id of ids) {
    const el = document.querySelector(`[data-section="${id}"]`);
    if (!el) continue;
    const box = el.getBoundingClientRect();
    const media = [...el.querySelectorAll('img, video, canvas, svg, picture')].filter((m) => {
      const r = m.getBoundingClientRect();
      return r.width * r.height >= minVisible;
    });
    const broken = [...el.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src'));
    // Cards: three or more siblings of about the same size, each boxed in with a border or background.
    let cards = 0;
    for (const parent of [el, ...el.querySelectorAll('*')]) {
      const kids = [...parent.children].filter((k) => k.getBoundingClientRect().height > 60);
      if (kids.length < 3) continue;
      const first = kids[0].getBoundingClientRect();
      const same = kids.filter((k) => {
        const r = k.getBoundingClientRect();
        return Math.abs(r.width - first.width) < 8 && Math.abs(r.height - first.height) < 40;
      });
      const boxed = same.filter((k) => {
        const st = getComputedStyle(k);
        return parseFloat(st.borderTopWidth) > 0 || parseFloat(st.borderRadius) > 0 || st.boxShadow !== 'none';
      });
      if (same.length >= 3 && boxed.length >= 3) cards = Math.max(cards, same.length);
    }
    // A layout signature: where the content blocks start and how the section is coloured.
    const blocks = [...el.querySelectorAll('h1, h2, h3, p, img, svg, canvas, video, ul, ol, form')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 40 && r.height > 8;
    });
    const lefts = new Set(blocks.map((b) => Math.round(b.getBoundingClientRect().left / 48)));
    const inner = el.firstElementChild ?? el;
    const heading = el.querySelector('h1, h2');
    // Room to breathe: the space between the section's edges and its first and last content.
    const content = [...el.querySelectorAll('h1, h2, h3, h4, p, li, img, svg, video, canvas, form, a, button')].map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    // Content that spills past the edge has no room at all: 0, not a negative gap.
    const space = content.length ? { top: Math.max(0, Math.round(Math.min(...content.map((r) => r.top)) - box.top)), bottom: Math.max(0, Math.round(box.bottom - Math.max(...content.map((r) => r.bottom)))) } : null;
    out.sections[id] = {
      height: Math.round(box.height),
      width: Math.round(box.width),
      fullBleed: box.width >= vw - 2,
      text: el.textContent.replace(/\s+/g, ' ').trim(),
      media: media.length,
      broken,
      cards,
      placeholders: el.querySelectorAll('[data-placeholder]').length,
      assets: [...el.querySelectorAll('[data-asset]')].map((a) => a.getAttribute('data-asset')),
      motions: [...el.querySelectorAll('[data-motion]')].map((a) => a.getAttribute('data-motion')),
      signature: `${[...lefts].sort((a, b) => a - b).join(',')}|${getComputedStyle(inner).backgroundColor}|${heading ? getComputedStyle(heading).textAlign : ''}`,
      headingFont: heading ? getComputedStyle(heading).fontFamily : null,
      space,
      // What the art direction asks of the section: a background with light or texture, and its archetype.
      backImage: [el, ...el.children].some((n) => {
        const st = getComputedStyle(n);
        return st.backgroundImage !== 'none' || getComputedStyle(n, '::before').backgroundImage !== 'none' || getComputedStyle(n, '::after').backgroundImage !== 'none';
      }) || !!el.querySelector('canvas, video'),
      archetype: el.getAttribute('data-archetype') ?? el.firstElementChild?.getAttribute('data-archetype') ?? null,
    };
  }
  // The first screen's calls to action: visible links and buttons above the fold, outside the
  // navigation menu (a header button counts, a menu link does not).
  // The atmosphere as the page has it, the primary button's shape, and the chrome's archetype marks.
  const root = getComputedStyle(document.documentElement);
  out.atmosphere = { radiusMd: root.getPropertyValue('--radius-md').trim(), elevation2: root.getPropertyValue('--elevation-2').trim(), surface1: root.getPropertyValue('--surface-1').trim() };
  const primary = [...document.querySelectorAll('main a[href], main button, header a[href], header button')].find((b) => {
    const st = getComputedStyle(b);
    return b.getBoundingClientRect().width > 0 && st.backgroundColor !== 'rgba(0, 0, 0, 0)' && parseFloat(st.paddingLeft) >= 8;
  });
  out.buttonRadius = primary ? parseFloat(getComputedStyle(primary).borderTopLeftRadius) : null;
  out.chrome = { navigation: document.querySelector('header [data-archetype], header[data-archetype]')?.getAttribute('data-archetype') ?? null, footer: document.querySelector('footer [data-archetype], footer[data-archetype]')?.getAttribute('data-archetype') ?? null };
  out.firstScreenActions = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]')].filter((a) => {
    if (a.closest('nav')) return false;
    const r = a.getBoundingClientRect();
    const st = getComputedStyle(a);
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && st.visibility !== 'hidden' && st.opacity !== '0';
  }).length;
  const body = document.querySelector('p');
  out.bodyFont = body ? getComputedStyle(body).fontFamily : null;
  out.background = getComputedStyle(document.body).backgroundColor;
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.signals = {
    pinned: !!document.querySelector('.pin-spacer, [data-pin]') || [...document.querySelectorAll('section, [data-section] > *')].some((s) => getComputedStyle(s).position === 'sticky' && s.getBoundingClientRect().height > innerHeight * 0.7),
    webgl: [...document.querySelectorAll('canvas')].some((c) => !c.hidden && c.getBoundingClientRect().width > 100 && (c.dataset.engine || c.getContext('webgl2') || c.getContext('webgl'))),
    canvas: [...document.querySelectorAll('canvas')].some((c) => !c.hidden && c.getBoundingClientRect().width > 100),
    game: !!document.querySelector('[data-app06]'),
  };
  return out;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
// The words that turn a picture of something into a picture of a job done for this client.
const STOCK_CLAIM = /\b(finished|completed|our|we|built by|renovated by|project|the kind we)\b/i;

// One motion on a fresh page, before anything has scrolled: does the element named by the plan
// change when it should? A reveal that runs once can only be seen the first time, so this picks
// an element still below the fold. If all of them start in view, it watches the entrance instead.
async function motionWorks(page, id, kind) {
  const handles = await page.$$(`[data-motion="${id}"]`);
  if (!handles.length) return { ok: false, why: 'no element has this data-motion' };
  if (!['scroll', 'pin', 'hover'].includes(kind)) return { ok: true };
  let handle = handles[0];
  if (kind !== 'hover') {
    for (const h of handles) {
      if (await h.evaluate((el) => el.getBoundingClientRect().top > innerHeight)) {
        handle = h;
        break;
      }
    }
  }
  const style = () =>
    handle.evaluate((el) => {
      const pick = (node) => {
        const st = getComputedStyle(node);
        return [st.transform, st.opacity, st.clipPath, st.filter, st.backgroundColor, st.color, st.boxShadow, st.borderColor, st.translate, st.scale].join('|');
      };
      return [el, ...el.querySelectorAll('*')].slice(0, 25).map(pick).join(';');
    });
  if (kind === 'hover') {
    await handle.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(700);
    const before = await style();
    await handle.hover({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const after = await style();
    await page.mouse.move(0, 0);
    return { ok: before !== after, why: 'hover changes nothing visible' };
  }
  // A scrubbed motion may run over several screens, so walk through the element's whole range.
  const before = await style();
  const { from, to } = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { from: r.top + scrollY - innerHeight, to: r.bottom + scrollY + innerHeight };
  });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await page.evaluate((y) => scrollTo(0, Math.max(0, y)), from + ((to - from) * i) / steps);
    await page.waitForTimeout(500);
    if ((await style()) !== before) return { ok: true };
  }
  // Already in view at load: the entrance has played. Watch it from the start on a reload.
  await page.evaluate(() => scrollTo(0, 0));
  await page.reload({ waitUntil: 'commit' });
  const early = await page.waitForSelector(`[data-motion="${id}"]`, { state: 'attached', timeout: 3000 }).catch(() => null);
  if (!early) return { ok: false, why: 'scrolling to it changes nothing' };
  handle = early;
  const first = await style();
  await page.waitForTimeout(1500);
  const settled = await style();
  return { ok: first !== settled, why: 'neither scrolling nor loading changes it' };
}

export default {
  name: 'design-fidelity',
  version: '0.1.0',
  thresholds: { maxCardShare: 0.25, minSectionHeight: 120, minVisualShare: 0.4, minBreathPx: 24, flatRhythmPx: 4 },
  run(ctx, t) {
    const dir = ctx.projectDir;
    const plan = readSpec(dir, 'design/section-plan.json');
    const copy = readSpec(dir, 'content/copy.json');
    const motion = readSpec(dir, 'design/motion-plan.json');
    const assets = readSpec(dir, 'design/asset-plan.json');
    const direction = readSpec(dir, 'design/direction.json');
    const system = readSpec(dir, 'design/design-system.json');
    const pagesDir = join(dir, 'content', 'pages');
    const v2 = (readSpec(dir, 'design/reference/workflow.json')?.version ?? 1) >= 2;
    if (!plan || !copy || !direction) {
      return { findings: [{ id: 'no-design-spec', severity: 'critical', message: 'The site has no approved design specification (direction, section plan and copy), so it cannot be a designed site' }] };
    }
    const method = loadMethodology(direction.primaryApproach);
    const allowed = new Set([direction.primaryApproach, 'APP-01', ...direction.combination.map((c) => c.approach)]);
    if (direction.primaryApproach === 'APP-07') for (const part of ['APP-02', 'APP-03']) allowed.add(part);
    const required = new Set(method.signals.required);
    const forbidden = new Set(method.signals.forbidden);
    for (const c of direction.combination) for (const s of loadMethodology(c.approach).signals.required) forbidden.delete(s);
    const copyById = new Map(copy.pages.flatMap((p) => p.sections.map((s) => [s.id, s])));
    const motions = new Map((motion?.motions ?? []).map((m) => [m.id, m]));
    const planAssets = new Map((assets?.assets ?? []).map((a) => [a.id, a]));
    // Names the client's own material uses for its past jobs, from the copy's project titles.
    const clientWords = copy.pages.flatMap((p) => p.sections).flatMap((x) => (x.headline.match(/\b[A-Z][a-z]+ (?:Hill|Cove|Street|Lane)\b/g) ?? [])).map((w) => w.toLowerCase());
    const display = system?.typography?.display;
    const body = system?.typography?.body;

    const shots = join(dir, SHOT_DIR);
    mkdirSync(shots, { recursive: true });
    const findings = [];
    const evidence = [];
    const add = (id, severity, message, location) => findings.push({ id, severity, message, ...(location ? { location } : {}) });

    // With opts.page, only that page is rendered and judged, and the site-wide checks (the approach
    // as a whole, card share, visual share) wait for the full render.
    const only = ctx.opts.page;
    const pages = only ? plan.pages.filter((p) => p.slug === only) : plan.pages;
    return withSite(ctx, async ({ browser, base }) => {
      let total = 0;
      let cardSections = 0;
      let visual = 0;
      const seenSignals = { pinned: false, webgl: false, canvas: false, game: false };
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
        // The approaches' capability check treats a headless machine as low-end; this is a test render.
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        });
        for (const pagePlan of pages) {
          const route = pagePlan.slug;
          const where = `${route} @ ${vp.name}`;
          const page = await context.newPage();
          const consoleErrors = [];
          page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 160)));
          const res = await page.goto(base + route, { waitUntil: 'load' });
          if (!res?.ok()) {
            add('route-missing', 'critical', `${route} does not load`, where);
            await page.close();
            continue;
          }
          await page.waitForTimeout(900);
          const ids = pagePlan.sections.map((s) => s.id);
          const probe = await page.evaluate(probePage, { ids, minVisible: 12000 });
          for (const [k, v] of Object.entries(probe.signals)) if (v) seenSignals[k] = true;
          if (probe.overflow > 1) add('horizontal-overflow', 'serious', `${route} scrolls sideways by ${probe.overflow}px`, where);
          for (const err of consoleErrors) add('script-error', 'serious', `Script error: ${err}`, where);

          // Fonts and background follow the design system.
          if (vp.name === 'desktop') {
            const family = (s) => String(s ?? '').split(/[,(]/)[0].trim();
            const first = Object.values(probe.sections)[0];
            if (first?.headingFont && display && !first.headingFont.toLowerCase().includes(family(display).toLowerCase())) add('font-mismatch', 'serious', `Headings use ${first.headingFont}, not the system's ${family(display)}`, where);
            if (probe.bodyFont && body && !probe.bodyFont.toLowerCase().includes(family(body).toLowerCase())) add('font-mismatch', 'serious', `Body text uses ${probe.bodyFont}, not the system's ${family(body)}`, where);
          }

          // The home page's first screen gives the visitor something to do. Under workflow 2 a hero
          // without one is a defect; for an older project it is reported as advice.
          // Workflow 2: the builder built the art direction, not its own idea of it.
          if (v2 && system?.atmosphere && vp.name === 'desktop') {
            const want = system.atmosphere;
            const norm2 = (x) => String(x).replace(/\s+/g, '');
            if (norm2(probe.atmosphere.radiusMd) !== norm2(want.radius.md) || norm2(probe.atmosphere.surface1).toLowerCase() !== norm2(want.surfaces.raised).toLowerCase()) add('atmosphere-missing', 'serious', `The page does not carry the design system's atmosphere (--radius-md is "${probe.atmosphere.radiusMd}", --surface-1 is "${probe.atmosphere.surface1}"): keep site/src/styles/atmosphere.css as the harness wrote it`, where);
            const square = ['sm', 'md', 'lg'].every((k) => /^0(px)?$/.test(want.radius[k]));
            if (!square && probe.buttonRadius === 0) add('art-drift', 'serious', `The primary button is square, but the design system's radius scale is ${want.radius.sm} / ${want.radius.md} / ${want.radius.lg}`, where);
            for (const planned of pagePlan.sections) {
              const s = probe.sections[planned.id];
              const back = planned.visual?.layers?.back ?? '';
              if (s && /gradient|light|glow|mesh|radial|grain|texture|shader|noise/i.test(back) && !s.backImage) add('art-drift', 'serious', `Section ${planned.id} is planned with "${back.slice(0, 60)}" behind it, but renders a flat colour`, where);
              if (s && planned.visual && planned.visual.archetype !== s.archetype) add('art-drift', 'moderate', `Section ${planned.id} is planned as "${planned.visual.archetype}" but is marked ${s.archetype ? `"${s.archetype}"` : 'with no data-archetype'}`, where);
            }
            const chrome = plan.chrome ?? {};
            for (const k of ['navigation', 'footer']) if (chrome[k] && probe.chrome[k] !== chrome[k].archetype) add('chrome-drift', 'moderate', `The ${k === 'navigation' ? 'header' : 'footer'} is planned as "${chrome[k].archetype}" but is marked ${probe.chrome[k] ? `"${probe.chrome[k]}"` : 'with no data-archetype'}`, where);
          }
          if (route === '/' && probe.firstScreenActions === 0) add('hero-no-action', v2 ? 'serious' : 'moderate', `The first screen of the home page has no call to action (no button or link outside the menu) at ${vp.name}`, where);
          if (vp.name === 'desktop') {
            const spaced = pagePlan.sections.map((p) => probe.sections[p.id]).filter((s) => s?.space && s.height >= 200);
            for (const [i, s] of spaced.entries()) {
              if (s.space.top < t.minBreathPx && s.space.bottom < t.minBreathPx) add('cramped-section', 'moderate', `Section ${pagePlan.sections.filter((p) => probe.sections[p.id]?.space && probe.sections[p.id].height >= 200)[i].id} has no room to breathe: ${s.space.top}px above its content and ${s.space.bottom}px below`, where);
            }
            const tops = spaced.map((s) => s.space.top);
            if (tops.length >= 5 && Math.max(...tops) - Math.min(...tops) <= t.flatRhythmPx) add('flat-rhythm', 'moderate', `Every section on ${route} has the same spacing (${Math.round(tops[0])}px above its content); vary it so the page has a rhythm`, where);
          }

          let run = 1;
          let last = null;
          for (const planned of pagePlan.sections) {
            const s = probe.sections[planned.id];
            if (!s) {
              add('section-missing', 'serious', `Section ${planned.id} is not on the page`, where);
              continue;
            }
            if (s.height < t.minSectionHeight) add('section-empty', 'serious', `Section ${planned.id} is only ${s.height}px tall`, where);
            const written = copyById.get(planned.id);
            if (written && !norm(s.text).includes(norm(written.headline))) add('copy-missing', 'serious', `Section ${planned.id} does not show its headline "${written.headline}"`, where);
            if (s.placeholders) add('placeholder-art', 'serious', `Section ${planned.id} still shows placeholder art`, where);
            for (const src of s.broken) add('image-broken', 'serious', `Section ${planned.id} has a broken image: ${src}`, where);
            for (const a of planned.assets) if (!s.assets.includes(a)) add('asset-missing', 'serious', `Section ${planned.id} has no element for planned asset ${a} (${planAssets.get(a)?.kind ?? '?'}); mark it with data-asset`, where);
            if (vp.name === 'desktop') {
              total++;
              if (s.cards >= 3) cardSections++;
              if (s.media || planned.assets.length) visual++;
              run = s.signature === last ? run + 1 : 1;
              last = s.signature;
              if (run >= 3) add('repeated-layout', 'serious', `Three sections in a row on ${route} have the same layout, ending at ${planned.id}`, where);
              if (planned.pattern === 'full-bleed' && !s.fullBleed) add('pattern-mismatch', 'serious', `Section ${planned.id} is planned full-bleed but is ${s.width}px wide`, where);
              if (planned.pattern === 'horizontal-story' && !probe.signals.pinned) add('pattern-mismatch', 'serious', `Section ${planned.id} is planned as a horizontal story, but nothing is pinned`, where);
            }
            if (vp.name === 'mobile' && s.width > vp.width + 1) add('mobile-overflow', 'serious', `Section ${planned.id} is ${s.width}px wide on a ${vp.width}px phone`, where);
          }

          // A stock or licensed photo must not be presented as this client's own finished work.
          for (const hit of await page.evaluate((files) => [...document.querySelectorAll('img')].flatMap((img) => {
            const src = img.getAttribute('src') ?? '';
            if (!files.some((f) => src.endsWith(f))) return [];
            const caption = img.closest('figure')?.querySelector('figcaption')?.textContent ?? '';
            return [{ src, text: `${caption} ${img.alt ?? ''}` }];
          }), [...planAssets.values()].filter((a) => a.source === 'licensed' && a.file).map((a) => a.file))) {
            if (STOCK_CLAIM.test(hit.text) || clientWords.some((w) => hit.text.toLowerCase().includes(w))) add('stock-as-client-work', 'critical', `Stock photo ${hit.src} is presented as the client's work: "${hit.text.trim().slice(0, 100)}"`, where);
          }

          // One screenshot per section, scrolled into place, so the review sees what a visitor sees.
          for (const id of ids) {
            const el = await page.$(`[data-section="${id}"]`);
            if (!el) continue;
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(450);
            const rel = `${SHOT_DIR}/${slugOf(route)}-${vp.name}-${id}.jpg`;
            await page.screenshot({ path: join(dir, rel), type: 'jpeg', quality: 62 }).catch(() => {});
            evidence.push(rel);
          }

          await page.close();

          // Motion, at desktop: each planned motion responds, seen fresh and once per page.
          if (vp.name === 'desktop') {
            for (const m of new Set(pagePlan.sections.flatMap((x) => x.motion))) {
              const spec = motions.get(m);
              if (!spec) continue;
              const fresh = await context.newPage();
              await fresh.goto(base + route, { waitUntil: 'load' });
              await fresh.waitForTimeout(300);
              const r = await motionWorks(fresh, m, spec.kind).catch((e) => ({ ok: false, why: String(e.message).slice(0, 80) }));
              if (!r.ok) add('motion-dead', 'serious', `Motion ${m} (${spec.kind}): ${r.why}`, where);
              await fresh.close();
            }
          }
        }
        await context.close();
      }

      // Reduced motion must not hide content.
      const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const calmPage = await calm.newPage();
      for (const pagePlan of pages) {
        await calmPage.goto(base + pagePlan.slug, { waitUntil: 'load' });
        await calmPage.waitForTimeout(400);
        const hidden = await calmPage.evaluate(() => [...document.querySelectorAll('[data-section] h1, [data-section] h2, [data-section] p')].filter((n) => {
          const st = getComputedStyle(n);
          return st.visibility === 'hidden' || parseFloat(st.opacity) < 0.1;
        }).map((n) => n.textContent.trim().slice(0, 40)));
        if (hidden.length) add('reduced-motion-hidden', 'serious', `With reduced motion, text stays hidden: "${hidden[0]}"`, pagePlan.slug);
      }
      await calm.close();

      if (only) return { findings, evidence, metrics: { sections: total, page: only } };
      // The approach as a whole, across the site.
      for (const s of required) if (!seenSignals[s]) add('approach-missing', 'serious', `${method.id} ${method.name} needs ${s}, and the site has none`);
      for (const s of forbidden) if (seenSignals[s]) add('approach-mixed', 'serious', `${method.id} ${method.name} does not use ${s}, but the site does, with no approved combination`);
      // Every section on a page belongs to an approach the direction allows.
      for (const f of existsSync(pagesDir) ? readdirSync(pagesDir).filter((x) => x.endsWith('.md')) : []) {
        for (const m of readFileSync(join(pagesDir, f), 'utf8').matchAll(/use:\s*"?(APP-0[1-8])\//g)) {
          if (!allowed.has(m[1])) add('approach-mixed', 'serious', `${f} uses a section from ${m[1]}, which the direction does not include`);
        }
      }
      const share = total ? cardSections / total : 0;
      if (share > t.maxCardShare) add('card-monotony', 'serious', `${cardSections} of ${total} sections render as card grids (limit ${Math.round(t.maxCardShare * 100)}%)`);
      const vis = total ? visual / total : 0;
      if (vis < t.minVisualShare) add('text-only', 'serious', `Only ${visual} of ${total} sections have a visual; the site reads as text blocks`);
      return { findings, evidence, metrics: { sections: total, cardShare: Math.round(share * 100) / 100, visualShare: Math.round(vis * 100) / 100, ...Object.fromEntries(Object.entries(seenSignals).map(([k, v]) => [`signal_${k}`, v])) } };
    });
  },
};

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../core/workspace.mjs';
import { tokensFromDirection } from '../site/tokens.mjs';
import { tokensToCss } from '../../starters/astro-base/src/lib/tokens.mjs';
import { launchBrowser } from '../tools/load.mjs';

export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// @font-face rules for a Fontsource font, when its package is installed in the starter or the
// harness. Without it the specimen falls back to the CSS stack and says so on the page.
function fontFaces(font) {
  if (!font.package) return { css: '', loaded: font.source === 'system' };
  for (const base of [join(ROOT, 'starters', 'astro-base', 'node_modules'), join(ROOT, 'node_modules')]) {
    const files = join(base, font.package, 'files');
    if (!existsSync(files)) continue;
    const css = (font.weights ?? [400])
      .map((w) => {
        const file = readdirSync(files).find((f) => f.includes(`latin-${w}-normal`) && f.endsWith('.woff2'));
        return file ? `@font-face{font-family:"${font.family}";font-weight:${w};src:url("${pathToFileURL(join(files, file))}") format("woff2");}` : '';
      })
      .join('\n');
    return { css, loaded: css.length > 0 };
  }
  return { css: '', loaded: false };
}

// A one-page specimen of a direction, using only the brief's own words: the hero, a
// call to action, the goals, the pages and a form field, styled entirely from the tokens.
export function specimenHtml(direction, brief) {
  const tokens = tokensFromDirection(direction);
  const faces = [fontFaces(tokens.font.display), fontFaces(tokens.font.body)];
  const home = brief.pages[0];
  const fallback = faces.every((f) => f.loaded) ? '' : '<p class="note">Fonts shown with fallbacks: install the Fontsource packages to see the real faces.</p>';
  return `<!doctype html>
<html lang="${esc(brief.client.languages?.[0] ?? 'en')}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(direction.name)}: ${esc(brief.client.name)}</title>
<style>
${faces.map((f) => f.css).join('\n')}
${tokensToCss(tokens)}
*{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-fg);font-family:var(--font-body);font-size:var(--step-0);line-height:var(--line-height)}
.wrap{max-width:72rem;margin:0 auto;padding:calc(var(--space)*2)}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--color-border);padding-bottom:var(--space)}
nav a{color:var(--color-link);margin-left:var(--space);text-decoration:none}
h1,h2,.brand{font-family:var(--font-display);font-weight:var(--weight-display);line-height:1.1}
h1{font-size:var(--step-5);margin:calc(var(--space)*3) 0 var(--space);max-width:18ch}
h2{font-size:var(--step-2)}.lead{font-size:var(--step-1);color:var(--color-muted);max-width:var(--measure)}
.btn{display:inline-block;background:var(--color-primary);color:var(--color-on-primary);padding:.8em 1.4em;border-radius:var(--radius);text-decoration:none}
.btn.alt{background:var(--color-accent);color:var(--color-on-accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:var(--space);margin-top:calc(var(--space)*2)}
.card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:var(--space)}
label{display:block;font-size:var(--step-n1);color:var(--color-muted)}input{width:100%;padding:.6em;border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-bg);color:var(--color-fg)}
.meta{font-size:var(--step-n1);color:var(--color-muted);margin-top:calc(var(--space)*3)}.note{font-size:var(--step-n2);color:var(--color-muted)}
.layout-editorial main{max-width:46rem}.layout-editorial .cards{grid-template-columns:1fr}
.layout-split main{display:grid;grid-template-columns:1.2fr 1fr;gap:calc(var(--space)*2);align-items:start}.layout-split .cards{margin-top:calc(var(--space)*3)}
.layout-immersive header{border:0}.layout-immersive h1{font-size:calc(var(--step-5)*1.2);max-width:none}.layout-immersive main>h1,.layout-immersive main>.lead{text-align:center;margin-left:auto;margin-right:auto}.layout-immersive main>p:first-of-type+p{text-align:center}
.layout-minimal .card{border:0;background:none;padding:0}.layout-minimal h1{font-weight:400}
.layout-modular .card{border-top:4px solid var(--color-accent)}.layout-grid .cards{grid-template-columns:repeat(4,1fr)}
@media (max-width:600px){nav{display:none}h1{font-size:var(--step-4)}.layout-split main,.layout-grid .cards{grid-template-columns:1fr}}
</style>
</head>
<body class="layout-${direction.layout}"><div class="wrap">
<header><span class="brand">${esc(brief.client.name)}</span><nav>${brief.pages.slice(0, 5).map((p) => `<a href="#">${esc(p.title)}</a>`).join('')}</nav></header>
<main>
<h1>${esc(home.purpose)}</h1>
<p class="lead">${esc(brief.goals[0].statement)}</p>
<p><a class="btn" href="#">${esc(home.cta)}</a> ${brief.pages[1] ? `<a class="btn alt" href="#">${esc(brief.pages[1].cta)}</a>` : ''}</p>
<div class="cards">${brief.pages.slice(0, 3).map((p) => `<div class="card"><h2>${esc(p.title)}</h2><p>${esc(p.purpose)}</p></div>`).join('')}
<div class="card"><label for="e">Email</label><input id="e" type="email" placeholder="name@example.com"></div></div>
<p class="meta">${esc(direction.name)}: ${esc(tokens.font.display.family)} and ${esc(tokens.font.body.family)}, ${direction.layout} layout, motion ${direction.motionIntensity}.</p>
${fallback}
</main></div></body></html>
`;
}

// renderDirections(decision, brief, projectDir, opts?) => Promise<{ files, screenshots, reason? }>
// Writes design/renders/<id>.html for every direction and, when Playwright can start Chromium,
// the desktop and mobile PNGs each direction names in its renders. Without a browser it
// still writes the HTML and says why there are no PNGs, so the P4 render check fails visibly.
export async function renderDirections(decision, brief, projectDir, { screenshots = true } = {}) {
  const files = [];
  for (const d of decision.directions) {
    const html = join(projectDir, 'design', 'renders', `${d.id}.html`);
    mkdirSync(dirname(html), { recursive: true });
    writeFileSync(html, specimenHtml(d, brief));
    files.push(html);
  }
  if (!screenshots) return { files, screenshots: false, reason: 'screenshots turned off' };
  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    return { files, screenshots: false, reason: `${err.message}. ${err.hint ?? ''}`.trim() };
  }
  try {
    for (const d of decision.directions) {
      for (const [view, size] of Object.entries(VIEWPORTS)) {
        const page = await browser.newPage({ viewport: size });
        await page.goto(pathToFileURL(join(projectDir, 'design', 'renders', `${d.id}.html`)).href);
        const out = join(projectDir, d.renders[view]);
        mkdirSync(dirname(out), { recursive: true });
        await page.screenshot({ path: out, fullPage: true });
        await page.close();
        files.push(out);
      }
    }
  } finally {
    await browser.close();
  }
  return { files, screenshots: true };
}

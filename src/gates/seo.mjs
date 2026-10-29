import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// SEO: every page has a title (unique across the site), a meta description, one h1, a lang,
// a canonical URL and Open Graph title; the site has a sitemap listing every route, a
// robots.txt, and JSON-LD that parses. A preview build (opts.preview) must be noindex.
const meta = (doc, attr, name) => doc.querySelector(`meta[${attr}="${name}"]`)?.getAttribute('content')?.trim();
const strip = (p) => (p.length > 1 ? p.replace(/\/$/, '') : p);

export default {
  name: 'seo',
  version: '0.1.0',
  thresholds: { titleMax: 70, descriptionMin: 50, descriptionMax: 170 },
  run(ctx, t) {
    const findings = [];
    const add = (id, severity, message, location) => findings.push({ id, severity, message, ...(location ? { location } : {}) });
    const titles = new Map();

    for (const route of ctx.routes()) {
      const doc = ctx.doc(route);
      const at = `site/dist/${route === '/' ? 'index.html' : `${route.slice(1)}/index.html`}`;
      const title = doc.querySelector('title')?.text.trim();
      if (!title) add('title-missing', 'serious', `${route} has no <title>`, at);
      else {
        if (titles.has(title)) add('title-duplicate', 'serious', `${route} has the same title as ${titles.get(title)}: "${title}"`, at);
        else titles.set(title, route);
        if (title.length > t.titleMax) add('title-long', 'minor', `${route} title is ${title.length} characters (over ${t.titleMax})`, at);
      }
      const desc = meta(doc, 'name', 'description');
      if (!desc) add('description-missing', 'serious', `${route} has no meta description`, at);
      else if (desc.length < t.descriptionMin || desc.length > t.descriptionMax) add('description-length', 'minor', `${route} description is ${desc.length} characters (aim for ${t.descriptionMin}-${t.descriptionMax})`, at);
      const h1 = doc.querySelectorAll('h1').length;
      if (h1 !== 1) add('h1-count', 'serious', `${route} has ${h1} h1 headings (expected 1)`, at);
      if (!doc.querySelector('html')?.getAttribute('lang')) add('lang-missing', 'serious', `${route} has no lang on <html>`, at);
      const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
      if (!canonical) add('canonical-missing', 'serious', `${route} has no canonical URL (set site.url in src/site.json)`, at);
      else if (!URL.canParse(canonical)) add('canonical-invalid', 'serious', `${route} canonical "${canonical}" is not an absolute URL`, at);
      if (!meta(doc, 'property', 'og:title')) add('og-missing', 'minor', `${route} has no og:title`, at);
      for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          JSON.parse(s.text);
        } catch {
          add('jsonld-invalid', 'serious', `${route} has JSON-LD that does not parse`, at);
        }
      }
      const robots = meta(doc, 'name', 'robots') ?? '';
      if (ctx.opts.preview && !/noindex/i.test(robots)) add('preview-indexable', 'critical', `${route} is a preview page without noindex`, at);
      if (!ctx.opts.preview && /noindex/i.test(robots)) add('noindex', 'serious', `${route} is marked noindex in a production build`, at);
    }

    const files = new Set(ctx.files());
    if (!ctx.routes().some((r) => ctx.doc(r).querySelector('script[type="application/ld+json"]'))) add('jsonld-missing', 'minor', 'No page has JSON-LD structured data');
    if (!files.has('robots.txt')) add('robots-missing', 'serious', 'site/dist/robots.txt is missing');
    if (!files.has('sitemap.xml') && !files.has('sitemap-index.xml')) add('sitemap-missing', 'serious', 'site/dist/sitemap.xml is missing');
    else if (files.has('sitemap.xml')) {
      const xml = readFileSync(join(ctx.dist, 'sitemap.xml'), 'utf8');
      const listed = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => strip(URL.canParse(m[1]) ? new URL(m[1]).pathname : m[1])));
      for (const r of ctx.routes()) if (!listed.has(strip(r))) add('sitemap-incomplete', 'serious', `${r} is not in sitemap.xml`, 'site/dist/sitemap.xml');
    }
    return { findings, metrics: { pages: ctx.routes().length } };
  },
};

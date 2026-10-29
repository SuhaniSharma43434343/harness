import { getCollection } from 'astro:content';
import site from '../site.json';

// One <url> per content page. Without site.url the locations are root-relative, and the SEO
// gate reports the missing canonical URL until hosting is decided.
export async function GET() {
  const pages = await getCollection('pages');
  const loc = (slug: string) => (site.url ? new URL(slug, site.url).href : slug);
  const urls = pages
    .map((p) => (p.id === 'index' ? '/' : `/${p.id}/`))
    .sort()
    .map((path) => `  <url><loc>${loc(path)}</loc></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}

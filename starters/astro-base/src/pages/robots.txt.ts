import site from '../site.json';

// The sitemap line needs an absolute URL, so it is only written once site.url is set.
export function GET() {
  const lines = ['User-agent: *', 'Allow: /'];
  if (site.url) lines.push('', `Sitemap: ${new URL('/sitemap.xml', site.url).href}`);
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain' } });
}

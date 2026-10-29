import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';

// site.json is written by the harness (forge site). Its url is optional until hosting is decided.
const site = JSON.parse(readFileSync(new URL('./src/site.json', import.meta.url), 'utf8'));

export default defineConfig({
  site: site.url ?? undefined,
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});

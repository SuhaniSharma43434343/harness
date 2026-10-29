import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

// Credential patterns. Each one is specific enough that a hit is worth a person's look.
export const PATTERNS = [
  ['anthropic-key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/],
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['stripe-key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['vercel-token', /\bvercel_[A-Za-z0-9]{24,}\b/i],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['assigned-secret', /\b(?:api[_-]?key|secret|token|password|passwd)\b["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+=]{20,}["']/i],
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.astro', '.cache']);
const TEXT = /\.(html?|js|mjs|cjs|ts|tsx|jsx|astro|css|json|md|txt|xml|svg|map|ya?ml|toml|env|vue|svelte)$|^\.env/i;

function walk(dir, base = dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, base, out);
    } else out.push(p.slice(base.length + 1).split(sep).join('/'));
  }
  return out;
}

const redact = (s) => `${s.slice(0, 6)}…${s.slice(-2)}`;

// Secrets: nothing that looks like a credential in the site's source or its build, and no
// .env file anywhere in the site (plan: generated sites are scanned before preview and deploy).
// Findings show a redacted match, never the secret itself.
export default {
  name: 'secrets',
  version: '0.1.0',
  thresholds: {},
  run(ctx) {
    const findings = [];
    let scanned = 0;
    for (const file of walk(ctx.siteDir)) {
      const name = file.split('/').pop();
      if (/^\.env(\..+)?$/.test(name) && !/\.example$/.test(name)) {
        findings.push({ id: 'env-file', severity: 'critical', message: `${file} is an environment file inside the site`, location: `site/${file}` });
        continue;
      }
      if (!TEXT.test(name)) continue;
      const full = join(ctx.siteDir, file);
      if (statSync(full).size > 5 * 1024 * 1024) continue;
      scanned++;
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const [kind, re] of PATTERNS) {
          const m = re.exec(line);
          if (m) findings.push({ id: 'secret', severity: 'critical', message: `Possible ${kind} in site/${file}:${i + 1}: ${redact(m[0])}`, location: `site/${file}:${i + 1}` });
        }
      });
    }
    return { findings, metrics: { filesScanned: scanned } };
  },
};

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { walk } from './glob.mjs';
import { ROOT } from './workspace.mjs';

// Secret redaction and scanning. The ledger, recordings and verify logs pass everything they
// write through redact(), and `forge scan` uses scanText() on files before they are shared.
// Two kinds of secret are found: known token formats, and the actual values of credentials in
// the operator's environment (any variable whose name looks like a secret).

export const MASK = '[REDACTED]';

export const PATTERNS = [
  { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { id: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g },
  { id: 'bearer-token', re: /\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g, keep: 1 },
  {
    id: 'assigned-secret',
    re: /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|password|passwd)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)(?!\[REDACTED\])(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi,
    keep: 1,
  },
];

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|WEBHOOK|CREDENTIAL|PRIVATE)/i;
const MIN_SECRET_LENGTH = 8;

// Values of the environment's secret-looking variables, longest first.
export function secretValues(env) {
  return [
    ...new Set(
      Object.entries(env)
        .filter(([name, v]) => SECRET_NAME.test(name) && typeof v === 'string' && v.length >= MIN_SECRET_LENGTH)
        .map(([, v]) => v),
    ),
  ].sort((a, b) => b.length - a.length);
}

let cached;
// Secrets from the harness .env and the process environment, read once.
export function knownSecrets() {
  if (!cached) {
    try {
      cached = secretValues(loadConfig(ROOT).env);
    } catch {
      cached = secretValues(process.env);
    }
  }
  return cached;
}

export function resetKnownSecrets() {
  cached = undefined;
}

export function redactText(text, { secrets = knownSecrets() } = {}) {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join(MASK);
  for (const p of PATTERNS) {
    out = out.replace(p.re, (...m) => (p.keep ? `${m[p.keep]}${MASK}` : MASK));
  }
  return out;
}

// Deep copy of a value with every string redacted (object keys are left alone).
export function redact(value, opts) {
  if (typeof value === 'string') return redactText(value, opts);
  if (Array.isArray(value)) return value.map((v) => redact(v, opts));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, opts);
    return out;
  }
  return value;
}

// Findings in a text: { id, line } for each match. The secret itself is never returned.
export function scanText(text, { secrets = knownSecrets() } = {}) {
  const findings = [];
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const s of secrets) if (line.includes(s)) findings.push({ id: 'env-secret', line: i + 1 });
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      if (p.re.test(line)) findings.push({ id: p.id, line: i + 1 });
      p.re.lastIndex = 0;
    }
  });
  return findings;
}

const SKIP = ['node_modules', '.git', 'workspace/.gitkeep'];
const MAX_SCAN_BYTES = 5 * 1024 * 1024;

// Scans files or folders. A .env file is itself a finding, except .env.example.
export function scanPaths(paths, { root = ROOT, secrets = knownSecrets() } = {}) {
  const results = [];
  for (const p of paths) {
    const full = join(root, p);
    let files;
    try {
      files = statSync(full).isDirectory() ? walk(full, { skip: SKIP, skipNames: ['node_modules', '.git'] }).map((f) => join(full, f)) : [full];
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = file.slice(root.length + 1).replace(/\\/g, '/');
      const base = rel.split('/').pop();
      if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
        results.push({ file: rel, id: 'env-file', line: null });
        continue;
      }
      let size;
      try {
        size = statSync(file).size;
      } catch {
        continue;
      }
      if (size > MAX_SCAN_BYTES) continue;
      const buf = readFileSync(file);
      if (buf.includes(0)) continue; // binary
      for (const f of scanText(buf.toString('utf8'), { secrets })) results.push({ file: rel, ...f });
    }
  }
  return results;
}

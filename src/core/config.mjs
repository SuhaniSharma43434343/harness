import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigInvalid } from './errors.mjs';
import { assertValid } from './schemas.mjs';

export const DEFAULT_CONFIG = Object.freeze({
  concurrency: 2,
  workspaceDir: 'workspace',
  taskTimeoutMinutes: 30,
  heartbeatStaleMinutes: 10,
  plugins: {},
});

// Minimal .env reader: KEY=VALUE lines, # comments, optional quotes.
// Values are never logged; callers only see which names are set.
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

// Loads forge.config.json from root (falls back to defaults) and .env (process env wins).
export function loadConfig(root, { env = process.env } = {}) {
  const configPath = join(root, 'forge.config.json');
  let fileConfig = {};
  let source = 'defaults';
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (err) {
      throw new ConfigInvalid('forge.config.json is not valid JSON', {
        hint: `Fix the syntax in ${configPath} (${err.message})`,
      });
    }
    source = configPath;
  }
  const config = { ...DEFAULT_CONFIG, ...fileConfig, plugins: { ...(fileConfig.plugins ?? {}) } };
  assertValid('config', config, 'forge.config.json');

  const envPath = join(root, '.env');
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const mergedEnv = { ...fileEnv, ...env };

  return { config, source, env: mergedEnv, envFileFound: existsSync(envPath) };
}

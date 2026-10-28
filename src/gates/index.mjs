import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ForgeError, SchemaInvalid } from '../core/errors.mjs';
import { assertValid } from '../core/schemas.mjs';
import { gateContext, visibleText } from './context.mjs';
import claims from './claims.mjs';
import contentParity from './content-parity.mjs';
import dependencies from './dependencies.mjs';
import licences from './licences.mjs';
import secrets from './secrets.mjs';
import seo from './seo.mjs';

// Each gate: { name, version, thresholds, run(ctx, thresholds) => { status?, findings, metrics?, evidence? } }.
// A gate's run decides pass or fail from its findings; runGate adds the timing, the schema
// check and the error handling, so no gate can report a pass it did not earn.
export const GATES = new Map([contentParity, claims, licences, secrets, seo, dependencies].map((g) => [g.name, g]));

// The order runGates reports them in: cheap file checks first, browser checks after.
export const GATE_ORDER = ['content-parity', 'claims', 'licences', 'secrets', 'seo', 'dependencies', 'routes', 'accessibility', 'forms', 'responsive', 'performance'];

export function registerGate(gate) {
  GATES.set(gate.name, gate);
}

const BLOCKING = new Set(['critical', 'serious']);

// runGate(name, siteDir, opts?) => Promise<GateResult>
// Never throws for a site problem: a failing site is status 'fail' with findings. A gate that
// cannot run (a missing tool, missing input) is status 'error' with the error code, which
// qualityFloor never counts as a pass.
export async function runGate(name, siteDir, opts = {}) {
  const gate = GATES.get(name);
  if (!gate) throw new SchemaInvalid(`Unknown gate "${name}"`, { hint: `Known gates: ${[...GATES.keys()].join(', ')}` });
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const thresholds = { ...gate.thresholds, ...(opts.thresholds ?? {}) };
  const base = { gate: name, gateVersion: gate.version, ...(opts.project ? { project: opts.project } : {}), thresholds };

  let result;
  try {
    const ctx = gateContext(siteDir, opts);
    const empty = emptySite(ctx);
    const out = empty ? { findings: [empty] } : await gate.run(ctx, thresholds);
    const findings = out.findings ?? [];
    const status = out.status ?? (findings.some((f) => BLOCKING.has(f.severity)) ? 'fail' : 'pass');
    result = { ...base, status, startedAt, finishedAt: now().toISOString(), metrics: out.metrics ?? {}, findings, evidence: out.evidence ?? [] };
    if (out.error) result.error = out.error;
  } catch (err) {
    const code = err instanceof ForgeError ? err.code : 'GATE_FAILED';
    const message = [err.message, err.hint].filter(Boolean).join(' ');
    result = { ...base, status: 'error', startedAt, finishedAt: now().toISOString(), metrics: {}, findings: [], evidence: [], error: { code, message } };
  }
  return assertValid('gateResult', result, `${name} gate result`);
}

// No gate passes a site it could not check: no build, or built pages with no text at all.
function emptySite(ctx) {
  if (!ctx.hasDist()) return { id: 'no-build', severity: 'critical', message: 'No built site at site/dist: run the build first' };
  const routes = ctx.routes();
  if (!routes.length) return { id: 'no-pages', severity: 'critical', message: 'The build has no pages' };
  if (routes.every((r) => !visibleText(ctx.doc(r)))) return { id: 'empty-site', severity: 'critical', message: 'Every built page is empty' };
  return null;
}

// runGates(siteDir, opts) => Promise<GateResult[]>
// Runs the named gates (all by default) in a fixed order, never stopping early, and writes each
// result to evidence/gates/<gate>.json in the project folder.
export async function runGates(siteDir, opts = {}) {
  const names = opts.gates ?? GATE_ORDER.filter((n) => GATES.has(n));
  const order = GATE_ORDER.filter((n) => names.includes(n)).concat(names.filter((n) => !GATE_ORDER.includes(n)));
  const results = [];
  for (const name of order) {
    if (opts.signal?.aborted) break;
    const r = await runGate(name, siteDir, { ...opts, thresholds: opts.thresholds?.[name] });
    results.push(r);
    if (opts.write !== false) {
      const file = join(opts.projectDir ?? dirname(siteDir), 'evidence', 'gates', `${name}.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
    }
  }
  return results;
}

// qualityFloor(results, required?) => { met, failing }
// The P11 exit check: met only when every required gate is present and 'pass'. 'error' and
// 'skipped' count as failing, and so does a required gate with no result.
export function qualityFloor(results, required = GATE_ORDER) {
  const byGate = new Map(results.map((r) => [r.gate, r]));
  const failing = required.filter((g) => byGate.get(g)?.status !== 'pass');
  return { met: failing.length === 0, failing };
}

export const finding = (id, severity, message, extra = {}) => ({ id, severity, message, ...extra });

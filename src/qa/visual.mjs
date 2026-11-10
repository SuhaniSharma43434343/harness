import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check } from '../core/schemas.mjs';
import { ROOT } from '../core/workspace.mjs';
import { writeLockedPages } from '../design/spec.mjs';
import { buildSite } from '../site/build.mjs';

// Visual QA: building from the specification, and the model's review of what was built.

const CLI = join(ROOT, 'src', 'cli', 'index.mjs');
export const REVIEW_FILE = 'reports/visual-review.json';
const SCORE_FLOOR = 3.5;
const BLOCKING = new Set(['critical', 'serious']);

// A fingerprint of the build, so a review of an older build never counts for the current one.
export function distHash(dist) {
  if (!existsSync(dist)) return '';
  const hash = createHash('sha256');
  for (const f of readdirSync(dist, { recursive: true }).map(String).sort()) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    hash.update(f.replaceAll('\\', '/'));
    hash.update(readFileSync(join(dist, f)));
  }
  return hash.digest('hex').slice(0, 16);
}

// The locked pages and site copy, as the build should see them. Exported for its tests.
export function syncContent(dir) {
  writeLockedPages(dir);
  const pages = join(dir, 'content', 'pages');
  const target = join(dir, 'site', 'src', 'content', 'pages');
  if (existsSync(pages)) {
    rmSync(target, { recursive: true, force: true });
    cpSync(pages, target, { recursive: true });
  }
  const copy = join(dir, 'content', 'copy.json');
  if (existsSync(copy)) cpSync(copy, join(dir, 'site', 'src', 'copy.json'));
  const pub = join(dir, 'assets', 'public');
  if (existsSync(pub)) {
    cpSync(pub, join(dir, 'site', 'public'), { recursive: true });
    pruneUnreferenced(dir, pub);
  }
}

// Ship only what the site uses. The whole asset folder is synced for the build, then any copy
// nothing references (not the site sources, the asset plan, or the register) is removed again,
// so unused files never reach dist, the licences gate, or a visitor.
function pruneUnreferenced(dir, pub) {
  const refs = [];
  const srcDir = join(dir, 'site', 'src');
  if (existsSync(srcDir)) {
    for (const f of readdirSync(srcDir, { recursive: true }).map(String)) {
      const p = join(srcDir, f);
      if (/\.(astro|html|css|js|mjs|ts|jsx|tsx|json|md)$/.test(f)) refs.push(readFileSync(p, 'utf8'));
    }
  }
  for (const f of ['design/asset-plan.json', 'assets/register.json']) {
    const p = join(dir, f);
    if (existsSync(p)) refs.push(readFileSync(p, 'utf8'));
  }
  const referenced = refs.join('\n');
  for (const e of readdirSync(pub, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const rel = join(e.parentPath ?? e.path, e.name).slice(pub.length + 1).replaceAll('\\', '/');
    if (referenced.includes(rel) || referenced.includes(e.name)) continue;
    rmSync(join(dir, 'site', 'public', rel), { force: true });
  }
}

// One build of a site at a time. Page tasks run in parallel, and each one's check builds the same
// site/ and reads the same site/dist, so the sync, build and render hold a lock: a directory, which
// is created atomically. A lock older than LOCK_STALE_MS is left by a crash and is taken over.
const LOCK_STALE_MS = 15 * 60 * 1000;
export async function withSiteLock(dir, fn, { pollMs = 500, now = () => Date.now() } = {}) {
  const lock = join(dir, 'locks', 'site-build');
  mkdirSync(join(dir, 'locks'), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = now() - statSync(lock).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true });
      else await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// A finding belongs to a page when its location is that page's route.
const onPage = (location, page) => {
  const route = String(location ?? '').split(' @ ')[0].split(' (')[0].trim();
  return route === page;
};

// buildFromSpec(dir, { page }) => problems. Builds the site, then renders it against the
// specification. The builder has no shell, so this output is how it learns what failed. With page,
// only that page is rendered and judged; the build itself must still succeed for the whole site.
export async function buildFromSpec(dir, { page } = {}) {
  return withSiteLock(dir, async () => {
    syncContent(dir);
    const site = join(dir, 'site');
    if (!existsSync(join(site, 'package.json'))) return ['site/ does not exist'];
    const b = buildSite(site);
    if (!b.ok) return [`The site does not build:\n${b.output.trim().split('\n').slice(-25).join('\n')}`];
    const { runGate } = await import('../gates/index.mjs');
    const problems = [];
    for (const gate of ['content-parity', 'design-fidelity']) {
      const r = await runGate(gate, site, { projectDir: dir, ...(page ? { page } : {}) });
      if (r.status === 'error') problems.push(`The ${gate} check could not run: ${r.error?.message ?? ''}`);
      const blocking = r.findings.filter((f) => BLOCKING.has(f.severity) && (!page || onPage(f.location, page)));
      problems.push(...blocking.map((f) => `${f.id}${f.location ? ` [${f.location}]` : ''}: ${f.message}`));
    }
    if (!page) problems.push(...stubsLeft(dir).map((f) => `${f} is still a placeholder: its page task has not built it`));
    return problems;
  });
}

// Placeholder section components, written before parallel page builds so the site always builds.
export const STUB_MARK = 'data-forge-stub';
export function stubsLeft(dir) {
  const root = join(dir, 'site', 'src', 'sections');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith('.astro') && readFileSync(join(root, f), 'utf8').includes(STUB_MARK)).map((f) => `site/src/sections/${f.replaceAll('\\', '/')}`);
}

export function checkVisualReview(dir) {
  const file = join(dir, REVIEW_FILE);
  if (!existsSync(file)) return [`${REVIEW_FILE} is missing`];
  let review;
  try {
    review = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [`${REVIEW_FILE} is not valid JSON`];
  }
  return check('visualReview', review).errors.map((e) => `${REVIEW_FILE}: ${e}`);
}

const shotsIn = (dir) => {
  const shots = join(dir, 'evidence', 'visual');
  return existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.jpg')).sort().map((f) => `evidence/visual/${f}`) : [];
};

// The QA Verifier's look at the rendered site, as a task contract. It opens the screenshots and
// compares them with the specification; nothing a builder wrote about its own work is an input.
export function visualReviewTask(project, dir, number) {
  const id = `visual-review-${number}`;
  const buildHash = distHash(join(dir, 'site', 'dist'));
  return {
    id,
    agent: 'qa-verifier',
    approach_modules: [],
    inputs: ['design/direction.md', 'design/direction.json', 'design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'content/copy.json', 'design/reference/methodologies/**', 'design/reference/craft/**', ...shotsIn(dir)],
    owns_files: [REVIEW_FILE],
    must_not_touch: ['site/**', 'content/**', 'design/**', 'intake/**'],
    depends_on: [],
    acceptance: [
      `Open every screenshot listed in the inputs with the Read tool. They show each section at desktop and mobile, named <page>-<viewport>-<section>.jpg. Compare each with its section plan entry`,
      'Judge as a demanding art director who has seen thousands of templates: does this look designed for this business, or like a template with the words changed? Does each section match its planned composition? Is the type system applied? Is the approach preserved as a complete method? Is anything cramped, clipped, unreadable or empty? Are the mobile layouts composed or merely stacked?',
      'Read design/reference/craft/awwwards.md and judge as Awwwards would: Design 40%, Usability 30%, Creativity 20%, Content 10%. A centred hero, rows of equal cards, one repeated section shape, one typeface weight, fade-up on everything or a short page is a serious finding, however clean it looks',
      "Look hard at these: a stock photo presented as the client's own finished job (critical); any authored drawing, map or floor plan that looks broken or unfinished; interactive parts that seem not to work; text that is unreadable over its background",
      'Each finding names the section, the specification line it violates (quote the plan or copy as it now stands, never an older version), what would fix it, and the screenshot as evidence. Use "critical" or "serious" for anything that makes the site look generic or breaks the specification. If the plan and the copy disagree with each other, the defect belongs to the stale stage, not the build',
      `Score 0 to 5 for distinctiveness, composition, typography, contentFit and specFidelity. Be honest: 3 is a competent template. The scores are telemetry; verdict "pass" when no finding is critical or serious. Set approachPreserved truthfully`,
      `Write ${REVIEW_FILE} with buildHash "${buildHash}". The file must match the "visualReview" definition in design/reference/design-spec.schema.json`,
    ],
    verify: `"${process.execPath}" "${CLI}" check visual-review`,
    budget: { minutes: 25, retries: 1 },
    idempotency_key: `${project}:${id}:v1`,
    status: 'pending',
    evidence: [],
  };
}

// The gate over the review: fails on no review, a stale one, or what the review found.
export const visualReviewGate = {
  name: 'visual-review',
  version: '0.1.0',
  thresholds: { minScore: SCORE_FLOOR },
  run(ctx, t) {
    const file = join(ctx.projectDir, REVIEW_FILE);
    if (!existsSync(file)) return { findings: [{ id: 'no-visual-review', severity: 'critical', message: 'Nobody has looked at this build: there is no visual review' }] };
    const problems = checkVisualReview(ctx.projectDir);
    if (problems.length) return { findings: problems.map((message) => ({ id: 'invalid-review', severity: 'critical', message })) };
    const review = JSON.parse(readFileSync(file, 'utf8'));
    const current = distHash(ctx.dist);
    if (review.buildHash !== current) return { findings: [{ id: 'stale-visual-review', severity: 'critical', message: `The visual review is of build ${review.buildHash}, but the site is now ${current}` }] };
    const findings = review.findings.map((f) => ({ id: f.id, severity: f.severity, message: f.message, location: f.section, evidence: f.evidence }));
    // Scores are telemetry, not verdicts: across runs they measured reviewer variance more than the
    // site (a 3.7-4.2 band on very different sites, then 3.9 to 3.0 swings on one). Only concrete,
    // evidenced findings block; low scores are reported for the record.
    for (const [name, score] of Object.entries(review.scores)) {
      if (score < t.minScore) findings.push({ id: `low-${name.toLowerCase()}`, severity: 'minor', message: `The visual review scored ${name} ${score} of 5 (guide floor ${t.minScore})` });
    }
    if (!review.approachPreserved) findings.push({ id: 'approach-not-preserved', severity: 'serious', message: 'The visual review found the chosen approach was not preserved' });
    if (review.verdict !== 'pass' && !findings.some((f) => BLOCKING.has(f.severity))) findings.push({ id: 'review-failed', severity: 'minor', message: 'The visual review withheld a pass without naming a critical or serious finding' });
    return { findings, metrics: review.scores };
  },
};

export const ensureReportsDir = (dir) => mkdirSync(join(dir, 'reports'), { recursive: true });

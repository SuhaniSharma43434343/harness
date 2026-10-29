import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Verify checks for the planned tasks (forge check <name>, run in the project folder). Each one
// returns the list of problems; an empty list means the task's acceptance criteria hold.

const PLACEHOLDER = /\b(lorem ipsum|todo|tbd|tk|placeholder|coming soon|xxx)\b|\[(insert|add|your)[^\]]*\]/i;
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function frontmatter(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { head: m[1], body: m[2] } : null;
}

export const CHECKS = {
  research(dir) {
    const problems = [];
    const summary = join(dir, 'research', 'summary.md');
    const sources = join(dir, 'research', 'sources.json');
    if (!existsSync(summary) || readFileSync(summary, 'utf8').trim().length < 200) problems.push('research/summary.md is missing or too short');
    if (!existsSync(sources)) return [...problems, 'research/sources.json is missing'];
    let data;
    try {
      data = readJson(sources);
    } catch {
      return [...problems, 'research/sources.json is not valid JSON'];
    }
    if (!Array.isArray(data.sources) || !data.sources.length) problems.push('research/sources.json needs a non-empty "sources" list');
    for (const s of data.sources ?? []) if (!s.id || !s.title || !s.kind || !s.ref) problems.push(`source ${s.id ?? '(no id)'} needs id, title, kind and ref`);
    return problems;
  },

  content(dir) {
    const problems = [];
    const pagesDir = join(dir, 'content', 'pages');
    const brief = existsSync(join(dir, 'intake', 'brief.json')) ? readJson(join(dir, 'intake', 'brief.json')) : null;
    const files = existsSync(pagesDir) ? readdirSync(pagesDir).filter((f) => f.endsWith('.md')) : [];
    const wanted = (brief?.pages ?? []).map((p) => (p.slug === '/' ? 'index.md' : `${p.slug.slice(1)}.md`));
    for (const w of wanted) if (!files.includes(w)) problems.push(`content/pages/${w} is missing`);
    for (const f of files) {
      const text = readFileSync(join(pagesDir, f), 'utf8');
      const fm = frontmatter(text);
      if (!fm) {
        problems.push(`${f}: no frontmatter`);
        continue;
      }
      if (!/^title:\s*\S/m.test(fm.head)) problems.push(`${f}: no title`);
      if (!/^sections:/m.test(fm.head)) problems.push(`${f}: no sections`);
      if (!/^status:\s*"?locked"?\s*$/m.test(fm.head)) problems.push(`${f}: status is not "locked"`);
      if (PLACEHOLDER.test(text)) problems.push(`${f}: has placeholder text`);
      if (text.replace(/^---[\s\S]*?---/, '').trim().length < 80 && !/lead:|text:/.test(fm.head)) problems.push(`${f}: has almost no copy`);
    }
    const claims = join(dir, 'content', 'claims.json');
    if (existsSync(claims)) {
      try {
        const c = readJson(claims);
        if (!Array.isArray(c.claims)) problems.push('content/claims.json needs a "claims" list');
      } catch {
        problems.push('content/claims.json is not valid JSON');
      }
    }
    return problems;
  },

  assets(dir) {
    const file = join(dir, 'assets', 'register.json');
    if (!existsSync(file)) return ['assets/register.json is missing'];
    let r;
    try {
      r = readJson(file);
    } catch {
      return ['assets/register.json is not valid JSON'];
    }
    if (!Array.isArray(r.assets)) return ['assets/register.json needs an "assets" list'];
    return r.assets.filter((a) => !a.licence || !a.source || !a.status).map((a) => `register row ${a.file ?? a.path ?? a.package ?? '?'} needs licence, source and status`);
  },
};

export function runCheck(name, dir) {
  const check = CHECKS[name];
  if (!check) throw new Error(`Unknown check "${name}". Checks: ${Object.keys(CHECKS).join(', ')}`);
  return check(dir);
}

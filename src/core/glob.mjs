import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Minimal glob support for owns_files and must_not_touch: `**` matches any number of folders,
// `*` and `?` stay inside one path segment, `{a,b}` picks one of the options.
export function globToRegExp(pattern) {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) re += '\\{';
      else {
        re += `(?:${p.slice(i + 1, end).split(',').map(escapeRe).join('|')})`;
        i = end;
      }
    } else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

function escapeRe(s) {
  return s.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function matcher(patterns) {
  const res = patterns.map(globToRegExp);
  return (path) => {
    const p = path.replace(/\\/g, '/');
    return res.some((re) => re.test(p));
  };
}

// Lists files under `root` (as forward-slash relative paths), skipping folders in `skip`.
export function walk(root, { skip = [] } = {}) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(root, full).replace(/\\/g, '/');
      if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (e.isDirectory()) visit(full);
      else if (e.isFile()) out.push(rel);
    }
  };
  visit(root);
  return out.sort();
}

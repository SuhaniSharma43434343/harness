// Turns an operator's typed text into the brief shape for the fields that need a structure.
// The Project Manager agent does this with the model; this is the plain CLI path, so it keeps
// to simple, predictable rules: one item per line or semicolon.
const items = (text) =>
  String(text)
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

const accessStatus = (text, rules) => Object.entries(rules).find(([, re]) => re.test(text))?.[0] ?? 'unknown';
const LANGUAGES = { english: 'en', hindi: 'hi', french: 'fr', spanish: 'es', german: 'de', italian: 'it', portuguese: 'pt', dutch: 'nl', arabic: 'ar', japanese: 'ja' };

const SHAPES = {
  goals: (t) => items(t).map((statement, i) => ({ id: `${slugify(statement).split('-').slice(0, 3).join('-')}-${i + 1}`, statement })),
  // "Segment: need | wants: ... | proof: ... | action: ... | from: ..., ... | mood: ...": the parts
  // after the need are optional.
  audience: (t) =>
    items(t).map((line) => {
      const [head, ...views] = line.split('|');
      const [segment, ...need] = head.split(':');
      const out = { segment: segment.trim(), need: need.join(':').trim() || 'To be refined in research' };
      for (const v of views) {
        const m = v.match(/^\s*(wants|proof|action|from|mood)\s*:\s*(.+?)\s*$/i);
        if (!m) continue;
        const key = m[1].toLowerCase();
        if (key === 'from') out.arrivesFrom = [...new Set(m[2].split(',').map((s) => s.trim()).filter(Boolean))];
        else out[key] = m[2];
      }
      return out;
    }),
  // "kind: fact", where kind is optional.
  truths: (t) =>
    items(t).slice(0, 6).map((line) => {
      const m = line.match(/^\s*(place|people|material|history|method|number|other)\s*:\s*(.+)$/i);
      return m ? { text: m[2].trim(), kind: m[1].toLowerCase() } : { text: line };
    }),
  jobs: (t) => [...new Set(items(t))].slice(0, 4),
  // "never on /, /about: Smith" or "always on *: Licence 12345"; with no pages, every page.
  contentRules: (t) =>
    items(t).flatMap((line) => {
      const m = line.match(/^\s*(never|always)(?:\s+on\s+([^:]+?))?\s*:\s*(.+)$/i);
      if (!m) return [];
      const pages = m[2] ? [...new Set(m[2].split(/[\s,]+/).filter(Boolean))] : ['*'];
      return [{ rule: m[1].toLowerCase(), text: m[3].trim(), pages }];
    }),
  // "domain: example.com, client will give", "dns: unknown", then "<material>: <quality>, <where>".
  access: (t) => {
    const out = {};
    for (const line of items(t)) {
      const [label, ...rest] = line.split(':');
      const key = label.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (!value) continue;
      if (key === 'domain') {
        const name = value.match(/[a-z0-9-]+(\.[a-z0-9-]+)+/i)?.[0]?.toLowerCase();
        out.domain = { ...(name ? { name } : {}), status: accessStatus(value, { 'have-access': /we have|have access/i, 'client-will-give': /client|will give/i, 'to-buy': /buy/i }) };
      } else if (key === 'dns') {
        out.dns = accessStatus(value, { 'have-access': /we have|have access/i, 'client-will-change': /client|will change/i });
      } else {
        const quality = value.match(/\b(good|usable|poor|unknown)\b/i)?.[1]?.toLowerCase() ?? 'unknown';
        const where = value.replace(/\b(good|usable|poor|unknown)\b/i, '').replace(/^[\s,;-]+|[\s,;-]+$/g, '');
        (out.assets ??= []).push({ item: label.trim(), quality, ...(where ? { where } : {}) });
      }
    }
    return out;
  },
  'client.languages': (t) => items(t).slice(0, 1).map((l) => LANGUAGES[l.toLowerCase()] ?? l),
  pages: (t) =>
    items(t).map((title, i) => ({
      slug: i === 0 && /^home$/i.test(title) ? '/' : `/${slugify(title)}`,
      title,
      purpose: `${title} page`,
      cta: 'Get in touch',
    })),
  'brand.avoid': items,
  // Hex codes in the order given, #abc widened to #aabbcc. "none", or text with no codes, is [].
  'brand.existingAssets.colours': (t) => [
    ...new Set(
      [...String(t).matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/gi)].map(([, h]) => `#${(h.length === 3 ? [...h].map((c) => c + c).join('') : h).toLowerCase()}`),
    ),
  ],
  // Up to three font names, headings first. "none" is [].
  'brand.existingAssets.fonts': (t) => [...new Set(String(t).split(/[\n;,]+/).map((s) => s.trim()).filter((s) => s && !/^(none|no|n\/a)\.?$/i.test(s)))].slice(0, 3),
  'features.forms': (t) =>
    items(t).map((purpose) => ({ id: slugify(purpose), purpose, fields: ['name', 'email', 'message'], destination: 'none-yet' })),
};

// shapeAnswer(question, value): only text answers to structured fields change.
export function shapeAnswer(question, value) {
  if (question.kind !== 'text' || typeof value !== 'string' || question.fills.length !== 1) return value;
  const shape = SHAPES[question.fills[0]];
  return shape ? shape(value) : value;
}

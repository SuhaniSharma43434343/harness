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

const SHAPES = {
  goals: (t) => items(t).map((statement, i) => ({ id: `${slugify(statement).split('-').slice(0, 3).join('-')}-${i + 1}`, statement })),
  audience: (t) =>
    items(t).map((line) => {
      const [segment, ...need] = line.split(':');
      return { segment: segment.trim(), need: need.join(':').trim() || 'To be refined in research' };
    }),
  pages: (t) =>
    items(t).map((title, i) => ({
      slug: i === 0 && /^home$/i.test(title) ? '/' : `/${slugify(title)}`,
      title,
      purpose: `${title} page`,
      cta: 'Get in touch',
    })),
  'brand.avoid': items,
  'features.forms': (t) =>
    items(t).map((purpose) => ({ id: slugify(purpose), purpose, fields: ['name', 'email', 'message'], destination: 'none-yet' })),
};

// shapeAnswer(question, value): only text answers to structured fields change.
export function shapeAnswer(question, value) {
  if (question.kind !== 'text' || typeof value !== 'string' || question.fills.length !== 1) return value;
  const shape = SHAPES[question.fills[0]];
  return shape ? shape(value) : value;
}

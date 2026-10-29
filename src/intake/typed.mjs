import { checkAnswer } from './questions.mjs';
import { shapeAnswer } from './shape.mjs';

// Turns what the operator typed at the terminal into an answer, or explains why it is not one,
// so the CLI can ask again straight away instead of failing after the whole round.
// parseTyped(question, text) => { answer } | { error }
// An empty line (or r, rec, "use your recommendation") means 'use-recommendation'.

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Whether words appear in text as whole words (at the start only, when atStart is set).
function hasWords(text, words, atStart) {
  const t = ` ${norm(text)} `;
  const w = ` ${norm(words)} `;
  return atStart ? t.startsWith(w) : t.includes(w);
}

// One option from typed text: its number in the list, its value or label (any case), then the
// start of a label ("up to 12 pages", "AAA"), then whole words inside a label ("data
// visualisation"). A tier that matches more than one option is ambiguous, not a guess.
export function matchOption(q, text) {
  const s = text.trim();
  const options = q.options ?? [];
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n >= 1 && n <= options.length) return { value: options[n - 1].value };
    return { error: `There is no option ${n}. Type a number from 1 to ${options.length}.` };
  }
  if (!norm(s)) return { error: 'Type an option number or its words.' };
  const tiers = [
    (o) => norm(o.value) === norm(s) || norm(o.label) === norm(s),
    (o) => hasWords(o.label, s, true) || hasWords(o.value, s, true),
    (o) => hasWords(o.label, s, false),
  ];
  for (const fits of tiers) {
    const found = options.filter(fits);
    if (found.length === 1) return { value: found[0].value };
    if (found.length > 1) return { error: `"${s}" fits more than one option (${found.map((o) => o.label).join('; ')}). Type its number instead.` };
  }
  return { error: `"${s}" is not one of the options. Type a number from 1 to ${options.length}.` };
}

export function parseTyped(q, text) {
  const t = String(text ?? '').trim();
  if (!t || /^(r|rec|use your recommendation)$/i.test(t)) return { answer: 'use-recommendation' };
  let value;
  switch (q.kind) {
    case 'single': {
      const m = matchOption(q, t);
      if (m.error) return m;
      value = m.value;
      break;
    }
    case 'multi': {
      if (t === '-' || /^none$/i.test(t)) {
        value = [];
        break;
      }
      value = [];
      for (const part of t.split(',').map((p) => p.trim()).filter(Boolean)) {
        const m = matchOption(q, part);
        if (m.error) return m;
        if (!value.includes(m.value)) value.push(m.value);
      }
      break;
    }
    case 'boolean':
      if (/^(y|yes|true)$/i.test(t)) value = true;
      else if (/^(n|no|false)$/i.test(t)) value = false;
      else return { error: 'Type yes or no.' };
      break;
    case 'number':
      value = Number(t);
      break;
    default:
      value = shapeAnswer(q, t);
  }
  if (q.fills.length === 1) {
    try {
      checkAnswer(q, value);
    } catch (err) {
      return { error: err.message };
    }
  }
  return { answer: value };
}

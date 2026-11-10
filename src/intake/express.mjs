import { detectIndustry } from '../registry/industries.mjs';
import { shapeAnswer } from './shape.mjs';

// Express intake: the owner writes one sentence or paragraph about the business. Everything the
// words already say is taken from them, every other question uses the playbook's recommendation
// (recorded as an assumption, shown at B1), and the owner is asked only for what nobody can guess:
// the business name and what it does. The operator can still change any answer with --answers.
// All of this is deterministic text matching. It never guesses a fact about the business.

const TYPE_WORDS = [
  ['portfolio', /\b(portfolio|my work|freelance)\b/i],
  ['event', /\b(event|conference|festival|summit|meetup|wedding invite)\b/i],
  ['nonprofit', /\b(non-?profit|charity|ngo|foundation|donat\w+)\b/i],
  ['launch', /\b(product launch|launch page|coming soon|waitlist)\b/i],
  ['showroom', /\b(showroom|product showcase|3d product)\b/i],
];
const BIG = /\b(large|big|full|complete|detailed|long|many pages|multi-?page|comprehensive|premium|flagship|everything)\b/i;
const SMALL = /\b(small|simple|single[- ]page|one[- ]page|landing page|basic|quick)\b/i;

// Fields only the owner can supply. Express asks for these and nothing else.
export const ESSENTIAL_FIELDS = ['client.name', 'client.industry'];
// Asked once at a terminal because the whole design rests on the answer; Enter skips it and the
// recommendation is used. Without a terminal it is never asked.
export const KEY_FIELDS = ['business.uniqueFacts'];

const clean = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '').trim();

// "Name: X", "called X", "named X", or the first capitalised phrase after "for".
function findName(text) {
  const label = text.match(/^\s*(?:business\s+)?name\s*[:=-]\s*(.+)$/im);
  if (label) return clean(label[1]).slice(0, 80);
  const called = text.match(/\b(?:called|named|name is)\s+["“']?([A-Z0-9][\w&'’.-]*(?:\s+[A-Z0-9&][\w&'’.-]*){0,4})/);
  if (called) return clean(called[1]);
  const forWho = text.match(/\bfor\s+(?:(?:a|an|my|our|the)\s+)?([A-Z][\w&'’.-]*(?:\s+[A-Z&][\w&'’.-]*){0,4})/);
  if (forWho) return clean(forWho[1]);
  return undefined;
}

// What the business does, in the owner's words: the prompt without the "build me a website for" lead-in
// and without the name.
function findDescription(text, name) {
  let d = text
    .split('\n')
    .filter((l) => !/^\s*(?:business\s+)?name\s*[:=-]/i.test(l))
    .join(' ');
  d = d.replace(/^\s*(?:please\s+)?(?:build|make|create|design|i (?:want|need)|we (?:want|need))\b[^.,:;]*?\b(?:website|site|web ?page|landing page)\b\s*(?:for|of)?\s*/i, '');
  if (name) d = d.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), '');
  d = clean(d);
  return d.length >= 3 ? d.slice(0, 240) : clean(text).slice(0, 240);
}

// extractFromPrompt(text, industries?) => { answers, found, assumed }
// answers: question id -> answer. found: what the words said. assumed: what express chose for them.
export function extractFromPrompt(text, industries = []) {
  const raw = String(text ?? '');
  const t = raw.replace(/\s+/g, ' ').trim();
  const answers = {};
  const found = [];
  const assumed = [];
  if (!t) return { answers, found, assumed };

  const name = findName(raw);
  if (name) {
    answers['q-client-name'] = name;
    found.push(`business name: ${name}`);
  }
  answers['q-industry'] = findDescription(raw, name);
  found.push(`what it does: ${answers['q-industry']}`);

  const typed = TYPE_WORDS.find(([, re]) => re.test(t));
  const industry = detectIndustry(t, industries);
  if (typed && !industry) {
    answers['q-project-type'] = typed[0];
    found.push(`kind of site: ${typed[0]}`);
  } else {
    answers['q-project-type'] = 'business';
    if (industry) found.push(`kind of business: ${industry.id}`);
    else assumed.push('a business site (the words do not name another kind)');
  }

  if (BIG.test(t) && !SMALL.test(t)) {
    answers['q-tier'] = 'L';
    found.push('size: large (the words ask for a full site)');
  } else if (SMALL.test(t)) {
    answers['q-tier'] = 'S';
    found.push('size: small (the words ask for a simple site)');
  } else {
    answers['q-tier'] = 'M';
    assumed.push('a medium site of about 11 pages');
  }
  return { answers, found, assumed };
}

// expressAsk(given, opts) => ask(questions, ctx)
// given: question id -> answer (from the prompt, then --answers on top).
// opts.askOperator: asks the operator the questions that only they can answer (a terminal prompt).
// opts.deep: ask every question that the words did not answer, like forge intake does.
export function expressAsk(given, { askOperator, deep = false } = {}) {
  return async (questions, ctx) => {
    const answers = new Array(questions.length);
    const ask = [];
    questions.forEach((q, i) => {
      if (q.id in given) answers[i] = shapeAnswer(q, given[q.id]);
      else if (deep || q.fills.some((f) => ESSENTIAL_FIELDS.includes(f) || KEY_FIELDS.includes(f))) ask.push(i);
      else answers[i] = 'use-recommendation';
    });
    if (ask.length && askOperator) {
      const typed = await askOperator(ask.map((i) => questions[i]), ctx);
      ask.forEach((qi, k) => {
        const a = typed?.[k];
        answers[qi] = typeof a === 'string' ? (a.trim() ? shapeAnswer(questions[qi], a.trim()) : undefined) : a;
      });
    }
    // A key question the owner skips (or nobody could be asked) uses its recommendation. An essential
    // one stays unanswered, so intake says what is missing instead of guessing.
    ask.forEach((qi) => {
      if (answers[qi] === undefined && !questions[qi].fills.some((f) => ESSENTIAL_FIELDS.includes(f)) && !deep) answers[qi] = 'use-recommendation';
    });
    return answers;
  };
}

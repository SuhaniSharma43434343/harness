// The savings calculator's arithmetic. Plain JavaScript with no dependencies, so the section
// renders the default result at build time, its script reuses it in the browser, and the harness
// tests import it directly.
//
// A formula is a sum of products: [["hours", "rate", 52, 0.5]] is hours x rate x 52 x 0.5.
// Each factor is an input's name or a plain number; a negative number subtracts a term.

// compute(formula, values) => number, or NaN when an input is missing or not a number.
export function compute(formula, values) {
  let total = 0;
  for (const term of formula) {
    let product = 1;
    for (const f of term) product *= typeof f === 'number' ? f : Number(values[f]);
    total += product;
  }
  return total;
}

// format(n, { prefix, suffix, decimals }, lang) => "£5,200": grouped digits in the page language.
export function format(n, result = {}, lang = 'en') {
  const d = result.decimals ?? 0;
  const text = n.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${result.prefix ?? ''}${text}${result.suffix ?? ''}`;
}

// explain(formula, inputs) => "Hours spent on admin each week × What an hour... × 52 × 0.5":
// the formula in words, shown under the result so it is never a black box.
export function explain(formula, inputs = []) {
  const label = (f) => (typeof f === 'number' ? String(f) : (inputs.find((i) => i.name === f)?.label ?? f));
  return formula.map((term) => term.map(label).join(' × ')).join(' + ');
}

// check(formula, inputs) => problems: a factor that names no input, or one that is neither a
// name nor a finite number. The section fails the build on any, so a typo is never a wrong sum.
export function check(formula, inputs = []) {
  const names = new Set(inputs.map((i) => i.name));
  const problems = [];
  if (!Array.isArray(formula) || formula.length === 0) return ['formula must be a list of terms, like [["hours", "rate", 52]]'];
  for (const term of formula) {
    if (!Array.isArray(term) || term.length === 0) {
      problems.push(`a formula term must be a list of factors, got ${JSON.stringify(term)}`);
      continue;
    }
    for (const f of term) {
      if (typeof f === 'number' ? !Number.isFinite(f) : !names.has(f)) problems.push(`formula factor ${JSON.stringify(f)} is not a number or an input name`);
    }
  }
  return problems;
}

// The shared rule condition language (schemas/condition.schema.json), evaluated against a brief.
// Question rules (T14), approach selection rules (T16) and design rules (T17) all use it.

// Reads a dot path such as brand.motionIntensity. A missing step gives undefined.
export function getField(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

// A field exists when it is set and is not null, an empty string or an empty array.
function present(v) {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function leaf(actual, op, value) {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'in':
      return actual !== undefined && value.includes(actual);
    case 'notIn':
      return !value.includes(actual);
    case 'gte':
      return typeof actual === 'number' && actual >= value;
    case 'lte':
      return typeof actual === 'number' && actual <= value;
    case 'includes':
      return Array.isArray(actual) ? actual.includes(value) : typeof actual === 'string' && actual.includes(value);
    case 'exists':
      return present(actual);
    case 'missing':
      return !present(actual);
    default:
      throw new Error(`Unknown condition operator "${op}"`);
  }
}

// Describes one leaf in words, for decision reasons: "features.interactive includes 3d-product".
export function describeLeaf({ field, op, value }) {
  if (op === 'exists' || op === 'missing') return `${field} ${op}`;
  const v = Array.isArray(value) ? `[${value.join(', ')}]` : String(value);
  return `${field} ${op} ${v}`;
}

// Evaluates a condition. Returns { holds, matched }, where matched lists the leaves that made it
// hold (for all: every leaf; for any: the leaves that held). matched is empty when it does not hold.
export function evaluate(cond, data) {
  if (cond.all) {
    const parts = cond.all.map((c) => evaluate(c, data));
    const holds = parts.every((p) => p.holds);
    return { holds, matched: holds ? parts.flatMap((p) => p.matched) : [] };
  }
  if (cond.any) {
    const parts = cond.any.map((c) => evaluate(c, data));
    const hits = parts.filter((p) => p.holds);
    return { holds: hits.length > 0, matched: hits.flatMap((p) => p.matched) };
  }
  if (cond.not) {
    const inner = evaluate(cond.not, data);
    return { holds: !inner.holds, matched: inner.holds ? [] : [`not (${describeCondition(cond.not)})`] };
  }
  const holds = leaf(getField(data, cond.field), cond.op, cond.value);
  return { holds, matched: holds ? [describeLeaf(cond)] : [] };
}

export const holds = (cond, data) => evaluate(cond, data).holds;

export function describeCondition(cond) {
  if (cond.all) return cond.all.map(describeCondition).join(' and ');
  if (cond.any) return cond.any.map(describeCondition).join(' or ');
  if (cond.not) return `not (${describeCondition(cond.not)})`;
  return describeLeaf(cond);
}

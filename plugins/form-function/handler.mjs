// The form handler shared by the deployed Vercel function and the local endpoint. It uses only
// web-standard APIs (Request, Response, FormData), so the same file runs on Vercel and in Node.
//
// createHandler({ forms, forward, rateLimit, now }) => (request) => Promise<Response>
//   forms     { [formId]: { fields: [{ name, type, required }] } }, as in the site's site.json
//   forward   async (payload) => void; payload is { form, fields, receivedAt }
//
// The server checks every submission again: unknown forms and fields are refused or dropped,
// required fields and email addresses are checked, long values are refused, a filled honeypot
// field is accepted and dropped, and each client is rate limited.

export const HONEYPOT = '_gotcha';
const MAX_LENGTH = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export function createHandler({ forms, forward, rateLimit = { max: 5, windowMs: 60_000 }, now = () => Date.now() }) {
  // In-memory, so the limit is per running instance: a floor against floods, not a quota.
  const hits = new Map();

  function limited(key) {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < rateLimit.windowMs);
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear();
    return recent.length > rateLimit.max;
  }

  return async function handle(request) {
    if (request.method !== 'POST') return json(405, { ok: false, error: 'Use POST.' }, { Allow: 'POST' });
    const id = new URL(request.url).searchParams.get('form');
    const spec = id && Object.hasOwn(forms, id) ? forms[id] : null;
    if (!spec) return json(404, { ok: false, error: 'Unknown form.' });

    const client = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
    if (limited(`${id}:${client}`)) return json(429, { ok: false, error: 'Too many submissions. Please try again in a minute.' }, { 'Retry-After': '60' });

    let raw;
    try {
      const type = request.headers.get('content-type') ?? '';
      if (type.includes('application/json')) raw = await request.json();
      else raw = Object.fromEntries([...(await request.formData()).entries()].filter(([, v]) => typeof v === 'string'));
    } catch {
      return json(400, { ok: false, error: 'The form data could not be read.' });
    }
    if (!raw || typeof raw !== 'object') return json(400, { ok: false, error: 'The form data could not be read.' });

    // A bot filled the hidden field: answer as if it worked, and send nothing on.
    if (typeof raw[HONEYPOT] === 'string' && raw[HONEYPOT].trim()) return json(200, { ok: true });

    const fields = {};
    const errors = {};
    for (const f of spec.fields) {
      const value = typeof raw[f.name] === 'string' ? raw[f.name].trim() : '';
      if (!value) {
        if (f.required) errors[f.name] = 'This field is required.';
        continue;
      }
      if (value.length > (f.maxLength ?? MAX_LENGTH)) errors[f.name] = 'This value is too long.';
      else if (f.type === 'email' && !EMAIL.test(value)) errors[f.name] = 'Enter a valid email address.';
      else fields[f.name] = value;
    }
    if (Object.keys(errors).length) return json(422, { ok: false, errors });

    if (!forward) return json(503, { ok: false, error: 'This form is not connected yet.' });
    try {
      await forward({ form: id, fields, receivedAt: new Date(now()).toISOString() });
    } catch {
      return json(502, { ok: false, error: 'The message could not be delivered. Please try again.' });
    }
    return json(200, { ok: true });
  };
}

// Forwards a submission to the operator's webhook. A non-2xx answer is a failure.
export function webhookForwarder(url, fetchFn = fetch) {
  if (!url) return null;
  return async (payload) => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
  };
}

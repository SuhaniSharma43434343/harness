// form-mock: the same actions without writing a function or opening a port. Submissions sent
// to the mock endpoint are kept in memory and returned by `submissions()`.
const received = [];

export function actionFor(id) {
  return `/api/form?form=${encodeURIComponent(id)}`;
}

export async function install(_distDir, { forms }) {
  return { files: [], actions: Object.fromEntries(Object.keys(forms ?? {}).map((id) => [id, actionFor(id)])) };
}

export async function startLocalEndpoint() {
  return { url: 'http://127.0.0.1:4322/api/form', close: async () => {} };
}

export async function submissions() {
  return [...received];
}

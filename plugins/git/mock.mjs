// Recorded responses for mock mode: no repository is touched.
const commits = [];

export async function init() {
  return { created: commits.length === 0 };
}

export async function commit(_projectDir, message) {
  const sha = String(commits.length + 1).padStart(40, '0');
  commits.unshift({ sha, subject: message });
  return sha;
}

export async function status() {
  return { repo: true, changed: [] };
}

export async function log(_projectDir, { limit = 20 } = {}) {
  return commits.slice(0, limit);
}

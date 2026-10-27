// Stands in for `claude -p --output-format json` in the adapter tests. It reads the prompt from
// stdin, writes the first owned file, and prints a result shaped like Claude Code's.
// FAKE_CLAUDE picks the behaviour: ok (default), auth, ratelimit, garbage, noevidence, hang,
// or flaky (fails while the counter file named by FAKE_CLAUDE_COUNTER is below 1).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const mode = process.env.FAKE_CLAUDE ?? 'ok';
let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  const result = (text, extra = {}) => console.log(JSON.stringify({ type: 'result', is_error: false, result: text, total_cost_usd: 0.01, ...extra }));
  const task = prompt.match(/task "([^"]+)"/)[1];
  const owned = prompt.match(/globs allowed\):\n- (\S+)/)[1];

  if (mode === 'hang') return setTimeout(() => {}, 60_000);
  if (mode === 'garbage') return console.log('not json at all');
  if (mode === 'auth') {
    result('Not logged in · Please run /login', { is_error: true });
    process.exit(1);
  }
  if (mode === 'ratelimit') {
    result('API Error: 429 rate limit exceeded', { is_error: true });
    process.exit(1);
  }
  if (mode === 'flaky') {
    const counter = process.env.FAKE_CLAUDE_COUNTER;
    const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
    writeFileSync(counter, String(n + 1));
    if (n < 1) {
      result('API Error: overloaded', { is_error: true });
      process.exit(1);
    }
  }

  mkdirSync(dirname(owned), { recursive: true });
  writeFileSync(owned, `built ${task}\n`);
  if (mode === 'noevidence') return result('Done, but I forgot the evidence line.');
  result(`I wrote ${owned}.\n{"evidence": ["${owned}"]}`);
});

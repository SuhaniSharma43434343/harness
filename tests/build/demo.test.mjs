// forge demo (acceptance A3): the sample business project replays to a local preview with no
// model and no paid API. It runs in the harness's own workspace and removes its project after.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from '../../src/core/ledger.mjs';
import { loadProject } from '../../src/core/project.mjs';
import { DEFAULT_WORKSPACE, ROOT } from '../../src/core/workspace.mjs';
import { buildSkipReason } from './approach-helpers.mjs';

const skip = buildSkipReason();
const project = `demo-test-${process.pid}`;
after(() => rmSync(join(DEFAULT_WORKSPACE, project), { recursive: true, force: true }));

test('forge demo replays the sample project to a working local preview', { skip, timeout: 300_000 }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'src', 'cli', 'index.mjs'), 'demo', '--no-serve', '--project', project], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout + r.stderr).slice(-3000));
  assert.match(r.stdout, /The demo site for .* is at http:\/\/127\.0\.0\.1:\d+\/ \(smoke test passed\)/);

  const opts = { workspace: DEFAULT_WORKSPACE };
  assert.equal(loadProject(project, opts).phase, 'CREATIVE_DIRECTIONS');
  const entries = ledger.read(project, opts);
  assert.deepEqual(entries.filter((e) => e.type === 'approval').map((e) => [e.data.approval, e.data.note]), [['B1', 'given by forge demo'], ['B2', 'given by forge demo']]);
  assert.ok(entries.some((e) => e.data?.event === 'demo'));
  assert.equal(entries.filter((e) => e.type === 'refusal').length, 0, 'every phase move had its evidence and approval');
});

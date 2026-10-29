// forge go (goProject): one command from intake on, asking only for approvals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { goProject } from '../../src/core/go.mjs';
import * as ledger from '../../src/core/ledger.mjs';
import { advancePhase, approvals, approve, createProject, loadProject, PHASES } from '../../src/core/project.mjs';
import { runProject } from '../../src/core/runner.mjs';
import { ROOT, readJson, writeJsonAtomic } from '../../src/core/workspace.mjs';
import { proposeDirections } from '../../src/design/propose.mjs';
import { runIntake } from '../../src/intake/run.mjs';
import { scaffoldSite } from '../../src/site/scaffold.mjs';
import { loadApproaches } from '../../src/registry/load.mjs';
import { selectApproaches } from '../../src/registry/select.mjs';
import { passVerifier, recordingWorker, tmpWorkspace } from './helpers.mjs';

function setup() {
  const workspace = tmpWorkspace();
  createProject('acme', { brief: join(ROOT, 'samples/briefs/launch.json'), workspace });
  const opts = { workspace };
  const dir = join(workspace, 'acme');
  const calls = [];
  const steps = {
    intake: () => runIntake('acme', { ask: async (qs) => qs.map(() => 'use-recommendation'), ...opts }),
    directions: async () => {
      const brief = readJson(join(dir, 'intake/brief.json'));
      const { approaches, matrix } = loadApproaches();
      const decision = selectApproaches(brief, approaches, matrix);
      writeJsonAtomic(join(dir, 'design/approach-decision.json'), decision);
      writeJsonAtomic(join(dir, 'design/directions.json'), await proposeDirections(brief, decision));
    },
    scaffold: () => scaffoldSite('acme', opts),
    runAgents: (agents) => runProject('acme', { ...opts, agents, worker: recordingWorker(calls), verifier: passVerifier }),
  };
  return { opts, dir, calls, steps };
}

// A scripted operator: answers come from the lists, in order, and every question is kept.
function operator({ confirm = [], choose = [], typed = [] } = {}) {
  const asked = [];
  return {
    asked,
    confirm: async (q) => (asked.push(q), confirm.shift() ?? false),
    choose: async (q) => (asked.push(q), choose.length ? choose.shift() : null),
    typed: async (q) => (asked.push(q), typed.shift() ?? false),
  };
}

const codes = (opts) => approvals('acme', opts).map((a) => a.approval);
const quiet = () => {};

test('a "no" to the brief stops in intake with nothing approved', async () => {
  const { opts, steps } = setup();
  const ask = operator({ confirm: [false] });
  const r = await goProject('acme', { ask, steps, log: quiet, ...opts });
  assert.equal(r.phase, 'INTAKE');
  assert.match(r.stopped[0], /approval B1/);
  assert.deepEqual(codes(opts), []);
  assert.match(ask.asked[0], /Approve B1, the brief, plan and estimate/);
});

test('after B1 with B2 and B3 given up front it runs the agents and the phases without asking again', async () => {
  const { opts, dir, calls, steps } = setup();
  const ask = operator({ confirm: [true, true] });
  const r = await goProject('acme', { ask, steps, log: quiet, ...opts });
  // The asset register is the agent's to write; the recording worker writes nothing, so it stops there.
  assert.equal(r.phase, 'ASSETS_LICENSING');
  assert.ok(r.stopped.some((s) => s.includes('assets/register.json')), r.stopped.join('; '));
  assert.equal(ask.asked.length, 2, 'only B1 and the up-front question');
  assert.deepEqual(codes(opts), ['B1', 'B2', 'B3']);
  const notes = approvals('acme', opts).map((a) => a.note);
  assert.match(notes[1], /up front/);
  assert.match(notes[2], /up front/);
  const directions = readJson(join(dir, 'design/directions.json'));
  assert.equal(directions.chosen, directions.directions[0].id, 'the recommended (first) direction');
  assert.deepEqual([...new Set(calls.map((c) => c.task))], ['research', 'content', 'asset-register']);
});

test('without the up-front approvals it asks for the direction, and stopping there records no B2', async () => {
  const { opts, steps } = setup();
  const ask = operator({ confirm: [true, false], choose: [null] });
  const r = await goProject('acme', { ask, steps, log: quiet, ...opts });
  assert.equal(r.phase, 'CREATIVE_DIRECTIONS');
  assert.deepEqual(codes(opts), ['B1']);
  assert.match(ask.asked.at(-1), /Which design direction \(B2\)/);
});

test('production needs B7 typed out, is never given up front, and then hands off', async () => {
  const { opts, steps } = setup();
  // Walk the project to PRODUCTION_DEPLOY directly.
  for (const p of PHASES.slice(0, PHASES.findIndex((x) => x.name === 'PRODUCTION_DEPLOY'))) {
    if (p.exitApproval) approve('acme', p.exitApproval, opts);
    const to = { QUALITY_REVIEW: 'PREVIEW_REPORT' }[p.name] ?? PHASES[PHASES.indexOf(p) + 1].name;
    if (p.name === 'REPAIR') continue;
    advancePhase('acme', to, opts);
  }
  assert.equal(loadProject('acme', opts).phase, 'PRODUCTION_DEPLOY');

  let deployed = 0;
  let reported = 0;
  const live = {
    ...steps,
    deployProduction: async () => {
      deployed++;
      ledger.append('acme', { actor: 'cli', type: 'note', data: { event: 'deployment', target: 'production', url: 'https://acme.example', smoke: 'pass' } }, opts);
      return { url: 'https://acme.example' };
    },
    report: () => reported++,
  };
  const no = await goProject('acme', { ask: operator({ confirm: [true, true, true], typed: [false] }), steps: live, log: quiet, ...opts });
  assert.equal(no.phase, 'PRODUCTION_DEPLOY');
  assert.equal(deployed, 0);
  assert.ok(!codes(opts).includes('B7'));

  const ask = operator({ typed: [true] });
  const yes = await goProject('acme', { ask, steps: live, log: quiet, ...opts });
  assert.equal(yes.done, true);
  assert.equal(yes.phase, 'HANDOFF');
  assert.equal(deployed, 1);
  assert.equal(reported, 1);
  assert.match(ask.asked[0], /Approve B7, deploying to production/);
});

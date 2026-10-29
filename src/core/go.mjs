import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceProject, exitBlockers } from './advance.mjs';
import { agentsForPhase } from './agents.mjs';
import { listTasks } from './board.mjs';
import { planPhase } from './planner.mjs';
import { PHASES, approve, hasApproval, loadProject } from './project.mjs';
import { assertProjectExists } from './workspace.mjs';

// forge go: one command from intake to handoff. In each phase it does the phase's own work (a
// forge command, or the agents' tasks through the runner), asks the operator for the phase's
// approval when that is all that is left, and moves on. It stops at the first blocker it cannot
// clear and at every "no". It never records an approval the operator has not given here:
//   - B1 is always asked. With it the operator may also give B2 (the recommended direction) and
//     B3 (the content) up front, so the build carries on without stopping for them.
//   - B5 and B6 are asked when the preview is reached; B7 needs the word "deploy" typed, and is
//     never given up front.

// What each approval covers, shown before it is asked.
export const APPROVAL_TEXT = {
  B1: 'the brief, plan and estimate in intake/plan.md',
  B2: 'the design direction',
  B3: 'the written content in content/pages/',
  B5: 'using Vercel for this project (the integration and its token)',
  B6: 'the preview deploy',
  B7: 'deploying to production',
};
export const UP_FRONT = ['B2', 'B3'];

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

// goProject(project, { ask, steps, log?, ...opts }) => { phase, stopped?: string[], done?: true }
// ask: { confirm(question, code) => bool, choose(question, labels, defaultIndex, code) => index | null,
//        typed(question, word, code) => bool, note?(code) => string }. code names the approval
// asked for ('up-front' for the offer at B1), so a non-interactive ask can answer from flags.
// steps: the phase work, so the CLI runs the real commands and tests run stand-ins:
//   intake(), directions(), scaffold(), runAgents(agents) => { blocked, errors }, build(), gates(),
//   review() => { met }, deployPreview() => { url }, deployProduction() => { url }, report()
export async function goProject(project, { ask, steps, log = console.log, ...opts }) {
  const { dir } = assertProjectExists(project, opts);
  const upFront = new Set();
  const note = (code) => (upFront.has(code) ? 'given up front with B1 in forge go' : (ask.note?.(code) ?? 'given in forge go'));
  const give = (code) => approve(project, code, { note: note(code), ...opts });
  const stop = (phase, reasons) => {
    log(`\nStopped in ${phase}. Next it needs:\n${reasons.map((r) => `  - ${r}`).join('\n')}`);
    return { phase, stopped: reasons };
  };

  // Asks for an approval, or uses one the operator gave up front. Returns whether it is recorded.
  const approval = async (code, detail = '') => {
    if (hasApproval(project, code, opts)) return true;
    if (upFront.has(code)) {
      give(code);
      log(`${code}: approved up front (${APPROVAL_TEXT[code]}).`);
      return true;
    }
    const question = `Approve ${code}, ${APPROVAL_TEXT[code]}?${detail ? ` ${detail}` : ''}`;
    const yes = code === 'B7' ? await ask.typed(question, 'deploy', code) : await ask.confirm(question, code);
    if (!yes) return false;
    give(code);
    if (code === 'B1' && (await ask.confirm(`Also approve ${UP_FRONT.join(' and ')} now (the recommended design direction and the written content), so the build does not stop for them?`, 'up-front'))) {
      for (const c of UP_FRONT) upFront.add(c);
    }
    return true;
  };

  for (;;) {
    const phase = loadProject(project, opts).phase;
    if (phase === 'HANDOFF') {
      await steps.report?.();
      log(`\n${project} is handed off.`);
      return { phase, done: true };
    }

    // 1. The phase's own work, when it is not done yet.
    switch (phase) {
      case 'CREATED':
      case 'INTAKE':
        if (readJson(join(dir, 'intake', 'brief.json'))?.status !== 'ready') await steps.intake();
        if (readJson(join(dir, 'intake', 'brief.json'))?.status !== 'ready') return stop(loadProject(project, opts).phase, ['answers to the intake questions']);
        log(`\nThe brief is ready. Review it in workspace/${project}/intake/plan.md.`);
        break;
      case 'APPROACH_SELECTION':
        if (!existsSync(join(dir, 'design', 'directions.json'))) await steps.directions();
        break;
      case 'CREATIVE_DIRECTIONS': {
        const file = join(dir, 'design', 'directions.json');
        const record = readJson(file);
        if (record && record.status !== 'chosen') {
          let i = 0;
          if (!upFront.has('B2')) {
            i = await ask.choose(`Which design direction (B2)? Specimens are in workspace/${project}/design/.`, record.directions.map((d) => `${d.id}: ${d.name}`), 0, 'B2');
            if (i === null || i === undefined) return stop(phase, ['a chosen design direction (B2)']);
          }
          const entry = give('B2');
          Object.assign(record, { status: 'chosen', chosen: record.directions[i].id, approval: { code: 'B2', ledgerSeq: entry.seq } });
          writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
          log(`B2: chose ${record.chosen}${upFront.has('B2') ? ' (the recommended direction, approved up front)' : ''}.`);
        }
        break;
      }
      case 'UX_DESIGN_SYSTEM':
      case 'CONTENT':
        // The draft site, in the chosen direction's tokens: Content & UX starts from its pages.
        if (!existsSync(join(dir, 'site'))) await steps.scaffold();
        break;
      case 'BUILD':
        if (!existsSync(join(dir, 'site', 'dist', 'index.html'))) await steps.build();
        break;
      case 'INTEGRATION_TESTS':
        await steps.gates();
        break;
      case 'QUALITY_REVIEW':
      case 'REPAIR': {
        const r = await steps.review();
        if (!r.met) return stop(loadProject(project, opts).phase, ['the quality floor: the repair loop escalated (see reports/escalation.md)']);
        break;
      }
      case 'PREVIEW_REPORT':
        if (!exitBlockers(project, opts).some((b) => b.startsWith('a preview deploy'))) break;
        if (!(await approval('B5'))) return stop(phase, ['B5 before a Vercel preview']);
        log(`Preview: ${(await steps.deployPreview()).url}`);
        break;
      case 'PRODUCTION_DEPLOY':
        if (!exitBlockers(project, opts).some((b) => b.startsWith('a production deploy'))) break;
        if (!(await approval('B7'))) return stop(phase, ['B7, typed as "deploy", before production']);
        log(`Production: ${(await steps.deployProduction()).url}`);
        break;
    }

    // The work can move the phase itself (intake leaves CREATED, the repair loop moves between
    // review and repair): carry on from where the project is now.
    if (loadProject(project, opts).phase !== phase) continue;

    // 2. The agents' tasks for this phase (research, content, the asset register).
    planPhase(project, opts);
    const agents = agentsForPhase(phase);
    if (listTasks(project, opts).some((t) => agents.includes(t.agent) && t.status !== 'done')) {
      log(`\nClaude is working on ${phase.toLowerCase().replace(/_/g, ' ')}...`);
      const s = await steps.runAgents(agents);
      const problems = [...s.blocked.map((b) => `task ${b.task}: ${b.reason}`), ...s.errors.map((e) => `task ${e.task}: ${e.code} ${e.message}`)];
      if (problems.length) return stop(phase, problems);
    }

    // 3. The exit approval, when it is the only thing left; then the next phase.
    let blockers = exitBlockers(project, opts);
    const code = PHASES.find((p) => p.name === phase).exitApproval;
    if (code && blockers.length === 1 && blockers[0].startsWith(`approval ${code}`)) {
      if (!(await approval(code))) return stop(phase, [`approval ${code} (${APPROVAL_TEXT[code]})`]);
      blockers = exitBlockers(project, opts);
    }
    if (blockers.length) return stop(phase, blockers);
    const { to } = advanceProject(project, { actor: 'cli', ...opts });
    log(`${phase} -> ${to}`);
  }
}

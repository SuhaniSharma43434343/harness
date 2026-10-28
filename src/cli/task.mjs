import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { abandonTask, checkChanges, nextTask, submitTask } from '../core/step.mjs';

const USAGE = 'Usage: forge task <next|check|submit|abandon> <project> [task] [--evidence a,b] [--json]';

function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

function printContract(task) {
  const list = (xs) => (xs.length ? xs.map((x) => `    - ${x}`).join('\n') : '    (none)');
  console.log(`Task ${task.id} (${task.agent}), attempt ${task.attempts}`);
  console.log(`  You may change only:\n${list(task.owns_files)}`);
  console.log(`  Never change:\n${list(task.must_not_touch)}`);
  console.log(`  Read first:\n${list(task.inputs)}`);
  console.log(`  Acceptance criteria:\n${list(task.acceptance)}`);
  console.log(`  Verify command: ${task.verify}`);
}

// forge task: step mode for editors without Claude Code (see docs/cursor.md).
export async function cmdTask(root, args) {
  const [sub, project, id] = args;
  const json = args.includes('--json');
  if (!sub || !project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const opts = { workspace: workspaceFor(root) };

  if (sub === 'next') {
    const task = nextTask(project, opts);
    if (json) console.log(JSON.stringify(task, null, 2));
    else if (!task) console.log(`No task can start in ${project} right now. Run forge status ${project} to see why.`);
    else {
      printContract(task);
      console.log(`\nWhen it is done, run: forge task submit ${project} ${task.id}`);
    }
    return 0;
  }

  if (!id || id.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }

  if (sub === 'check') {
    const { changed, refused } = checkChanges(project, id, opts);
    if (json) console.log(JSON.stringify({ changed, refused }, null, 2));
    else {
      console.log(changed.length ? `Changed: ${changed.join(', ')}` : 'No changes yet.');
      if (refused.length) console.log(`Outside the contract (will be refused): ${refused.join(', ')}`);
    }
    return refused.length ? 1 : 0;
  }

  if (sub === 'submit') {
    const evidence = (flag(args, '--evidence') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const result = await submitTask(project, id, { ...opts, evidence });
    if (json) console.log(JSON.stringify(result, null, 2));
    else if (result.status === 'refused') {
      console.log(`Refused: these changes are outside task ${id}'s contract:`);
      for (const f of result.refused) console.log(`  ${f}`);
      console.log('Undo them, then submit again. The task is still open.');
    } else if (result.status === 'done') console.log(`Task ${id} is done. Evidence: ${result.evidence.join(', ')}`);
    else if (result.status === 'retry') console.log(`The verify command failed, so task ${id} goes back for another attempt. Run forge task next ${project}.`);
    else console.log(`Task ${id} is blocked: ${result.reason}`);
    return result.status === 'done' ? 0 : 1;
  }

  if (sub === 'abandon') {
    const task = abandonTask(project, id, opts);
    console.log(task.status === 'retry' ? `Task ${id} is back in the queue.` : `Task ${id} is blocked: ${task.blocked_reason}`);
    return 0;
  }

  console.error(USAGE);
  return 2;
}

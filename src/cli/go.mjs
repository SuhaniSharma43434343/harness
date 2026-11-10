import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../core/config.mjs';
import { approve, createProject, loadProject, PHASES } from '../core/project.mjs';
import { readJson } from '../core/workspace.mjs';
import { chooseDirection, readDirections } from '../design/choose.mjs';
import { runDesignWorkflow } from '../design/manager.mjs';
import { ESSENTIAL_FIELDS, extractFromPrompt, expressAsk } from '../intake/express.mjs';
import { runIntake } from '../intake/run.mjs';
import { parseTyped } from '../intake/typed.mjs';
import { loadRegistry } from '../registry/load.mjs';
import { existsSync as exists } from 'node:fs';
import { readDecision, runMediaStep } from '../media/step.mjs';
import { runRepairLoop } from '../qa/repair.mjs';
import { openDefects } from '../qa/defects.mjs';
import { createClaudeCodeWorker } from '../workers/claude-code.mjs';
import { DESIGN_QA_GATES } from './design.mjs';

const USAGE = 'Usage: forge go <project> "<what the website is for>" [--answers <file.json>] [--approve B1,B3] [--direction <id>] [--deep] [--max-usd <n>] [--model <m>]';

// What the operator is agreeing to, in plain words, shown before each approval.
export const APPROVAL_COVERS = {
  B1: 'the brief, the plan and the estimate: what the site is for, which pages it has, and what it costs. Your assumptions are listed in intake/plan.md.',
  B3: 'the written content: every page\'s words, and the facts and sources behind each claim. After this the words are locked and the site is built from them.',
  B4: 'the Spline plugin using the credentials in .env.',
  B5: 'a preview deploy to Vercel.',
};

// Sorts what stops a phase into the things only the operator can settle and everything else.
export function classifyBlockers(blockers) {
  const decisions = [];
  const other = [];
  for (const b of blockers) {
    const approval = b.match(/^approval (B\d)\b/);
    if (approval?.[1] === 'B2' || /^a chosen direction/.test(b)) {
      if (!decisions.some((d) => d.kind === 'direction')) decisions.push({ kind: 'direction' });
    }
    else if (approval) decisions.push({ kind: 'approval', code: approval[1] });
    else if (b.startsWith('licence not cleared')) decisions.push({ kind: 'licence', detail: b });
    else other.push(b);
  }
  return { decisions, other };
}

const briefReady = (dir) => {
  const file = join(dir, 'intake', 'brief.json');
  return existsSync(file) && readJson(file).status === 'ready';
};

// The short list of what the site is built to do, for the operator to check before B1.
export function summarise(brief, estimate) {
  const lines = [];
  lines.push(`${brief.client?.name ?? brief.project}: ${brief.client?.industry ?? ''}`.trim());
  if (brief.business?.primaryConversion) lines.push(`Built to make visitors: ${brief.business.primaryConversion.label}`);
  const second = (brief.business?.secondaryConversions ?? []).map((c) => c.label);
  if (second.length) lines.push(`Also offered: ${second.join(', ')}`);
  lines.push(`${brief.pages?.length ?? 0} pages: ${(brief.pages ?? []).map((p) => p.title).join(', ')}`);
  if (estimate) lines.push(`Estimate: ${estimate.hours.min} to ${estimate.hours.max} hours`);
  lines.push(`${brief.assumptions?.length ?? 0} assumption(s) were made for you (intake/plan.md lists them)`);
  return lines;
}

// runGo(project, opts) => { status, ... }
// One prompt in, a built site out. It runs intake from the words, then the design workflow, and only
// stops for what belongs to the operator: an approval, the choice of design direction, a licence. Each
// of those is settled by opts.approve / opts.direction (typed by the operator), or by opts.decide, or
// else the run stops and says exactly what is needed. It records no approval on its own.
//   status 'ready'    the site is built and visual QA ran (see qa)
//   status 'waiting'  an operator decision is needed: { needs }
//   status 'stopped'  the workflow could not go on: { reason, detail }
//   status 'needs-answers'  intake could not finish: { missing }
export async function runGo(project, opts = {}) {
  const {
    workspace, prompt, answers = {}, approve: approveCodes = [], direction, deep = false, decide, askOperator,
    worker, maxUsd = Infinity, media = {}, fetch: fetchImpl, say = () => {}, designRun = runDesignWorkflow, repair = runRepairLoop, registry = loadRegistry(),
  } = opts;
  const ctx = { workspace };
  let state;
  try {
    state = loadProject(project, ctx);
  } catch {
    state = createProject(project, ctx);
    say(`Created ${project}.`);
  }
  const dir = join(workspace, project);

  if (['CREATED', 'INTAKE'].includes(state.phase) && (prompt || !briefReady(dir))) {
    if (!prompt && !Object.keys(answers).length) {
      return { status: 'needs-answers', missing: ['the prompt'], message: `Tell me what the website is for: forge go ${project} "<one sentence>"` };
    }
    const extracted = extractFromPrompt(prompt, registry.industries);
    for (const f of extracted.found) say(`Understood - ${f}`);
    for (const a of extracted.assumed) say(`Assumed - ${a}`);
    if (prompt) {
      mkdirSync(join(dir, 'intake', 'material'), { recursive: true });
      writeFileSync(join(dir, 'intake', 'material', 'prompt.txt'), `${prompt}\n`);
    }
    const r = await runIntake(project, { ...ctx, registry, ask: expressAsk({ ...extracted.answers, ...answers }, { askOperator, deep }) });
    if (r.status !== 'ready') {
      return { status: 'needs-answers', missing: r.missing, errors: r.errors, message: `Intake needs: ${r.missing.join(', ')}. Add them to the sentence, or pass --answers.` };
    }
    say('\nThe plan:');
    for (const l of summarise(r.brief, r.estimate)) say(`  ${l}`);
  }

  const settle = async (need) => {
    if (need.kind === 'direction') {
      const { directions } = readDirections(project, ctx);
      const pick = direction ?? (await decide?.({ kind: 'direction', directions }));
      if (!pick) return { kind: 'direction', directions: directions.map((d) => ({ id: d.id, name: d.name, rationale: d.rationale })) };
      chooseDirection(project, pick, { ...ctx, note: `Chose ${pick} (forge go)` });
      say(`B2 recorded: ${pick}`);
      return null;
    }
    if (need.kind === 'approval') {
      const yes = approveCodes.includes(need.code) || (await decide?.({ kind: 'approval', code: need.code, covers: APPROVAL_COVERS[need.code] ?? 'the work of this phase' })) === true;
      if (!yes) return { kind: 'approval', code: need.code, covers: APPROVAL_COVERS[need.code] ?? 'the work of this phase' };
      approve(project, need.code, { ...ctx, note: 'Approved by the operator (forge go)' });
      say(`${need.code} recorded.`);
      return null;
    }
    return { kind: 'licence', detail: need.detail, hint: `forge design accept-licence ${project} <package> --note "<your decision>"` };
  };

  // The media step (3D and video) happens once research has run and before the approach is chosen, so
  // the plan is made around what the operator decided. It runs in this window only.
  const idx = (name) => PHASES.findIndex((p) => p.name === name);
  const mediaPending = () => !media.skip && !readDecision(dir) && idx(loadProject(project, ctx).phase) <= idx('APPROACH_SELECTION');

  let spent = 0;
  for (let step = 0; step < 30; step++) {
    // The phase after B1 needs the approval before the workflow can leave INTAKE.
    const awaitingMedia = mediaPending();
    const r = await designRun(project, { ...ctx, worker, maxUsd: maxUsd - spent, ...(awaitingMedia ? { stopBefore: 'APPROACH_SELECTION' } : {}), onStep: (s) => say(`${s.phase}: ${s.done?.length ?? 0} task(s) done`) });
    spent += r.spentUsd ?? 0;
    if (r.reason === 'reached' && awaitingMedia) {
      const brief = readJson(join(dir, 'intake', 'brief.json'));
      const playbook = registry.industries.find((p) => p.id === brief.business?.industryId);
      const m = await runMediaStep(project, { workspace, brief, playbook, flags: media, decide, say, fetch: fetchImpl });
      if (m.status === 'waiting') return { status: 'waiting', needs: m.needs, stoppedAt: r.stoppedAt, spentUsd: spent };
      continue;
    }
    if (r.reason === 'reached') break;
    if (r.reason !== 'needs') return { status: 'stopped', reason: r.reason, detail: r.problems ?? r.blockers ?? r.errors ?? r.blocked ?? [], stoppedAt: r.stoppedAt, spentUsd: spent };
    const { decisions, other } = classifyBlockers(r.blockers ?? []);
    if (other.length || !decisions.length) return { status: 'stopped', reason: 'blocked', detail: r.blockers, stoppedAt: r.stoppedAt, spentUsd: spent };
    for (const need of decisions) {
      const waiting = await settle(need);
      if (waiting) return { status: 'waiting', needs: waiting, stoppedAt: r.stoppedAt, spentUsd: spent };
    }
  }

  say('Reviewing the built site...');
  const qa = await repair(project, { ...ctx, worker, gates: DESIGN_QA_GATES });
  return { status: 'ready', qa: { outcome: qa.outcome, loops: qa.loops, open: openDefects(qa.report).length }, spentUsd: spent };
}

// The terminal wrapper: reads the prompt, asks the few things only the operator can answer, and
// asks yes or no at each approval.
function workspaceFor(root) {
  const dir = loadConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

export async function cmdGo(root, args) {
  const [project, prompt] = args;
  if (!project || project.startsWith('-')) {
    console.error(USAGE);
    return 2;
  }
  const text = prompt && !prompt.startsWith('--') ? prompt : undefined;
  const workspace = workspaceFor(root);
  const answersFile = flag(args, '--answers');
  const interactive = process.stdin.isTTY && !args.includes('--no-input');
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;

  const askOperator = rl
    ? async (questions) => {
        const out = [];
        for (const q of questions) {
          const essential = q.fills.some((f) => ESSENTIAL_FIELDS.includes(f));
          console.log(`\n${q.prompt}${q.why ? `\n  Why: ${q.why}` : ''}`);
          q.options?.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}`));
          console.log(essential ? '  (an answer is needed)' : '  (press Enter to skip; a sensible default is used and shown at B1)');
          for (;;) {
            const typed = (await rl.question('> ')).trim();
            if (!typed) {
              if (essential) continue;
              out.push(undefined);
              break;
            }
            const r = parseTyped(q, typed);
            if (r.error) console.log(`  ${r.error}`);
            else {
              out.push(r.answer);
              break;
            }
          }
        }
        return out;
      }
    : undefined;

  const decide = rl
    ? async (need) => {
        if (need.kind.startsWith('media-')) return askMedia(rl, need);
        if (need.kind === 'approval') {
          console.log(`\n${need.code} covers: ${need.covers}`);
          return /^y(es)?$/i.test((await rl.question(`Approve ${need.code}? (yes/no) > `)).trim());
        }
        console.log('\nPick a design direction:');
        need.directions.forEach((d) => console.log(`  ${d.id}: ${d.name} - ${d.rationale}`));
        const id = (await rl.question('Direction id > ')).trim();
        return need.directions.some((d) => d.id === id) ? id : undefined;
      }
    : undefined;

  try {
    const r = await runGo(project, {
      workspace,
      prompt: text,
      answers: answersFile ? readJson(resolve(answersFile)) : {},
      approve: (flag(args, '--approve') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      direction: flag(args, '--direction'),
      deep: args.includes('--deep'),
      maxUsd: Number(flag(args, '--max-usd') ?? 25),
      media: {
        off: args.includes('--no-media'),
        skip: args.includes('--no-media'),
        threeD: flag(args, '--3d'),
        model: flag(args, '--pick'),
        concept: flag(args, '--concept'),
        video: flag(args, '--video'),
        videoRole: flag(args, '--video-role'),
        videoSound: args.includes('--video-sound'),
        clip: flag(args, '--clip'),
      },
      worker: createClaudeCodeWorker({ model: flag(args, '--model') }),
      say: (s) => console.log(s),
      decide,
      askOperator,
    });
    return report(project, r);
  } finally {
    rl?.close();
  }
}

function report(project, r) {
  const rerun = `forge go ${project}`;
  if (r.status === 'needs-answers') {
    console.log(`\n${r.message}`);
    return 1;
  }
  if (r.status === 'waiting') {
    const n = r.needs;
    console.log(`\nWaiting for you at ${r.stoppedAt}.`);
    if (n.kind === 'approval') console.log(`${n.code} covers: ${n.covers}\nApprove with: ${rerun} --approve ${n.code}   (or forge approve ${project} ${n.code})`);
    else if (n.kind === 'media-pick') {
      console.log(`Pick a ${n.what}:`);
      n.candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.id}: ${c.title} by ${c.creator} (${c.licence}) ${c.url}`));
      console.log(`Choose with: ${rerun} --pick <id>   (or skip with --3d no)`);
    } else if (n.kind === 'direction') {
      console.log('Pick a design direction:');
      for (const d of n.directions) console.log(`  ${d.id}: ${d.name} - ${d.rationale}`);
      console.log(`Choose with: ${rerun} --direction <id>`);
    } else console.log(`${n.detail}\n${n.hint}`);
    console.log(`Spent so far: $${r.spentUsd.toFixed(2)}.`);
    return 0;
  }
  if (r.status === 'stopped') {
    console.log(`\nStopped in ${r.stoppedAt}: ${r.reason}.`);
    for (const d of [].concat(r.detail ?? [])) console.log(`  - ${typeof d === 'string' ? d : JSON.stringify(d)}`);
    console.log(`Spent so far: $${r.spentUsd.toFixed(2)}. After fixing, run ${rerun} again to continue.`);
    return 1;
  }
  console.log(`\nSite built. Visual QA ${r.qa.outcome} after ${r.qa.loops} repair loop(s); open defects: ${r.qa.open}. Spent $${r.spentUsd.toFixed(2)}.`);
  console.log(`See it: forge preview ${project}`);
  return r.qa.outcome === 'passed' ? 0 : 1;
}

// The operator's side of the media step, at a terminal. The wording matches the flow they asked for:
// say honestly whether it suits, let them overrule, then own file or free ones from the web, 3 to pick.
async function askMedia(rl, need) {
  const ask = async (q) => (await rl.question(q)).trim();
  const pickNumber = async (q, max) => {
    for (;;) {
      const n = Number(await ask(q));
      if (Number.isInteger(n) && n >= 0 && n <= max) return n;
      console.log(`  Type a number from 0 to ${max}.`);
    }
  };
  const askFile = async (what, ext) => {
    for (;;) {
      const f = await ask(`Path to your ${what} (or Enter to cancel) > `);
      if (!f) return undefined;
      const full = resolve(f.replace(/^["']|["']$/g, ''));
      if (!exists(full)) console.log('  There is no file there.');
      else if (ext && !ext.test(full)) console.log('  That is not the right kind of file.');
      else return full;
    }
  };

  if (need.kind === 'media-3d') {
    const f = need.fit;
    if (f.class !== 'not-recommended') {
      console.log(`\nA 3D object suits this site (${f.class}): ${f.concept}.`);
      console.log('  1. Yes, find free 3D models and show me three to choose from');
      console.log('  2. No, continue without 3D');
      console.log('  3. I have my own model (.glb)');
      const n = await pickNumber('> ', 3);
      if (n === 1) return { action: 'search' };
      if (n === 3) {
        const file = await askFile('model', /\.glb$/i);
        return file ? { action: 'own', file } : { action: 'skip', reason: 'No model file was given.' };
      }
      return { action: 'skip', reason: 'The operator chose to continue without 3D.' };
    }
    console.log('\n3D is not recommended for this site by our analysis.');
    console.log('  1. Continue without 3D (our analysis)');
    console.log('  2. Include a 3D model anyway');
    if ((await pickNumber('> ', 2)) !== 2) return { action: 'skip', reason: 'The operator accepted our analysis: continue without 3D.' };
    console.log('\nDo you have a model?');
    console.log('  1. Yes, I have my own model (.glb)');
    console.log('  2. No, use a free model from the web (I will show you three)');
    if ((await pickNumber('> ', 2)) === 1) {
      const file = await askFile('model', /\.glb$/i);
      return file ? { action: 'own', file } : { action: 'skip', reason: 'No model file was given.' };
    }
    return { action: 'search' };
  }

  if (need.kind === 'media-pick') {
    console.log(`\nThree free ${need.what}s that fit (all free for commercial use):`);
    need.candidates.forEach((c, i) => {
      const bits = [c.creator && `by ${c.creator}`, c.licence, c.polycount && `${c.polycount.toLocaleString()} triangles`, c.bytes && `${(c.bytes / 1048576).toFixed(1)} MB`, c.durationS && `${c.durationS}s`].filter(Boolean);
      console.log(`  ${i + 1}. ${c.title} (${bits.join(', ')})\n     ${c.url}\n     preview: ${c.previewImage}`);
    });
    console.log('  0. None of these, skip');
    const n = await pickNumber('> ', need.candidates.length);
    return n ? need.candidates[n - 1].id : null;
  }

  if (need.kind === 'media-video') {
    console.log(need.need === 'none' ? '\nVideo is not needed for this site by our analysis.' : `\nA short ${need.need} would help this site.`);
    console.log('  1. I have my own video clip');
    console.log('  2. Find a free clip (needs a free Pexels key in .env)');
    console.log('  3. No video');
    const n = await pickNumber('> ', 3);
    if (n === 1) {
      const file = await askFile('video', /\.(mp4|mov|webm|m4v)$/i);
      return file ? { action: 'own', file } : { action: 'skip' };
    }
    if (n === 2) return { action: 'find', query: await ask('What should the clip show? (Enter for a sensible default) > ') };
    return { action: 'skip' };
  }

  if (need.kind === 'media-place') {
    const p = need.placement;
    console.log(`\nYour clip is ${need.info.durationS}s, ${need.info.width}x${need.info.height}${need.info.hasAudio ? ', with sound' : ''}.`);
    console.log(`Where I would use it: ${p.role} on ${p.page}: ${p.section}.`);
    for (const r of p.reasons) console.log(`  why: ${r}`);
    for (const w of p.warnings) console.log(`  note: ${w}`);
    for (const a of p.alternatives) console.log(`  other option: ${a.role} (${a.why})`);
    console.log('  Enter = use it there   1 = hero loop   2 = story clip   3 = do not use it');
    const t = await ask('> ');
    return t === '1' ? 'hero-loop' : t === '2' ? 'story-clip' : t === '3' ? 'skip' : 'ok';
  }
  return undefined;
}

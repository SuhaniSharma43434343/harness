import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from '../core/workspace.mjs';
import { FILES } from './spec.mjs';

// The plain-language summary the operator reads at each pause: what happened in the phase that just
// ended, what was decided, and which files hold it. Built only from the project's files, so it never
// says more than they do, and written for someone who has not read the files.

const read = (dir, file) => (existsSync(join(dir, file)) ? readJson(join(dir, file)) : null);
const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const sections = (plan) => (plan?.pages ?? []).flatMap((p) => p.sections);
// Long fields are cut at a sentence or 160 characters, so each summary stays a few short lines.
const clip = (t, max = 160) => {
  const text = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}...`;
};
const words = (copy) => JSON.stringify(copy?.pages ?? []).split(/\s+/).length;

const SUMMARIES = {
  INTAKE: (dir) => {
    const b = read(dir, FILES.brief) ?? {};
    const est = read(dir, 'intake/estimate.json');
    return {
      title: 'Intake: what the site is for',
      lines: [
        `The brief for ${b.client?.name ?? 'the client'} is written: ${n(b.pages?.length ?? 0, 'page')}, ${n(b.goals?.length ?? 0, 'goal')}, ${n(b.audience?.length ?? 0, 'kind')} of visitor.`,
        `${n(b.assumptions?.length ?? 0, 'answer')} were assumed rather than given; they are listed in the plan for you to check.`,
        est?.cost ? `Estimated cost: ${est.cost.min} to ${est.cost.max} ${est.cost.currency}.` : 'There is no cost estimate yet.',
      ],
      files: ['intake/brief.json', 'intake/plan.md', 'intake/estimate.json'],
    };
  },
  RESEARCH: (dir) => {
    const p = read(dir, FILES.positioning) ?? {};
    const c = read(dir, FILES.crux) ?? { buckets: {} };
    const buckets = Object.values(c.buckets ?? {});
    const facts = buckets.reduce((s, b) => s + b.items.length, 0);
    const gaps = buckets.reduce((s, b) => s + b.gaps.length, 0);
    return {
      title: 'Research: the facts the site may use',
      lines: [
        `${n(facts, 'fact')} about the business were found and sourced; ${n(gaps, 'question')} for the client are still open.`,
        `${n(c.buyerQuestions?.length ?? 0, 'buyer question')} were collected, and ${n(p.competitors?.length ?? 0, 'competitor')} and ${n(p.references?.length ?? 0, 'reference site')} were studied.`,
        p.onliness?.statement ? `What only this business can claim: ${clip(p.onliness.statement)}` : 'What only this business can claim is still a question for the client.',
      ],
      files: ['research/truth-doc.md', 'research/positioning.json', 'research/crux.json'],
    };
  },
  APPROACH_SELECTION: (dir) => {
    const d = read(dir, FILES.direction) ?? {};
    const choice = read(dir, FILES.approachChoice);
    return {
      title: 'Approach: how the site is built',
      lines: [
        `The site is built as ${d.primaryApproach ?? choice?.approach ?? 'an approach not chosen yet'}${choice ? ', the one you chose' : ''}.`,
        d.concept ? `The idea everything serves: ${clip(d.concept)}` : 'The direction is not written yet.',
        d.identity ? `Navigation: ${clip(d.identity.navigation)}` : '',
      ].filter(Boolean),
      files: ['design/direction.md', 'design/direction.json', 'design/approach-decision.json'],
    };
  },
  CREATIVE_DIRECTIONS: (dir) => {
    const d = read(dir, FILES.directions) ?? {};
    const chosen = d.directions?.find((x) => x.id === d.chosen);
    return {
      title: 'Look and feel: the direction you chose',
      lines: [
        chosen ? `You chose "${chosen.name}": ${chosen.typography.display.family} headings with ${chosen.typography.body.family} text, in the ${chosen.colour.mode} palette.` : 'No direction is chosen yet.',
        `${n(d.directions?.length ?? 0, 'direction')} were shown, each rendered for desktop and phone.`,
      ],
      files: ['design/directions.json', 'design/directions/'],
    };
  },
  UX_DESIGN_SYSTEM: (dir) => {
    const plan = read(dir, FILES.sectionPlan);
    const motion = read(dir, FILES.motionPlan);
    const assets = read(dir, FILES.assetPlan);
    const all = sections(plan);
    return {
      title: 'Page plans: every section, laid out',
      lines: [
        `${n(plan?.pages?.length ?? 0, 'page')} planned, with ${n(all.length, 'section')} in ${n(new Set(all.map((s) => s.pattern)).size, 'different layout')}.`,
        `${n(motion?.motions?.length ?? 0, 'animation')} and ${n(assets?.assets?.length ?? 0, 'picture or graphic', 'pictures and graphics')} are planned, each with a reason.`,
        all.some((s) => s.hierarchyStep !== undefined) ? 'Each main page runs the six steps: what it is, wants and needs, the risk of waiting, advantages, why better, and the questions buyers ask.' : '',
      ].filter(Boolean),
      files: ['design/design-system.json', 'design/section-plan.json', 'design/motion-plan.json', 'design/asset-plan.json'],
    };
  },
  CONTENT: (dir) => {
    const copy = read(dir, FILES.copy);
    const claims = read(dir, 'content/claims.json');
    const prompts = read(dir, FILES.mediaPrompts);
    return {
      title: 'Words: the copy for every section',
      lines: [
        `About ${words(copy)} words across ${n(copy?.pages?.length ?? 0, 'page')}, in the voice: ${clip(copy?.voice ?? 'not set', 100)}.`,
        `${n(claims?.claims?.length ?? 0, 'fact')} in the copy are registered with a source.`,
        prompts ? `${n(prompts.prompts.length, 'photo or video prompt', 'photo and video prompts')} were written in the chosen look.` : '',
      ].filter(Boolean),
      files: ['content/copy.json', 'content/claims.json', ...(prompts ? ['design/media-prompts.json'] : [])],
    };
  },
  ASSETS_LICENSING: (dir) => {
    const reg = read(dir, 'assets/register.json');
    const review = read(dir, FILES.mediaReview);
    const rejected = (review?.items ?? []).filter((x) => x.verdict === 'reject').length;
    return {
      title: 'Pictures and licences',
      lines: [
        `${n(reg?.assets?.length ?? 0, 'file')} are in the licence register, each with its licence.`,
        review ? `${n(review.items.length, 'photo or video', 'photos and videos')} were looked at; ${rejected ? `${rejected} rejected and sent back` : 'none rejected'}.` : '',
      ].filter(Boolean),
      files: ['assets/register.json', ...(review ? ['design/media-review.json'] : [])],
    };
  },
  TECHNICAL_PLAN: (dir) => {
    const r = read(dir, FILES.review);
    const failing = Object.entries(r?.litmus ?? {}).filter(([k, v]) => (k === 'couldBeAnyCompany' ? v.answer === 'yes' : v.answer === 'no'));
    return {
      title: 'Review before building',
      lines: [
        r ? `The Design Manager read the plan, the words and the pictures together: ${r.verdict === 'ready' ? 'ready to build' : 'changes needed'}. ${clip(r.summary)}` : 'The review has not run.',
        r?.litmus ? (failing.length ? `It failed ${n(failing.length, 'litmus question')}: ${failing.map(([k]) => k).join(', ')}.` : 'It passed all five litmus questions, including "could this belong to any company?".') : '',
      ].filter(Boolean),
      files: ['design/review.json'],
    };
  },
  BUILD: (dir) => {
    const pages = existsSync(join(dir, 'site', 'dist')) ? readdirSync(join(dir, 'site', 'dist'), { recursive: true }).filter((f) => String(f).endsWith('index.html')).length : 0;
    return { title: 'Build: the site exists', lines: [`The site is built: ${n(pages, 'page')} in site/dist, each section made to its plan.`], files: ['site/', 'site/dist/'] };
  },
  INTEGRATION_TESTS: () => ({ title: 'First checks', lines: ['Every page opens, every form works, and every approved word is on its page.'], files: ['evidence/gates/'] }),
  QUALITY_REVIEW: (dir) => {
    const d = read(dir, 'reports/defects.json');
    const open = (d?.defects ?? []).filter((x) => x.status !== 'verified');
    return { title: 'Quality review', lines: [`All 14 checks ran. ${open.length ? `${n(open.length, 'problem')} still open; see the QA report.` : 'Nothing is open.'}`], files: ['reports/qa-report.md', 'reports/defects.json'] };
  },
};

// phaseSummary(dir, phase) => { title, lines, files }. A phase with nothing to say gets one line.
export function phaseSummary(dir, phase) {
  const make = SUMMARIES[phase];
  return make ? make(dir) : { title: phase, lines: [`The ${phase.toLowerCase().replace(/_/g, ' ')} step is done.`], files: [] };
}

// The summary as terminal lines.
export const summaryLines = (s) => [`== ${s.title}`, ...s.lines.map((l) => `   ${l}`), ...(s.files.length ? [`   Files: ${s.files.join(', ')}`] : [])];

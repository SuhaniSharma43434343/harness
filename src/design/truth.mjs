import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionDenied } from '../core/errors.mjs';
import * as ledger from '../core/ledger.mjs';
import { assertProjectExists, readJson } from '../core/workspace.mjs';
import { BIG_FIVE, CHECKS, CRUX_BUCKETS, FILES, workflowVersion } from './spec.mjs';

// The Truth Doc (research/truth-doc.md): the research files as one page the operator can check
// before any visual work starts. It is written by the harness, never by an agent, so it says no
// more than the files do. The operator confirms the facts are real with `forge facts confirm`;
// the confirmation names the document's hash, so a later change to the facts needs a new one.

const read = (dir, file) => (existsSync(join(dir, file)) ? readJson(join(dir, file)) : null);
const cite = (source) => (source === 'assumption' ? ' *(assumption: confirm with the client)*' : ` [${source}]`);

function renderTruthDoc(dir) {
  const brief = read(dir, FILES.brief) ?? {};
  const p = read(dir, FILES.positioning) ?? {};
  const crux = read(dir, FILES.crux) ?? { buckets: {} };
  const L = [`# Truth Doc: ${brief.client?.name ?? 'the client'}`, '', 'Written by the harness from research/positioning.json and research/crux.json. Every line names its source; anything not known is a question for the client. Check that every fact is real before visual work starts.', ''];

  L.push('## What only this business can claim', '');
  if (p.onliness?.statement) L.push(`${p.onliness.statement}${cite(p.onliness.source)}`, '');
  if (p.onliness?.gap) L.push(`**Ask the client:** ${p.onliness.gap}`, '');

  L.push('## What it is, and what it is not', '');
  for (const b of p.boundaries?.whatItIs ?? []) L.push(`- **Is:** ${b.text}${cite(b.source)}`);
  for (const b of p.boundaries?.whatItIsNot ?? []) L.push(`- **Is not:** ${b.text}${cite(b.source)}`);
  L.push('');

  L.push('## Who it is for', '');
  for (const x of p.personas ?? []) {
    L.push(`### ${x.segment}${cite(x.source)}`, '', `- Wants: ${x.wants.join('; ')}`, `- Needs: ${x.needs.join('; ')}`, `- The one action: ${x.desiredAction}`, '');
  }

  L.push('## The five content buckets', '');
  for (const [key, label] of Object.entries(CRUX_BUCKETS)) {
    const b = crux.buckets?.[key] ?? { items: [], gaps: [] };
    L.push(`### ${label}`, '');
    for (const it of b.items) L.push(`- ${it.text}${cite(it.source)}`);
    for (const g of b.gaps) L.push(`- **Ask the client:** ${g}`);
    if (!b.items.length && !b.gaps.length) L.push('- Nothing yet.');
    L.push('');
  }

  L.push('## What buyers ask before they buy', '');
  for (const [key, label] of [...Object.entries(BIG_FIVE), ['edge', 'edge cases']]) {
    const qs = (crux.buyerQuestions ?? []).filter((q) => q.category === key);
    if (!qs.length) continue;
    L.push(`### ${label[0].toUpperCase()}${label.slice(1)}`, '');
    for (const q of qs) L.push(`- ${q.question}${q.source ? cite(q.source) : ''}${q.gap ? ` **Ask the client:** ${q.gap}` : ''}`);
    L.push('');
  }

  L.push('## Competitors and references', '');
  for (const c of p.competitors ?? []) L.push(`- **${c.name}**${c.url ? ` (${c.url})` : ''}: ${c.observation}${c.learn ? ` Learn: ${c.learn}` : ''}${c.avoid ? ` Avoid: ${c.avoid}` : ''}`);
  for (const r of p.references ?? []) L.push(`- **${r.name}** (${r.url}): learn ${r.whatToLearn}${r.avoid ? `; avoid ${r.avoid}` : ''}`);
  if (p.researchLimits) L.push('', `Research limits: ${p.researchLimits}`);
  return `${L.join('\n')}\n`;
}

const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// writeTruthDoc(dir) => { file, hash }: renders and writes research/truth-doc.md.
export function writeTruthDoc(dir) {
  const text = renderTruthDoc(dir);
  writeFileSync(join(dir, FILES.truthDoc), text);
  return { file: FILES.truthDoc, hash: hashOf(text) };
}

const confirmations = (project, opts) => ledger.read(project, opts).filter((e) => e.type === 'note' && e.actor === 'operator' && e.data?.event === 'facts_confirmed');

// confirmFacts(project, { note }) => the ledger entry. Only once research passes its checks, and only
// with the operator's note saying what they checked.
export function confirmFacts(project, { note, ...opts } = {}) {
  const { dir } = assertProjectExists(project, opts);
  if (!note) throw new PermissionDenied('Confirming the facts needs your note: what you checked, and against what');
  const problems = CHECKS.research(dir);
  if (problems.length) throw new PermissionDenied(`Research is not finished, so there are no facts to confirm yet (${problems.length} problem(s))`, { hint: problems.slice(0, 5).join('\n') });
  const { hash } = writeTruthDoc(dir);
  return ledger.append(project, { actor: 'operator', type: 'note', data: { event: 'facts_confirmed', truthDoc: FILES.truthDoc, hash, note } }, opts);
}

// What stops research from ending under workflow 2: a confirmation of the Truth Doc as it is now.
export function factsBlockers(project, dir, opts = {}) {
  if (workflowVersion(dir) < 2 || CHECKS.research(dir).length) return [];
  const current = hashOf(renderTruthDoc(dir));
  if (confirmations(project, opts).some((e) => e.data.hash === current)) return [];
  return [`facts confirmation: read ${FILES.truthDoc}, then run forge facts ${project} confirm --note "<what you checked>"`];
}

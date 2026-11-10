import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { registerModel } from '../approaches/app03.mjs';
import * as ledger from '../core/ledger.mjs';
import { writeJsonAtomic } from '../core/workspace.mjs';
import { assessMedia } from './fit.mjs';
import { checkOwnModel, downloadModel, searchModels } from './models.mjs';
import { downloadClip, placeVideo, prepareVideo, probeVideo, registerVideo, searchPexels } from './video.mjs';

// The media step of forge go. After research (the business and its audience are understood) and
// before the approach is chosen, it decides about a 3D object and about video:
//   1. judge honestly whether each suits this business, and say why
//   2. ask the operator; a "no" is final, a "yes" for an unsuitable fit is allowed but flagged
//   3. for 3D: the operator's own model, or three free ones found on the web to pick from
//   4. for video: the operator's clip, analysed for where it belongs, or three free ones
// Nothing is downloaded before a choice, and nothing is added without a yes. The result is written
// to design/media-decision.json and summarised in the brief (brief.media), which every later stage
// reads.

export const DECISION_FILE = 'design/media-decision.json';
export const readDecision = (dir) => (existsSync(join(dir, DECISION_FILE)) ? JSON.parse(readFileSync(join(dir, DECISION_FILE), 'utf8')) : null);

// The asset ids the plan must use for the chosen media.
export const modelAssetId = (m) => `model-${m.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
export const videoAssetId = (v) => `video-${v.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;

const note = (project, ctx, data) => ledger.append(project, { actor: 'project-manager', type: 'note', data }, ctx);

// runMediaStep(project, opts) => { status: 'decided' | 'waiting', decision?, needs? }
// opts: { workspace, brief, playbook, flags, decide, say, fetch, env, tools }
//   flags: { threeD ('yes'|'no'|path), model (candidate id), concept, video (path), videoRole, off }
//   decide(need) => the operator's answer, or undefined when nobody can be asked
export async function runMediaStep(project, opts) {
  const { workspace, brief, playbook, flags = {}, decide, say = () => {}, fetch: fetchImpl, env = process.env } = opts;
  const ctx = { workspace };
  const dir = join(workspace, project);
  const existing = readDecision(dir);
  if (existing && existing.status === 'decided') return { status: 'decided', decision: existing };
  const pub = join(dir, 'assets', 'public');

  const fit = assessMedia(brief, playbook, { concept: flags.concept });
  const decision = { status: 'decided', decidedAt: new Date().toISOString(), fit: { threeD: { fit: fit.threeD.fit, class: fit.threeD.class, reasons: fit.threeD.reasons, concept: fit.threeD.concept }, video: fit.video } };

  if (flags.off) {
    decision.threeD = { decision: 'skipped', reason: 'Media was switched off for this project.' };
    decision.video = { decision: 'skipped', reason: 'Media was switched off for this project.' };
    return finish(project, ctx, dir, decision);
  }

  // ---- 3D ----
  say(`\n3D object: ${fit.threeD.class} (fit ${fit.threeD.fit}).`);
  for (const r of fit.threeD.reasons) say(`  - ${r}`);
  let route; // { action: 'skip' | 'search' | 'own', file?, forced? }
  if (flags.threeD === 'no') route = { action: 'skip', reason: 'The operator said no.' };
  else if (flags.threeD && flags.threeD !== 'yes') route = { action: 'own', file: flags.threeD };
  else if (flags.threeD === 'yes') route = { action: 'search' };
  else if (decide) route = (await decide({ kind: 'media-3d', fit: fit.threeD })) ?? { action: 'skip', reason: 'No answer; 3D is never added without a yes.' };
  else route = { action: 'skip', reason: 'No answer; 3D is never added without a yes.' };
  const forced = route.action !== 'skip' && fit.threeD.class === 'not-recommended';

  if (route.action === 'skip') decision.threeD = { decision: 'skipped', reason: route.reason ?? 'The operator chose to continue without 3D.' };
  else if (route.action === 'own') {
    const check = checkOwnModel(route.file);
    if (!check.ok) {
      say(`  ${check.reason}`);
      decision.threeD = { decision: 'skipped', reason: check.reason };
    } else {
      const id = basename(route.file).replace(/\.glb$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      mkdirSync(join(pub, 'models'), { recursive: true });
      copyFileSync(route.file, join(pub, 'models', `${id}.glb`));
      registerModel(dir, { file: join(pub, 'models', `${id}.glb`), path: `models/${id}.glb`, source: 'Supplied by the client', licence: 'Supplied by the client, who confirmed they may use it', evidence: 'operator confirmation (forge go)' });
      decision.threeD = threeDRow({ id, title: id, creator: 'The client', licence: 'Supplied by the client', source: 'upload', url: null, file: `models/${id}.glb`, poster: null, bytes: check.bytes, concept: fit.threeD.concept, forced });
    }
  } else {
    let candidates = [];
    try {
      candidates = await searchModels(fit.threeD.terms, { fetch: fetchImpl, avoid: fit.threeD.avoid });
    } catch (err) {
      say(`  Could not search for models: ${err.message}`);
    }
    decision.threeD = { decision: 'skipped', reason: 'No model could be found.', candidates: candidates.map(slim) };
    if (candidates.length) {
      let pick = flags.model ?? (decide ? await decide({ kind: 'media-pick', what: '3D model', candidates, concept: fit.threeD.concept }) : undefined);
      if (pick === undefined) return { status: 'waiting', needs: { kind: 'media-pick', what: '3D model', candidates, hint: 'Choose one with --pick <id>, or skip 3D with --3d no' } };
      const chosen = candidates.find((c) => c.id === pick);
      if (!chosen) decision.threeD = { decision: 'skipped', reason: 'No model was chosen.', candidates: candidates.map(slim) };
      else {
        try {
          const got = await downloadModel(chosen, pub, { fetch: fetchImpl });
          registerModel(dir, { file: got.file, path: got.path, source: chosen.url, licence: 'CC0 (Poly Haven)', evidence: chosen.url });
          if (got.poster) registerVideo(dir, { paths: [got.poster], role: '3D poster', source: chosen.url, licence: 'CC0 (Poly Haven)', evidence: chosen.url });
          decision.threeD = threeDRow({ ...chosen, file: got.path, poster: got.poster, bytes: got.bytes, concept: fit.threeD.concept, forced, candidates: candidates.map(slim) });
        } catch (err) {
          say(`  Could not use ${chosen.title}: ${err.message}`);
          decision.threeD = { decision: 'skipped', reason: err.message, candidates: candidates.map(slim) };
        }
      }
    } else say('  No free model fit the budget.');
  }
  if (decision.threeD.decision === 'chosen') say(`  3D: ${decision.threeD.title} by ${decision.threeD.creator} (${decision.threeD.licence}), placed ${decision.threeD.position}.`);
  else say(`  3D: not added (${decision.threeD.reason}).`);

  // ---- video ----
  say(`\nVideo: ${fit.video.need === 'none' ? 'not needed' : `a ${fit.video.need} helps`}.`);
  for (const r of fit.video.reasons) say(`  - ${r}`);
  let clipFile = flags.video;
  let clipSource = clipFile ? { source: 'Supplied by the client', licence: 'Supplied by the client, who confirmed they may use it', creator: 'The client', url: null, evidence: 'operator confirmation (forge go)' } : null;
  if (!clipFile && decide) {
    const way = await decide({ kind: 'media-video', need: fit.video.need, reasons: fit.video.reasons });
    if (way?.action === 'own') {
      clipFile = way.file;
      clipSource = { source: 'Supplied by the client', licence: 'Supplied by the client, who confirmed they may use it', creator: 'The client', url: null, evidence: 'operator confirmation (forge go)' };
    } else if (way?.action === 'find') {
      const query = way.query || `${brief.client?.industry ?? 'cafe'} ${(brief.brand?.tone ?? []).join(' ')}`.trim();
      const found = await searchPexels(query, { key: env.PEXELS_API_KEY, fetch: fetchImpl }).catch((e) => ({ clips: [], error: e.message }));
      if (found.needsKey) say('  Finding free clips needs a Pexels API key (free at pexels.com/api). Put PEXELS_API_KEY in .env, or give me your own clip.');
      else if (found.error) say(`  Could not search Pexels: ${found.error}`);
      else if (!found.clips.length) say('  No suitable free clip was found.');
      else {
        const pick = flags.clip ?? (await decide({ kind: 'media-pick', what: 'video clip', candidates: found.clips }));
        const chosen = found.clips.find((c) => c.id === pick);
        if (chosen) {
          const tmp = mkdtempSync(join(tmpdir(), 'forge-clip-'));
          clipFile = await downloadClip(chosen, join(tmp, `${chosen.id}.mp4`), { fetch: fetchImpl });
          clipSource = { source: chosen.url, licence: chosen.licence, creator: chosen.creator, url: chosen.url, evidence: chosen.url, id: chosen.id };
        }
      }
    }
  }
  if (!clipFile) decision.video = { decision: 'skipped', reason: fit.video.need === 'none' ? 'Video does not help this site.' : 'No clip was supplied or chosen; the site uses photographs.' };
  else {
    try {
      const info = probeVideo(clipFile);
      const sound = Boolean(flags.videoSound) && info.hasAudio;
      let placement = placeVideo(info, brief, { role: flags.videoRole, sound });
      if (!flags.videoRole && decide) {
        const answer = await decide({ kind: 'media-place', info, placement });
        if (answer === 'skip') placement = null;
        else if (answer === 'hero-loop' || answer === 'story-clip') placement = placeVideo(info, brief, { role: answer, sound });
      }
      if (!placement) decision.video = { decision: 'skipped', reason: 'The operator chose not to use the clip.' };
      else {
        const id = clipSource.id ?? basename(clipFile).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const keepAudio = sound && placement.role === 'story-clip';
        const prep = prepareVideo(clipFile, pub, id, { role: placement.role, keepAudio });
        registerVideo(dir, { paths: [prep.mp4, prep.webm, prep.poster], role: placement.role, source: clipSource.source, licence: clipSource.licence, evidence: clipSource.evidence });
        decision.video = { decision: 'chosen', id, role: placement.role, sound: keepAudio, page: placement.page, section: placement.section, reasons: placement.reasons, warnings: [...placement.warnings, ...(prep.warn ? [prep.warn] : [])], source: clipSource.source, licence: clipSource.licence, creator: clipSource.creator, url: clipSource.url, mp4: prep.mp4, webm: prep.webm, poster: prep.poster, bytes: prep.bytes, input: { durationS: info.durationS, width: info.width, height: info.height } };
        say(`  Video: ${placement.role} on ${placement.page}: ${placement.section}.`);
        for (const r of placement.reasons) say(`    why: ${r}`);
        for (const w of decision.video.warnings) say(`    note: ${w}`);
      }
    } catch (err) {
      say(`  Could not use the video: ${err.message}`);
      decision.video = { decision: 'skipped', reason: err.message };
    }
  }
  return finish(project, ctx, dir, decision);
}

function slim(c) {
  return { id: c.id, title: c.title, creator: c.creator, licence: c.licence, url: c.url, polycount: c.polycount, bytes: c.bytes, previewImage: c.previewImage };
}

function threeDRow(m) {
  return {
    decision: 'chosen',
    id: m.id,
    title: m.title,
    creator: m.creator,
    licence: m.licence,
    source: m.source,
    url: m.url,
    file: m.file,
    poster: m.poster,
    bytes: m.bytes,
    concept: m.concept,
    page: '/',
    position: 'on the home page, below the hero and after the first proof section (never in front of the main button)',
    forced: Boolean(m.forced),
    ...(m.candidates ? { candidates: m.candidates } : {}),
  };
}

function finish(project, ctx, dir, decision) {
  writeJsonAtomic(join(dir, DECISION_FILE), decision);
  // The brief carries a short summary, so every later stage sees it without reading another file.
  const briefFile = join(dir, 'intake', 'brief.json');
  const brief = JSON.parse(readFileSync(briefFile, 'utf8'));
  const t = decision.threeD;
  const v = decision.video;
  brief.media = {
    ...(t && { threeD: t.decision === 'chosen' ? pick(t, ['decision', 'id', 'title', 'creator', 'licence', 'source', 'url', 'file', 'poster', 'concept', 'page', 'position', 'forced']) : { decision: 'skipped', reason: t.reason } }),
    ...(v && { video: v.decision === 'chosen' ? pick(v, ['decision', 'id', 'role', 'sound', 'page', 'section', 'reasons', 'source', 'licence', 'creator', 'url', 'mp4', 'webm', 'poster']) : { decision: 'skipped', reason: v.reason } }),
  };
  writeJsonAtomic(briefFile, brief);
  note(project, ctx, { event: 'media_decision', threeD: t?.decision, threeDId: t?.id, video: v?.decision, videoRole: v?.role, forced: Boolean(t?.forced) });
  return { status: 'decided', decision };
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));

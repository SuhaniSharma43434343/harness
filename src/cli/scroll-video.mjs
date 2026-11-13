import { isAbsolute, join, resolve } from 'node:path';
import { loadConfig as loadForgeConfig } from '../core/config.mjs';
import * as ledger from '../core/ledger.mjs';
import { loadProject } from '../core/project.mjs';
import { assessVideo } from '../scroll-video/assess.mjs';
import { LAYOUT_CATALOG, listConfigs } from '../scroll-video/config.mjs';
import { probeFile } from '../scroll-video/probe.mjs';
import { addVideo, checkAll, checkScrollVideo, createScrollVideo, writeFrames, writePrompts, writeStills } from '../scroll-video/project.mjs';

const USAGE = `Usage: forge scroll-video <command>
  layouts                                      the six layouts and when to use each
  probe <file> [--json]                        duration, size, aspect ratio, codec, keyframes, advice
  new <project> <id> [--beats n] [--layout type] [--duration s] [--aspect 16:9] [--title "..."] [--force]
  prompts <project> <id>                       storyboard -> AI video prompts (design/scroll-video/<id>-prompts.md)
  add-video <project> <id> --video <file> [--video <file> --media "<query>"] [--poster <image>]
            [--poster-alt "..."] [--poster-at <s>] [--licence "..."] [--tool "<generator>"] [--rescale]
  stills <project> <id>                        one still per scene and a contact sheet
  frames <project> <id> [--fps 12] [--width 960]   an image sequence for the frames renderer
  check <project> [id] [--json]                schema, timing, files and the probed video
See docs/scroll-video/.`;

// Flags: --name value, repeatable ones collected in order; bare words are positional.
export function parseArgs(args) {
  const pos = [];
  const flags = {};
  const list = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = args[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i++, next);
    list.push([key, value]);
    flags[key] = value;
  }
  return { pos, flags, list };
}

function workspaceFor(root) {
  const dir = loadForgeConfig(root).config.workspaceDir;
  return isAbsolute(dir) ? dir : join(root, dir);
}

function project(root, name) {
  if (!name || name.startsWith('-')) throw Object.assign(new Error('Name the project.'), { usage: true });
  const workspace = workspaceFor(root);
  loadProject(name, { workspace });
  return { workspace, dir: join(workspace, name), note: (data) => ledger.append(name, { actor: 'cli', type: 'note', data: { event: 'scroll_video', ...data } }, { workspace }) };
}

const sev = { critical: 'CRITICAL', serious: 'SERIOUS', moderate: 'note', minor: 'note' };
const printFindings = (r) => {
  console.log(`${r.id}: ${r.ok ? 'ready' : 'not ready'}`);
  for (const f of r.findings) console.log(`  ${sev[f.severity] ?? f.severity}  ${f.message}${f.field ? `  [${f.field}]` : ''}`);
};

export async function cmdScrollVideo(root, args) {
  const [sub, ...rest] = args;
  const { pos, flags, list } = parseArgs(rest);
  try {
    switch (sub) {
      case 'layouts':
        for (const l of LAYOUT_CATALOG) console.log(`${l.type.padEnd(12)} ${l.composition}\n${''.padEnd(12)} Best for: ${l.bestFor}`);
        return 0;

      case 'probe': {
        if (!pos[0]) throw Object.assign(new Error('Name the video file.'), { usage: true });
        const info = probeFile(resolve(pos[0]));
        const a = assessVideo(info, { name: pos[0] });
        if (flags.json) console.log(JSON.stringify({ probe: info, assessment: a }, null, 2));
        else {
          console.log(`${pos[0]}: ${info.container} ${info.codec}, ${info.width}x${info.height} (${info.aspectRatio}), ${info.durationS} s, ${info.fps ?? '?'} fps, ${(info.bytes / 1048576).toFixed(1)} MB, keyframes every ${info.keyframeIntervalS ?? '?'} s${info.hasAudio ? ', has sound' : ''}`);
          for (const e of a.errors) console.log(`  REFUSED  ${e}`);
          for (const w of a.warnings) console.log(`  warning  ${w}`);
          for (const r of a.recommendations) console.log(`  advice   ${r.why}${r.command ? `\n           ${r.command.split('\n').join('\n           ')}` : ''}`);
        }
        return a.ok ? 0 : 1;
      }

      case 'new': {
        const p = project(root, pos[0]);
        const r = createScrollVideo(p.dir, { id: pos[1], beats: Number(flags.beats ?? 5), layout: flags.layout ?? 'cinematic', durationS: Number(flags.duration ?? 8), aspectRatio: flags.aspect ?? '16:9', title: flags.title, force: Boolean(flags.force) });
        p.note({ action: 'new', id: pos[1] });
        console.log(`Wrote ${r.file}. Write the storyboard beats, then run forge scroll-video prompts ${pos[0]} ${pos[1]}.`);
        return 0;
      }

      case 'prompts': {
        const p = project(root, pos[0]);
        const r = writePrompts(p.dir, pos[1]);
        p.note({ action: 'prompts', id: pos[1], shots: r.config.prompts.shots.length });
        console.log(`Wrote the prompts into the config and ${r.file} (${r.config.prompts.shots.length} shot${r.config.prompts.shots.length === 1 ? '' : 's'}).`);
        return 0;
      }

      case 'add-video': {
        const p = project(root, pos[0]);
        // --video <file> [--media "<query>"] pairs, in order.
        const files = [];
        for (const [k, v] of list) {
          if (k === 'video') files.push({ path: resolve(String(v)) });
          if (k === 'media' && files.length) files[files.length - 1].media = String(v);
        }
        const r = await addVideo(p.dir, pos[1], {
          files,
          poster: flags.poster ? resolve(String(flags.poster)) : undefined,
          posterAlt: typeof flags['poster-alt'] === 'string' ? flags['poster-alt'] : undefined,
          posterAt: flags['poster-at'] ? Number(flags['poster-at']) : 0,
          licence: typeof flags.licence === 'string' ? flags.licence : undefined,
          tool: typeof flags.tool === 'string' ? flags.tool : undefined,
          rescale: Boolean(flags.rescale),
        });
        p.note({ action: r.replaced ? 'replace-video' : 'add-video', id: pos[1], files: r.config.video.sources.map((s) => s.src), durationS: r.config.video.durationS });
        const v = r.config.video;
        console.log(`${r.replaced ? 'Replaced' : 'Added'} the video for ${pos[1]}: ${v.width}x${v.height} (${v.aspectRatio}), ${v.durationS} s, ${v.sources.length} source${v.sources.length === 1 ? '' : 's'}, poster ${v.poster.src}.`);
        for (const rep of r.reports) {
          for (const w of rep.assessment.warnings) console.log(`  ${rep.file}: ${w}`);
          const firstAdvice = rep.assessment.recommendations.find((x) => x.id === 'keyframes' || x.id === 'bitrate');
          if (firstAdvice) console.log(`  advice: ${firstAdvice.why}\n    ${firstAdvice.command}`);
        }
        if (!flags.licence) console.log('  No --licence given: the files are registered as uncertain until Asset Rights records the licence.');
        const c = checkScrollVideo(p.dir, pos[1]);
        printFindings(c);
        return 0;
      }

      case 'stills': {
        const p = project(root, pos[0]);
        const r = await writeStills(p.dir, pos[1]);
        p.note({ action: 'stills', id: pos[1], count: r.files.length });
        console.log(`Wrote ${r.files.length} stills and ${join(r.dir, 'index.html')}.`);
        return 0;
      }

      case 'frames': {
        const p = project(root, pos[0]);
        const r = await writeFrames(p.dir, pos[1], { fps: Number(flags.fps ?? 12), width: Number(flags.width ?? 960) });
        p.note({ action: 'frames', id: pos[1], count: r.count, bytes: r.bytes });
        console.log(`Wrote ${r.count} frames (${(r.bytes / 1048576).toFixed(1)} MB) and added them to the config.`);
        return 0;
      }

      case 'check': {
        const p = project(root, pos[0]);
        const results = pos[1] ? [checkScrollVideo(p.dir, pos[1])] : checkAll(p.dir);
        if (!results.length) console.log(`${pos[0]} has no scroll video configs (design/scroll-video/). Known: ${listConfigs(p.dir).join(', ') || 'none'}`);
        if (flags.json) console.log(JSON.stringify(results, null, 2));
        else results.forEach(printFindings);
        return results.every((r) => r.ok) ? 0 : 1;
      }

      default:
        console.error(USAGE);
        return sub ? 2 : 0;
    }
  } catch (err) {
    if (err.usage) {
      console.error(`${err.message}\n${USAGE}`);
      return 2;
    }
    throw err;
  }
}

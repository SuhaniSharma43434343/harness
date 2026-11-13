// Storyboard to AI video prompts. Deterministic: the same storyboard, brief and tokens give the
// same prompts, so the operator can diff them. Generator-neutral: the master prompt describes one
// continuous take; `shots` cut it into pieces no longer than a generator's maximum length, each
// told to continue from the previous last frame (image-to-video), for tools that cap a clip at
// 5 to 10 seconds. The checklist is what the delivered clip must pass before upload.

const PLACEHOLDER = /\b(TODO|TBD)\b/;
const r1 = (v) => Math.round(v * 10) / 10;

// What makes a clip scrub well, said to the generator.
const SCRUB_RULES = [
  'one continuous take with no cuts, dissolves or scene changes',
  'smooth, steady camera motion at an even speed, so every frame works as a still',
  'the subject stays in frame and in focus for the whole clip',
  'consistent lighting and colour from the first frame to the last',
  'no text, captions, logos, watermarks or interface elements in the picture',
  'the last second holds almost still, so the end of the scroll rests on a clean frame',
];
const NEGATIVE = 'cuts, jump cuts, scene changes, fades to black, flashing, strobing, camera shake, handheld wobble, whip pans, motion-blur smears, morphing or melting shapes, warped hands, extra limbs, flicker, text, captions, subtitles, logos, watermarks, borders, letterboxing, split screens';

export function placeholders(storyboard) {
  const out = [];
  const visit = (v, at) => {
    if (typeof v === 'string' && PLACEHOLDER.test(v)) out.push(at);
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${at}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, `${at}.${k}`);
  };
  visit(storyboard, 'storyboard');
  return out;
}

// buildVideoPrompts(config, { brief, tokens, maxShotS }) => the prompts block of the config.
export function buildVideoPrompts(config, { brief = {}, tokens = null, maxShotS = 8, now = () => new Date() } = {}) {
  const sb = config.storyboard;
  if (!sb?.beats?.length) throw new Error(`${config.id} has no storyboard beats to write prompts from.`);
  const todo = placeholders(sb);
  if (todo.length) throw new Error(`The storyboard still has TODO text at ${todo.slice(0, 4).join(', ')}${todo.length > 4 ? ` and ${todo.length - 4} more` : ''}. Write those first.`);
  const duration = sb.durationS ?? config.video?.durationS ?? 8;
  const aspect = sb.aspectRatio ?? config.video?.aspectRatio ?? '16:9';
  const style = sb.style ?? {};
  const palette = style.palette?.length ? style.palette : tokens?.color ? Object.values(tokens.color).filter((c) => typeof c === 'string').slice(0, 5) : [];
  const tone = brief.brand?.tone?.length ? brief.brand.tone.join(', ') : null;

  // Beat times, scaled to the duration.
  const total = sb.beats.reduce((s, b) => s + (b.durationS ?? 0), 0);
  const unset = sb.beats.filter((b) => !b.durationS).length;
  const share = unset ? Math.max(0, duration - total) / unset : 0;
  const lens = sb.beats.map((b) => b.durationS ?? share);
  const k = duration / (lens.reduce((a, b) => a + b, 0) || 1);
  let t = 0;
  const timed = sb.beats.map((b, i) => {
    const from = t;
    t += lens[i] * k;
    return { ...b, from: r1(from), to: r1(i === sb.beats.length - 1 ? duration : t) };
  });

  const describe = (beats) => beats.map((b) => `From ${b.from} to ${b.to} s: ${b.action.replace(/\.$/, '')}${b.camera ? ` (camera: ${b.camera})` : ''}.`).join(' ');
  const look = [
    style.look && `Look: ${style.look}.`,
    style.lighting && `Lighting: ${style.lighting}.`,
    (style.mood || tone) && `Mood: ${[style.mood, tone].filter(Boolean).join('; ')}.`,
    palette.length && `Colour palette: ${palette.join(', ')}.`,
  ].filter(Boolean);
  const master = [
    `A single continuous ${duration}-second video shot, aspect ratio ${aspect}.`,
    sb.subject && `Subject: ${sb.subject}.`,
    sb.setting && `Setting: ${sb.setting}.`,
    `Camera: ${style.camera ?? 'one slow, steady move that never cuts'}.`,
    describe(timed),
    ...look,
    `Rules: ${SCRUB_RULES.join('; ')}.`,
  ].filter(Boolean).join(' ');

  // Shots no longer than maxShotS, split on beat boundaries where possible.
  const shots = [];
  let current = [];
  for (const b of timed) {
    const from = current[0]?.from ?? b.from;
    if (current.length && b.to - from > maxShotS) {
      shots.push(current);
      current = [];
    }
    current.push(b);
  }
  if (current.length) shots.push(current);
  const shotPrompts = shots.map((beats, i) => ({
    from: beats[0].from,
    to: beats[beats.length - 1].to,
    beats: beats.map((b) => b.id),
    prompt: [
      i === 0 ? `Opening shot of one continuous take, aspect ratio ${aspect}.` : `Continue exactly from the previous shot's last frame (use it as the start image): same subject, position, lighting and camera speed.`,
      sb.subject && `Subject: ${sb.subject}.`,
      sb.setting && `Setting: ${sb.setting}.`,
      describe(beats.map((b) => ({ ...b, from: r1(b.from - beats[0].from), to: r1(b.to - beats[0].from) }))),
      `Camera: ${style.camera ?? 'one slow, steady move'}.`,
      ...look,
      i === shots.length - 1 ? 'End on a steady frame that holds for the last second.' : 'End mid-motion at a steady speed; the next shot continues it.',
      'No cuts, no text, no logos.',
    ].filter(Boolean).join(' '),
  }));

  return {
    generatedAt: now().toISOString(),
    master,
    negative: NEGATIVE,
    shots: shotPrompts,
    settings: { aspectRatio: aspect, durationS: duration, fps: 24, resolution: resolutionFor(aspect), motion: 'continuous, even speed', maxShotS },
    checklist: [
      `Length within 0.5 s of ${duration} s, frame rate 24 to 30.`,
      `Aspect ratio ${aspect}, at least ${resolutionFor(aspect)}.`,
      'One continuous take: no cut, dissolve or jump anywhere (scrub through it frame by frame).',
      'The subject is in frame and recognisable in every scene still (forge scroll-video stills).',
      'No text, logos or watermarks in the picture; the words are added by the page.',
      'Shots joined end to end show no jump at the seams.',
      'The first frame works as the poster.',
    ],
  };
}

function resolutionFor(aspect) {
  const [w, h] = aspect.split(':').map(Number);
  if (!(w > 0 && h > 0)) return '1920x1080';
  if (w >= h) return `${Math.round((1080 * w) / h / 2) * 2}x1080`;
  return `1080x${Math.round((1080 * h) / w / 2) * 2}`;
}

// promptsMarkdown(config) => a page the operator can paste from.
export function promptsMarkdown(config) {
  const p = config.prompts;
  const lines = [
    `# Video prompts: ${config.title ?? config.id}`,
    '',
    `Generated ${p.generatedAt} by forge scroll-video prompts from the storyboard in design/scroll-video/${config.id}.json. Edit the storyboard and run it again rather than editing this file.`,
    '',
    '## Settings',
    '',
    ...Object.entries(p.settings).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Master prompt (one continuous take)',
    '',
    p.master,
    '',
    '## Negative prompt',
    '',
    p.negative,
    '',
    `## Shots (for generators that make at most ${p.settings.maxShotS} s at a time)`,
    '',
    ...p.shots.flatMap((s, i) => [`### Shot ${i + 1}: ${s.from} to ${s.to} s (${s.beats.join(', ')})`, '', s.prompt, '']),
    '## Before you upload',
    '',
    ...p.checklist.map((c) => `- [ ] ${c}`),
    '',
  ];
  return lines.join('\n');
}

# 3. Data schema

`schemas/scroll-video.schema.json` (short name `scrollVideo`, so `forge validate scrollVideo <file>` works). One file per scroll video, `design/scroll-video/<id>.json`, filled in by different roles as the project moves through the pipeline.

| Block | Required | Filled by | When |
| --- | --- | --- | --- |
| `id`, `version`, `title`, `concept` | `id`, `version` | Creative Director (`forge scroll-video new`) | After B2 |
| `storyboard` | no | Creative Director | Before any video exists |
| `prompts` | no | `forge scroll-video prompts`, refined by the Creative Director | From the storyboard |
| `video` | no (until upload) | `forge scroll-video add-video`, from the probed file | After external generation |
| `layout`, `scroll`, `animation`, `foreground`, `label` | `layout` | Creative Director, from the approved direction | Any time; defaults exist |
| `scenes` | yes, at least 1 | Creative Director (timing, position, animation, overlay), Content & UX (words) | From the storyboard, retimed to the real clip |

## Video asset (`video`)

`sources[]` (`src`, `type` mp4 or webm, optional `codecs`, `media`, `width`, `height`, `bytes`), `poster` (`src`, `alt`), `durationS`, `width`, `height`, `aspectRatio`, `fps`, `bytes`, `keyframeIntervalS`, optional `frames` (`pattern` with `{i}`, `count`, `fps`, `width`, `height`), and `origin` (which generator, when). Every field except `alt` and `origin` is measured by the probe, never typed by hand.

## Scene

| Field | Type | Notes |
| --- | --- | --- |
| `id` | slug | Unique in the config. |
| `start`, `end` | seconds | `0 ≤ start < end ≤ durationS`, in order, no overlap (gaps allowed). |
| `title` | ≤ 120 chars | A real heading (`h3`). |
| `eyebrow`, `description` | ≤ 60 / ≤ 400 chars | Optional. |
| `label` | ≤ 32 chars | Chapter-rail name; defaults to the title. |
| `position` | 9-point grid | `top-start` … `bottom-end`, logical so right-to-left sites mirror. Ignored where the layout places text itself (split, sticky-text). |
| `animation` | `fade`, `rise`, `slide`, `scale`, `blur`, `mask`, `none` | Overrides `animation.text`. Scrubbed with scroll, so it reverses. |
| `overlay` | `image` (real image with alt and size), `label`, `stat`, `callout` (text pinned to a point on the video frame) | Optional. |
| `cta` | `{ label, href }` | `href` is a path, anchor, https, mailto or tel; never `javascript:`. |
| `focus` | `"x% y%"` | Per-scene crop point for `fit: cover`. |
| `scroll` | `{ from, to }` fractions | The slice of the track the scene owns. All scenes or none. |

## Layout (`layout`)

`type` (`cinematic`, `sticky-text`, `split`, `product`, `background`, `labels`), `fit` (`cover`, `contain`), `focus`, `side` (split), `scrim` (0 to 0.9), `theme` (`site`, `invert`: which token pair the text uses over video), `frame` (rounded with `--radius`).

## Animation and scroll settings

- `animation`: `text` (default per-scene animation), `enter`/`exit` (share of each scene spent animating in and out, default 0.18/0.18), `progress` (`rail`, `bar`, `none`).
- `scroll`: `length` and `lengthMobile` (viewport heights), `smoothingMs`, `render` (`auto`, `video`, `frames`), `preload` (`auto`, `blob`, `stream`), `blobMaxBytes`, `seekBudgetMs`, `loadTimeoutMs`.

## Rules beyond the schema

`checkConfig(config, { probe, exists })` in `src/scroll-video/config.mjs` returns findings with the same severities as the gates (`critical`, `serious`, `moderate`, `minor`):

- **Timing:** scenes in order, inside the clip, no overlap; the config's `durationS` within 0.1 s of the probed file; scroll slices in order, inside 0 to 1, all or none; every scene gets at least 0.6 viewport heights of scroll on the shortest track, so its text can be read.
- **Count:** fewer than 3 scenes or more than 16 is `moderate` (a story needs beats; very many makes a long scroll). The engine has no limit.
- **Assets:** every `src` exists under `assets/public/`; the poster has `alt` (or explicitly empty); an image overlay has `alt`, `width`, `height`; frames `count` matches `durationS × fps` within one frame.
- **Words:** no placeholder text (`TODO`, `lorem`, `TBD`, `[...]`).
- **Layout fit:** callouts need `fit: contain` or a `product` layout to be reliable; `split` with `side` set; `background` needs `foreground`.

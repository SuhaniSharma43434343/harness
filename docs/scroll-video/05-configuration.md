# 5. Configuration interface

A new project changes three things: the video, the scenes and the layout settings. It changes them in one JSON file and one frontmatter entry, through the CLI or by hand.

## The page

```yaml
sections:
  - use: "APP-01/Hero"
  - use: "APP-02/ScrollVideo"
    id: "assembly-story"          # the section-plan id (optional; adds data-section for visual QA)
    config: "assembly"            # design/scroll-video/assembly.json
    scenes:                       # optional: locked words from Content & UX, matched by id
      - id: "base"
        title: "Hand-stretched every morning"
        description: "..."
```

`ScrollVideo` also accepts the whole config inline (`video`, `layout`, `scroll`, `animation`, `scenes`) for a site without a Forge project folder. The engine merges defaults, then the config file, then the page's props.

## The config file

```json
{
  "version": 1,
  "id": "assembly",
  "video": {
    "sources": [
      { "src": "/video/assembly-portrait.webm", "type": "video/webm", "media": "(max-aspect-ratio: 3/4)" },
      { "src": "/video/assembly.webm", "type": "video/webm" },
      { "src": "/video/assembly.mp4", "type": "video/mp4" }
    ],
    "poster": { "src": "/video/assembly-poster.webp", "alt": "The finished product on a workbench" },
    "durationS": 9.6, "width": 1920, "height": 1080, "aspectRatio": "16:9", "fps": 24
  },
  "layout": { "type": "product", "fit": "contain", "theme": "site" },
  "scroll": { "length": 6, "lengthMobile": 5, "smoothingMs": 120, "render": "auto" },
  "animation": { "text": "rise", "progress": "rail" },
  "scenes": [
    { "id": "parts", "start": 0, "end": 3.2, "title": "...", "position": "bottom-start" },
    { "id": "frame", "start": 3.2, "end": 6.4, "title": "...", "overlay": { "type": "callout", "text": "...", "point": { "x": 0.42, "y": 0.55 } } },
    { "id": "done", "start": 6.4, "end": 9.6, "title": "...", "cta": { "label": "...", "href": "/contact#quote" } }
  ]
}
```

## The six layouts

| `layout.type` | Composition | Best for | Phone |
| --- | --- | --- | --- |
| `cinematic` | Full-bleed video, scene text over a scrim at its `position` | Brand films, journeys, reveals | Full-bleed, `focus` keeps the subject in frame |
| `sticky-text` | Framed video pinned in the stage, scene text swaps in a caption panel beside or below it | Explaining a process, text-heavy scenes | Video above, caption below |
| `split` | Video on one side (`side`), scene text column on the other | Portrait or square clips on desktop; editorial pages | Video top 55%, text below |
| `product` | `contain` on the surface colour, callouts pinned to points on the video | Product assembly, feature tours | Same, callouts re-projected |
| `background` | Dimmed video behind persistent `foreground` content and a CTA; scenes are secondary captions | A hero that must keep one message and one button | Same |
| `labels` | Cinematic plus a prominent chapter rail of scene labels that highlight and jump | Many scenes (6 or more), timelines, construction stages | Rail collapses to a progress bar with the current label |

`recommendLayout({ video, scenes, direction, brief })` in `src/scroll-video/config.mjs` gives a layout and its reasons: portrait or square clip on a landscape page → `split`; a product or showroom brief, or callouts → `product`; a primary call to action that must stay visible → `background`; 6 or more scenes → `labels`; long scene descriptions → `sticky-text`; otherwise `cinematic`. The Creative Director may overrule it in the section plan; the reason is recorded in the config's `concept`.

## The CLI

```
forge scroll-video layouts                                   # the six layouts and when to use each
forge scroll-video probe <file> [--json]                     # duration, size, aspect ratio, codec, keyframes, advice
forge scroll-video new <project> <id> [--beats n] [--layout type] [--duration s] [--aspect 16:9]
forge scroll-video prompts <project> <id>                    # storyboard -> AI video prompts
forge scroll-video add-video <project> <id> --video <file> [--video <file> --media "<query>"]
                                [--poster <image>] [--poster-at <s>] [--licence "<text>"] [--tool "<generator>"] [--rescale]
forge scroll-video stills <project> <id>                     # one still per scene + contact sheet
forge scroll-video frames <project> <id> [--fps 12] [--width 960]   # optional frame sequence
forge scroll-video check <project> [id] [--json]             # schema, timing, files, probe consistency
```

Every command writes only inside the project folder and records a ledger note; none needs a model or network access.

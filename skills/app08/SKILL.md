---
name: app08
description: APP-08 AI Image Frame Animation. Add a scroll-scrubbed frame sequence from owned or licensed frames, and a 2.5D depth-map parallax scene, to a Forge site, with a static key frame fallback and a provenance record for every frame. Use when the approach decision selects APP-08 (a parallax or scrubbed hero sequence).
---

# APP-08: AI Image Frame Animation

A scroll-scrubbed sequence of frames, drawn on a 2D canvas. There is also an optional 2.5D parallax scene, built from an image and its depth map. It adds no package. ffmpeg, a system tool, can turn a video into frames.

## Inputs

- `design/approach-decision.json` with APP-08 selected
- Frames, owned or licensed: about 24 to 60 WebP or AVIF files at most 720 px high, 3 MB in total, numbered from 1 with no gaps. Or a video to extract them from.
- Optionally, an image and its greyscale depth map (white is near)
- The provenance of every frame and depth map: its source and licence, and for generated frames, the generator and its terms

## Steps

1. Run `forge approach <project> APP-08`. This copies `FrameSequence`, `DepthParallax` and the runtime.
2. Prepare the frames in `site/public/frames/<name>/`.
   - From a video: `extractFrames(video, outDir)` from `src/approaches/app08.mjs`. It uses ffmpeg to write 720p WebP frames.
   - From your own frames: check them with `checkFrames(dir)`, which checks the size, the numbering and gaps.
3. Record provenance with `registerFrames(projectDir, '/frames/<name>', { files, provenance: { source, licence, generator?, generatorTerms? } })`. Frames without a source and licence are refused, and so are generated frames without the generator's terms.
4. Place the sections:
   ```yaml
   - use: "APP-08/FrameSequence"
     heading: "..."
     frames: { pattern: "/frames/hero/%03d.webp", count: 48, width: 1280, height: 720 }
     keyFrame: { src: "/frames/hero/001.webp", alt: "..." }
     length: 3                       # screens of scrolling
   - use: "APP-08/DepthParallax"
     image: { src: "/images/scene.webp", alt: "...", width: 1200, height: 800 }
     depthMap: "/images/scene-depth.webp"
   ```
5. Build, then run `forge gates <project>`.

## How it plays

The key frame is an `<img>` and the first paint. After the page loads, the first frame is fetched. The rest come in four passes: every 8th, then every 4th, then every 2nd, then the remainder. That way scrubbing works almost at once, and the nearest loaded frame always fills a gap. If a frame fails to load, its neighbour stays on screen. If more than half fail, the sequence goes back to the key frame.

## Fallback

The static key frame, for:

- reduced motion;
- a low-end device;
- a slow network;
- a failed load.

The frame sequence needs no WebGL. The depth scene does, so without WebGL it keeps its plain image. The modes are recorded as `data-app08` and `data-app08-reason` on `<html>`, and as `data-depth-mode` on the depth section.

## Budget

- Frames: at most 3 MB in total for mobile, and at most 720 px high (`checkFrames`).
- No scroll segment without a frame. `tests/build/app08.test.mjs` scrolls through the sequence and checks that it moves forward to the last frame.

## Licences

Every frame and depth map has a provenance row in `assets/register.json`. ffmpeg is a system tool and is not shipped.

## Done when

- `tests/build/app08.test.mjs` passes: build, gates, scrubbing, the depth scene, the four fallbacks, no WebGL, the frame checks and provenance.
- The device log rows are filled in.

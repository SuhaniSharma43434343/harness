---
name: app05
description: APP-05 Shader / WebGL. Add a GLSL background section with a quality ladder (full, reduced, off) and a CSS gradient fallback to a Forge site. Use when the approach decision selects APP-05 for an accent background or transition.
---

# APP-05: Shader / WebGL

A section with a moving GLSL colour field behind its copy. It is drawn with plain WebGL and our own shader code, so it adds no package and nothing to license.

## Inputs

- `design/approach-decision.json` with APP-05 selected
- The design tokens: the shader uses `--color-bg`, `--color-primary` and `--color-accent` unless the section overrides them

## Steps

1. Run `forge approach <project> APP-05`. This copies `ShaderBackground` and the runtime; there is no package to install.
2. Place the section:
   ```yaml
   - use: "APP-05/ShaderBackground"
     heading: "..."                 # required
     text: "..."
     intensity: 2                   # 1 to 3: how much the field warps
     colours: { a: "#0f1b2d", b: "#1f3a5f", c: "#c58b2b" }   # optional
     cta: { label: "...", href: "/contact" }
   ```
3. Check that the copy keeps its contrast over the gradient, which is the fallback, then build and run `forge gates <project>`.

## Quality ladder

| Level | What it draws |
| --- | --- |
| full | Native resolution (up to 2x), every frame |
| reduced | Half resolution, at most 30 frames a second |
| off | The CSS gradient alone |

It starts at full. When the slowest tenth of frames stays over about 22 ms, it steps down one level. It pauses off screen, in a background tab, and while another WebGL section is in view (`lib/app05/webgl-slot.js`).

## Fallback

The CSS gradient is always in the page, under the canvas. It is all that shows for:

- no WebGL;
- a low-end device;
- a slow network;
- a failed load;
- frames that stay too slow.

With reduced motion, one still frame of the shader is drawn and nothing moves. The mode is recorded on `<html>` as `data-app05` (`full`, `reduced` or `fallback`) and `data-app05-reason`.

## Budget

- At most 80 KB of extra JavaScript (gzip). The runtime is a few KB.
- 8 ms of GPU time a frame on a mid-range phone. The headless frame-time probe is in `tests/build/app05.test.mjs`, and the real-device GPU timing is logged in `docs/device-log.md`.

## Licences

The shaders are our own, value noise included. Any third-party noise function added later needs a licence row.

## Done when

- `tests/build/app05.test.mjs` passes: build, gates, the quality ladder, and the five fallbacks.
- The device log rows are filled in.

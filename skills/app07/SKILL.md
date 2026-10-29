---
name: app07
description: APP-07 AI + 3D + Motion + Real. The flagship composite. Apply APP-02 (cinematic scroll) and APP-03 (3D scene), and optionally APP-05 (shader background), to one site with a shared performance budget and one WebGL canvas at a time. Use when the approach decision selects APP-07 (enterprise flagship, tier L).
---

# APP-07: AI + 3D + Motion + Real

APP-07 is not a section of its own. It applies APP-02 and APP-03 to one site, plus APP-05 when the design asks for a shader background, all on top of APP-01. It then holds the parts to one budget between them.

## Inputs

- `design/approach-decision.json` with APP-07 selected
- What each part needs: see `skills/app02`, `skills/app03` and `skills/app05`

## Steps

1. Run `forge approach <project> APP-07`. This applies APP-02 and APP-03 in turn and installs their packages once. In code, `app07.apply(siteDir, { shader: true })` adds APP-05 too.
2. Place each part's sections where the page needs them: `APP-02/ScrollStory`, `APP-02/Chapter`, `APP-03/Scene3D` and `APP-05/ShaderBackground`.
3. Build, then check the shared budget with `checkComposite(siteReport(dist), baseline, { shader })` from `src/approaches/app07.mjs`. Here `baseline` is the same site without approaches. Then run `forge gates <project>`.

## Shared budget

- **Up front:** the JavaScript stays within APP-01's budget, because every part loads on demand.
- **Extra JavaScript:** at most APP-02 plus APP-03, which is 310 KB gzip. With APP-05 the limit is 390 KB.
- **One WebGL canvas at a time:** APP-03 and APP-05 share one registry (`webgl-slot.js`, on `globalThis`), so only the section most in view runs and the others pause.

## Fallback

The site drops to APP-01 plus APP-02. Each 3D part falls back on its own, to its poster or gradient, while the cinematic scroll keeps running. With reduced motion, every part uses its own fallback.

## Done when

- `tests/build/app07.test.mjs` passes. It covers the build, the shared budget, the gates, one WebGL canvas at any point of the scroll, the drop to APP-01 plus APP-02 without WebGL, and reduced motion.
- Each part's device log rows are filled in.

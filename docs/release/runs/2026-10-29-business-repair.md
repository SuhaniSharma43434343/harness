# Real-model repair runs: business site, 2026-10-29

Three runs of `node scripts/release-run.mjs business --fresh --repair` on Linux x64 (Node 22.22.0), with Claude Code 2.1.312 as the builder. Each run takes the business brief (`samples/release/business.json`, APP-01 + APP-02) through every built command, records B3, moves the project to QUALITY_REVIEW, and runs `forge qa --repair`. The fixes between runs are in the T28 pull request.

| Run | Code | Repair loops | Builder sessions | Repair time | Defects fixed | Gates failing after repair |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | before the fixes | 3, then escalated | 20 | 886 s | 42 of 48 | content-parity, seo, forms |
| 2 | verifier builds first | 3, then escalated | 10 | 587 s | 47 of 48 | content-parity |
| 3 | all fixes | 2, then escalated | 6 | 481 s | 47 of 48 | content-parity |

The QA Verifier found the same 48 blocking defects on each fresh site: 41 shipped files with no licence record (fonts and the favicon), 4 pages with no canonical URL, the form with no endpoint, GSAP's licence (dependencies) and content-parity, which cannot run before B3.

## What the runs showed

- **Run 1.** The builder fixed the licence register and the dependencies, and set `site.url` in `site/src/site.json` for the SEO defects. The gate verifier then checked the old `site/dist`, so the SEO and forms fixes failed their tasks three loops running and were escalated. It also spent a task on content-parity in every loop, though the builder may not write `content/pages/`. Fixed: the verifier now builds the site first, and a skipped gate gets no task.
- **Run 2.** With the build in the verifier, SEO and forms were fixed in the first loop. But the form fix was `action="/api/contact"`, an endpoint that does not exist; the forms gate passed it because it intercepts every endpoint. Fixed: the forms gate now fails a form-function form whose action is not `/api/form` (`wrong-endpoint`).
- **Run 3.** The builder set `action="/api/form?form=quote"`, the form-function endpoint. Every gate passes except content-parity, and the loop escalated after 2 loops with only D-001 open, without wasting a third. Report: `2026-10-29-business-repair-3.md`.

In every run the builder's dependencies task marked GSAP `cleared` in `assets/register.json`, with a note that the Standard licence allows commercial sites. That decision belongs to Asset Rights and the operator (integration log, blocker 10).

## What this means for A4 and A8

The repair loop with a real model is working: from a fresh scaffold it clears every gate a builder is allowed to fix. The floor is still not met, because content-parity needs locked content from P6 (B3), and nothing creates the P5 to P9 tasks yet (integration log, blocker 1). The showroom and story sites were not repaired with a model in this session; their no-model runs are in this folder.

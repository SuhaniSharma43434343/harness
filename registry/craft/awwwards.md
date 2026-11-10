# Craft guide: sites that win awards and do not look machine-made

Read this before you make any design decision. The approach (APP-01 to APP-08) says WHICH method this site follows. This guide says how well it must be done. It is judged the way Awwwards judges: **Design 40%, Usability 30%, Creativity 20%, Content 10%**. A site that scores under 7 out of 10 on any of the four is not finished.

## What makes a site look machine-made (never do these)

- A centred headline over a stock photo or a gradient, with two buttons under it, as the whole hero.
- Three or four equal cards in a row, repeated down the page (features, services, reviews, pricing).
- The same section shape twice in a row: heading, paragraph, image, repeat.
- Every section the same width, the same padding, the same background, with nothing overlapping anything.
- One typeface used at one weight, headings only a little bigger than the body.
- A purple-to-blue gradient, glass cards, soft shadows on everything, emoji or stock icon rows.
- Stock phrases ("Welcome to", "Unlock your", "Why choose us", "Our services", "Get started today").
- Motion that is only "fade up on scroll" on every element.
- Generic photos of smiling people at laptops, or a handshake.
- Pages that are short: a home page that is one screen of promise and one of contact.

## Design (40%)

1. **One idea.** The concept sentence in `design/direction.json` is the test of every choice. If a section would look the same on a competitor's site, redo it.
2. **Scale contrast.** Make something huge and something small on the same screen. The display type is at least 6 times the body size on desktop (use `clamp`), and one word or number per page may be set at poster scale.
3. **Break the grid on purpose.** In at least a third of sections, something overlaps, bleeds off the edge, is offset, is cropped by the viewport, or sits on a different axis from its neighbours. Show it in the composition: what overlaps what, by how much, which layer is on top.
4. **Type with character.** Use the display face the direction chose, at real weight and tight tracking at large sizes, with a body face that is calm. Set at least one moment of type as image: very large, cropped, outlined, or running along a path.
5. **Colour with discipline.** One dominant colour, one sharp accent, neutrals with a slight tint. Use the accent for the primary action and one or two moments, nowhere else.
6. **Real imagery.** Use the client's own photos, cropped with intent (tight crops, odd aspect ratios, one image taking a full screen). Never fill a gap with a stock photo. A missing photo is replaced by type, colour or a drawn shape, not a fake.
7. **Rhythm.** Alternate dense and empty, loud and quiet, dark and light. No three neighbouring sections share a layout or a background.
8. **Details.** Custom cursor or hover states that fit the concept, styled focus rings, a designed 404, designed form states, a footer that finishes the story. Small things are how a site feels made by a person.

## Usability (30%)

1. The primary action is visible without scrolling on a phone, and it is one tap away from every page.
2. The phone is designed first (360 px wide, mid-range Android, slow 4G). Heavy motion has a still fallback. Nothing needs hover.
3. Tap targets are at least 44 px. Body text is at least 16 px with a line length of 45 to 75 characters. Contrast meets WCAG 2.2 AA.
4. The navigation is simple: 5 to 7 items, the current page is marked, and it works with a keyboard.
5. Forms ask only what is needed, show clear errors and confirm what happens next.
6. Respect `prefers-reduced-motion`: every animation has a calm version.
7. The page loads fast: the first screen needs no large script, images are sized and lazy-loaded, fonts are limited to two families.

## Creativity (20%)

1. **One signature moment per page** that a visitor would describe to a friend: a pinned scene that changes as you scroll, a hero where the headline is revealed by an image, a number that counts into place, a map that draws a route, a menu that unrolls. It serves the concept and the business goal, never decoration.
2. **Scroll is a story.** Each page has a beginning (the promise), a middle (the proof, in the form that suits this business) and an end (the action). Plan the order of feelings, not only the order of content.
3. **Motion has a job.** Each motion shows hierarchy, direction, cause and effect or state. Use easing with weight (ease-out for entering, ease-in-out for moving), stagger by 40 to 80 ms, keep entrances under 700 ms. Do not animate everything.
4. Borrow from outside web design (print, packaging, signage, film titles, maps, menus) and say what you borrowed in the direction notes.

## Content (10%)

1. Headlines say something only this business can say, using the owner's facts. Specific beats clever; clever beats generic.
2. Short sentences. Active voice. Plain English. One idea per paragraph.
3. Every page earns its length: a home page for a medium or large site has 7 or more sections, and each inner page has 4 or more, each with a different job.
4. Never invent facts, times, prices, names or numbers. Write around anything the owner did not give.
5. Every section ends by pointing at the next step.

## Length and depth

A site for a real business is not a brochure. The home page tells the whole story in 7 to 10 sections. Each service, product, project, room, doctor, dish or listing that matters gets its own place (a page, or a deep section with its own picture and its own call to action). Inner pages follow the same craft as the home page. A short site that looks finished is still failed.

## How the judge scores

Score each criterion 1 to 10 against this guide. A criterion under 7 is a blocking finding that names the stage that owns it and the exact change. Score honestly: a page with a centred hero, equal cards and fade-up motion is a 4, however clean it is.

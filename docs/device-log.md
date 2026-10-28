# Real-device log

The plan asks for a manual check of APP-02 to APP-08 on an iPhone with Safari and a mid-range Android phone with Chrome. Automated tests cannot stand in for this. Fill in one row per approach, device and release. A failed row is a blocker for that approach's `verified` status in the registry.

How to check:

1. Build a project that uses the approach (the build test's launch site is fine) and serve it on the local network, for example with `npx astro preview --host` in `site/`.
2. On the phone:
   - Scroll the whole page twice.
   - Turn on Reduce Motion (iOS) or Remove animations (Android), reload, and scroll again.
   - Note the mode the page chose. It is in `document.documentElement.dataset`, or append `?forge-fallback=reduced-motion` to see the fallback.
3. Record what you saw. Smoothness is a judgement: a stutter you notice is a fail.

| Date | Approach | Device and OS | Browser | Mode chosen | Full mode smooth (no visible stutter) | Fallback correct | Notes | Checked by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | APP-02 | iPhone (model, iOS version) | Safari | | | | | |
| | APP-02 | Mid-range Android (model, version) | Chrome | | | | | |

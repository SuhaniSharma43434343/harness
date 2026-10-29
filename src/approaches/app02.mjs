import { applyApproach } from './apply.mjs';

// APP-02 Cinematic Scroll (T19): pinned sections, scroll-scrubbed reveals and synced smooth
// scroll with GSAP, ScrollTrigger and Lenis, loaded on demand. Fallback: the same sections as a
// static stacked layout with CSS reveals (data-app02="fallback" on <html>).
export default {
  id: 'APP-02',
  name: 'Cinematic Scroll',
  recipes: 'skills/app02/recipes',
  sections: ['ScrollStory', 'Chapter'],
  packages: [
    { name: 'gsap', version: '3.15.0', licence: "GSAP Standard 'no charge' licence", licenceVerified: false, note: 'Not open source: confirm the terms allow this client site before release (plan: verify terms).' },
    { name: 'lenis', version: '1.3.27', licence: 'MIT', licenceVerified: true, note: 'MIT as listed on npm.' },
  ],
  fallback: { approach: 'APP-01', description: 'Static stacked layout with CSS reveals', triggers: ['reduced-motion', 'low-end-device', 'load-failed', 'slow-network'] },
  // Plan budget: at most 60 KB of extra JavaScript (gzip) over APP-01, no layout shift, CLS at most 0.1.
  budget: { extraJsBytes: 60 * 1024, cls: 0.1 },
  apply(siteDir, opts) {
    return applyApproach(this, siteDir, opts);
  },
};

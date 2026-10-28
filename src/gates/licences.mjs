import { globToRegExp } from '../core/glob.mjs';

// Files a visitor downloads that carry rights: images, video, audio, fonts and 3D models.
const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mov|mp3|ogg|wav|m4a|woff2?|ttf|otf|glb|gltf|hdr|ktx2)$/i;

// Asset licensing: every shipped asset has a row in assets/register.json with a licence and
// evidence; a row whose rights are uncertain blocks B7 (plan). A row's file may be a glob,
// for example "_astro/*.woff2" for Fontsource fonts, which the design decision already licenses.
export default {
  name: 'licences',
  version: '0.1.0',
  thresholds: {},
  run(ctx) {
    const findings = [];
    if (!ctx.hasDist()) return { findings: [{ id: 'no-build', severity: 'critical', message: 'No built site at site/dist' }] };
    const rows = ctx.json('assets/register.json', null)?.assets;
    const shipped = ctx.files().filter((f) => ASSET.test(f));
    if (!rows) {
      findings.push({ id: 'no-register', severity: shipped.length ? 'serious' : 'critical', message: 'No licence register at assets/register.json' });
      return { findings, metrics: { assets: shipped.length, registered: 0 } };
    }
    const matchers = rows.map((r) => ({ row: r, re: globToRegExp(r.file) }));
    let ok = 0;
    for (const file of shipped) {
      const hit = matchers.find((m) => m.re.test(file))?.row;
      if (!hit) {
        findings.push({ id: 'no-licence-record', severity: 'serious', message: `${file} ships with no licence record`, location: file });
      } else if (hit.status === 'uncertain' || !hit.licence || /^unknown$/i.test(hit.licence)) {
        findings.push({ id: 'uncertain-rights', severity: 'serious', message: `${file}: rights are uncertain (${hit.licence || 'no licence'}); this blocks B7`, location: file });
      } else if (!hit.evidence) {
        findings.push({ id: 'no-evidence', severity: 'serious', message: `${file}: the licence record has no evidence`, location: file });
      } else ok++;
    }
    return { findings, metrics: { assets: shipped.length, cleared: ok } };
  },
};

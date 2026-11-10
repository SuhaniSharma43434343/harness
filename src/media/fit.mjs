// Media fit: does this business suit a 3D object, and does it need video? Deterministic and
// explainable, so the operator is told why. It uses the industry playbook's own "extras" ratings,
// the tone, the device floor and the primary action. Pure.

const BASE = { strong: 0.85, possible: 0.6, weak: 0.25 };
const UNRATED = 0.3;

// What to search a 3D library for, by industry. The owner's own words are added on top.
const CONCEPTS = {
  'restaurant-cafe': { label: 'a steaming cup, a teapot or one signature bake', avoid: ['furniture', 'lighting', 'architecture'], terms: ['cup', 'mug', 'tea', 'teapot', 'kettle', 'coffee', 'cake', 'croissant', 'bread', 'pastry', 'bowl'] },
  'real-estate': { label: 'a house, a door or a key', terms: ['house', 'building', 'door', 'key', 'lamp', 'chair', 'sofa', 'table', 'plant'] },
  'healthcare-clinic': { label: 'a plant or a simple medical object', terms: ['plant', 'bottle', 'tooth', 'stethoscope'] },
  'professional-services': { label: 'a desk object', terms: ['book', 'pen', 'lamp', 'globe'] },
  'general-business': { label: 'the one object that stands for the business', terms: [] },
};
const STOP = new Set(['the', 'and', 'for', 'with', 'near', 'that', 'this', 'from', 'your', 'our', 'build', 'website', 'site', 'business', 'company', 'shop', 'store', 'cafe', 'warm', 'cosy']);

const tokens = (text) => String(text ?? '').toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) ?? [];

// The conversion kinds that a big visual object could get in the way of.
const FORMY = /book|order|enquir|call|form|reserve|visit/i;

const WARM = /warm|cosy|cozy|playful|fun|friendly|bold|handmade|quirky/i;

// assessMedia(brief, playbook, opts?) => { threeD, video }
// threeD: { fit (0..1), class ('recommended'|'possible'|'not-recommended'), reasons[], concept, terms[] }
// video:  { need ('none'|'loop'|'clip'), slots[], reasons[] }
export function assessMedia(brief, playbook, { concept } = {}) {
  const extras = new Map((playbook?.extras ?? []).map((e) => [e.id, e]));
  const floor = brief.constraints?.deviceFloor;
  const motion = brief.brand?.motionIntensity ?? 1;
  const tones = (brief.brand?.tone ?? []).join(' ');
  const primary = brief.business?.primaryConversion;

  // 3D
  const reasons3 = [];
  const obj = extras.get('3d-object');
  let relevance = obj ? BASE[obj.fit] : UNRATED;
  if (obj) reasons3.push(`${playbook.name ?? playbook.id}: ${obj.note}`);
  else reasons3.push('Nothing in this kind of business is one recognisable object.');
  const tone = WARM.test(tones) ? 1 : 0.6;
  if (WARM.test(tones)) reasons3.push('The tone is warm or playful, which suits a rounded 3D object.');
  let goal = 1;
  if (primary && FORMY.test(`${primary.id} ${primary.kind}`)) {
    goal = 0.7;
    reasons3.push(`The main action is "${primary.label}", so the object goes below the hero and never in front of that button.`);
  }
  let fit = Math.round(relevance * (0.6 + tone * 0.2 + goal * 0.2) * 100) / 100;
  if (floor === 'low') {
    fit = 0;
    reasons3.push('The device floor is low, and 3D is too heavy for those phones.');
  }
  const klass = fit >= 0.65 ? 'recommended' : fit >= 0.4 ? 'possible' : 'not-recommended';
  const ind = CONCEPTS[playbook?.id] ?? CONCEPTS['general-business'];
  const terms = [...new Set([...(concept ? tokens(concept) : []), ...ind.terms, ...tokens(brief.client?.industry)])];
  const threeD = { fit, class: klass, reasons: reasons3, concept: concept ?? ind.label, terms, avoid: ind.avoid ?? [] };

  // Video
  const reasons = [];
  const loop = extras.get('video-loop');
  let need = 'none';
  const slots = [];
  if (floor === 'low') reasons.push('The device floor is low, so the site uses a still photograph.');
  else if (motion === 0) reasons.push('The brand wants no motion, so the site uses still photographs.');
  else if (loop && loop.fit !== 'weak') {
    need = loop.fit === 'strong' && motion >= 2 ? 'clip' : 'loop';
    reasons.push(`${playbook.name ?? playbook.id}: ${loop.note}`);
    slots.push({ role: 'hero-loop', page: '/', length: '6 to 12 seconds, silent', note: 'Behind a dark scrim so the headline and the main button stay readable.' });
    if (need === 'clip') slots.push({ role: 'story-clip', page: '/our-story', length: 'up to 20 seconds', note: 'A poster that plays when tapped, with the sound off.' });
  } else reasons.push(loop ? `Video helps little here: ${loop.note}` : 'This kind of business gains little from video; photographs and clear text do the work.');
  return { threeD, video: { need, slots, reasons } };
}

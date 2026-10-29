// Brief -> site.json and one Markdown page per brief page. The scaffold only uses text that
// is already in the brief (titles, purposes, calls to action, form fields), so it never
// invents a claim. Each page is marked `status: scaffold` until Content & UX replaces it
// with locked content from content/pages/ after B3.

import { assertValid } from '../core/schemas.mjs';

// Pages whose slug or purpose matches this get the brief's forms.
const FORM_PAGE = /contact|enquir|quote|book|regist|rsvp|volunteer|sign-?up|waitlist|dealer|donat|apply/i;

export const pageFile = (slug) => (slug === '/' ? 'index.md' : `${slug.slice(1)}.md`);

const kebab = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A brief form field ("email", "preferred date", "message") -> an input description.
export function formField(label) {
  const name = kebab(label) || 'field';
  const l = label.toLowerCase();
  let type = 'text';
  let autocomplete;
  if (/e-?mail/.test(l)) (type = 'email'), (autocomplete = 'email');
  else if (/phone|mobile|tel/.test(l)) (type = 'tel'), (autocomplete = 'tel');
  else if (/date|when/.test(l)) type = 'date';
  else if (/message|details|notes|comment|question|about|description/.test(l)) type = 'textarea';
  else if (/^(full )?name$/.test(l)) autocomplete = 'name';
  else if (/website|url|link/.test(l)) (type = 'url'), (autocomplete = 'url');
  const required = /^(full )?name$|e-?mail/.test(l);
  return { name, label: capitalise(label), type, required, ...(autocomplete && { autocomplete }) };
}

function formPage(form, pages) {
  const byId = pages.find((p) => p.slug !== '/' && p.slug.includes(form.id));
  const byHint = pages.find((p) => p.slug !== '/' && FORM_PAGE.test(`${p.slug} ${p.purpose}`));
  return (byId ?? byHint ?? pages[0]).slug;
}

// Pages that show work get a picture grid; sections a page asks for in the brief get their
// empty section, which renders nothing until Content & UX fills it with real items.
const GALLERY = /project|portfolio|gallery|case.?stud|our work|before.and.after|showroom|photo/i;
const ASKED = [
  [/faq|question/i, 'APP-01/Faq'],
  [/testimonial|review|quote from/i, 'APP-01/Testimonials'],
  [/stat|figure|number/i, 'APP-01/Stats'],
  [/step|process|how it works/i, 'APP-01/Steps'],
];

const href = (slug, hash) => (hash ? `${slug === '/' ? '/' : slug}#${hash}` : slug);

export function planSite(brief, { approaches = [] } = {}) {
  assertValid('brief', brief, 'brief');
  const forms = {};
  for (const f of brief.features?.forms ?? []) {
    const page = formPage(f, brief.pages);
    const pageCta = brief.pages.find((p) => p.slug === page).cta;
    forms[f.id] = {
      purpose: f.purpose,
      destination: f.destination,
      action: null,
      page,
      submitLabel: pageCta,
      fields: f.fields.map(formField),
    };
  }
  const firstForm = Object.entries(forms)[0];
  // Every call to action points at the first form, or at the last page when there is no form.
  const target = firstForm ? href(firstForm[1].page, firstForm[0]) : brief.pages.at(-1).slug;

  const site = {
    schemaVersion: '0.1.0',
    name: brief.client.name,
    description: brief.goals[0].statement,
    lang: brief.client.languages?.[0] ?? 'en',
    url: null,
    nav: brief.pages.map((p) => ({ label: p.title, href: p.slug })),
    forms,
    approaches: ['APP-01'],
  };
  assertValid('siteConfig', site, 'site.json');

  const motion = new Set(approaches);
  const pages = brief.pages.map((p, order) => {
    const pageForms = Object.entries(forms).filter(([, f]) => f.page === p.slug);
    const onFormPage = pageForms.length > 0;
    const isHome = p.slug === '/';
    const cta = { label: p.cta, href: onFormPage ? `#${pageForms[0][0]}` : target === p.slug ? '#main' : target };
    const asked = (p.sections ?? []).join(' ');
    // The other pages, as cards or story steps: titles and purposes straight from the brief.
    const tour = brief.pages
      .filter((q) => q.slug !== '/' && q.slug !== p.slug)
      .map((q) => ({ title: q.title, text: q.purpose, href: q.slug }));
    const sections = [
      {
        use: 'APP-01/Hero',
        heading: isHome ? brief.client.name : p.title,
        lead: p.purpose,
        ...(isHome && brief.client.industry && { eyebrow: capitalise(brief.client.industry) }),
        ...(onFormPage && { cta: false }),
      },
    ];
    if (isHome && tour.length) {
      sections.push(
        motion.has('APP-02')
          ? { use: 'APP-02/ScrollStory', heading: `Explore ${brief.client.name}`, steps: tour.slice(0, 6) }
          : { use: 'APP-01/Features', heading: `Explore ${brief.client.name}`, items: tour },
      );
    }
    if (isHome && brief.audience?.length) {
      sections.push({ use: 'APP-01/Split', heading: 'Who this is for', items: brief.audience.map((a) => ({ title: a.segment, text: a.need })) });
    }
    sections.push({ use: 'APP-01/Prose' });
    if (GALLERY.test(`${p.slug} ${p.purpose} ${asked}`)) sections.push({ use: 'APP-01/Gallery', heading: p.title });
    for (const [pattern, use] of ASKED) if (pattern.test(asked)) sections.push({ use, items: [] });
    sections.push(...pageForms.map(([id, f]) => ({ use: 'APP-01/Form', form: id, heading: f.purpose })));
    if (!isHome && tour.length > 1) sections.push({ use: 'APP-01/Features', heading: 'Explore more', items: tour.filter((t) => t.href !== cta.href.split('#')[0]) });
    if (!onFormPage) {
      sections.push(
        isHome && motion.has('APP-05')
          ? { use: 'APP-05/ShaderBackground', heading: p.cta, text: firstForm?.[1].purpose ?? p.purpose, cta, intensity: Math.min(3, Math.max(1, brief.brand.motionIntensity)) }
          : { use: 'APP-01/CtaBand' },
      );
    }
    const todo = [
      `Content & UX: write this page from the brief, then lock it in content/pages/${pageFile(p.slug)}.`,
      `Purpose: ${p.purpose}`,
      ...(p.sections?.length ? [`Sections asked for: ${p.sections.join(', ')}`] : []),
    ];
    return {
      file: pageFile(p.slug),
      data: { title: p.title, description: p.purpose, order, status: 'scaffold', cta, sections },
      body: `<!--\n${todo.map((t) => t.replaceAll('--', '-')).join('\n')}\n-->\n`,
    };
  });
  return { site, pages };
}

// Minimal YAML writer for frontmatter: strings are double-quoted JSON strings (valid YAML),
// so no value can break the document.
function yaml(value, indent = '') {
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []';
    return value
      .map((item) => {
        const inner = yaml(item, indent + '  ');
        return `\n${indent}- ${inner.replace(/^\n\s*/, '')}`;
      })
      .join('');
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}';
    return entries.map(([k, v]) => `\n${indent}${k}:${yaml(v, indent + '  ')}`).join('');
  }
  return ` ${JSON.stringify(value)}`;
}

export function toMarkdown({ data, body = '' }) {
  return `---${yaml(data)}\n---\n${body}`;
}

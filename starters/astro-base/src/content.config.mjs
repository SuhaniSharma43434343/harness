import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One Markdown file per page in src/content/pages/<slug>.md (index.md is the home page).
// `sections` lists the section components to render, in order, by "<approach>/<Name>",
// which resolves to src/sections/<approach>/<Name>.astro. Extra keys are passed to it as props.
const section = z
  .object({ use: z.string().regex(/^APP-0[1-8]\/[A-Z][A-Za-z0-9]*$/, 'use must look like APP-01/Hero') })
  .passthrough();

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    order: z.number().int().default(100),
    nav: z.boolean().default(true),
    status: z.enum(['scaffold', 'draft', 'locked']).default('draft'),
    cta: z.object({ label: z.string().min(1), href: z.string().min(1) }),
    sections: z.array(section).min(1),
  }),
});

export const collections = { pages };

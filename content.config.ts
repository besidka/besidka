import { defineCollection, defineContentConfig } from '@nuxt/content'
import { z } from 'zod'

/**
 * Nuxt Content collections.
 *
 * `landing` powers the home page (content/index.md), edited visually in Nuxt
 * Studio. ALL structured data lives in the frontmatter so it renders as Studio
 * Page Settings forms:
 *   - hero       – main hero section (feeds the LandingHero component)
 *   - carousel   – product screenshots
 *   - steps      – how-it-works steps
 *   - features   – feature grid items
 *   - testimonials – community quotes
 *   - faqs       – FAQ entries (also emitted as FAQPage JSON-LD)
 *
 * The markdown body is the chat-style conversation built from custom MDC
 * components in `app/components/content/`; those widgets read data from
 * inject('home:data') — no data is passed inline in the body.
 *
 * WARNING: keep this schema in sync with the top-level frontmatter keys in
 * content/index.md. Nuxt Content + Studio on the cloudflare_module preset do
 * NOT migrate the dev content table when fields are added — the persistent
 * D1 emulation keeps the old column set and Studio then errors with
 * "table _content_landing has N columns but M values". After adding or
 * removing a field here, delete the dev content DB and restart so the table
 * is recreated with the new columns:
 *   rm .data/content/contents.sqlite
 * (Do NOT run `pnpm run db:reset` — that resets the app D1, not this one.)
 */
const cta = z.object({
  label: z.string().describe('Button text'),
  href: z.string().describe('Link target — an in-app path (/signup) or a URL'),
})

export default defineContentConfig({
  collections: {
    landing: defineCollection({
      type: 'page',
      source: 'index.md',
      schema: z.object({
        description: z
          .string()
          .describe('SEO meta description and social share text'),
        hero: z
          .object({
            eyebrow: z
              .string()
              .optional()
              .describe('Small uppercase tagline shown above the headline'),
            headline: z.string().describe('Main headline (the page H1)'),
            subheadline: z
              .string()
              .optional()
              .describe('Supporting sentence under the headline'),
            primaryCta: cta.describe('Primary call-to-action button'),
            secondaryCta: cta
              .optional()
              .describe('Secondary call-to-action button'),
          })
          .describe('Hero section'),
        carousel: z
          .array(
            z.object({
              src: z
                .string()
                .describe(
                  'Image path, e.g. /preview-light-desktop.svg',
                ),
              alt: z
                .string()
                .describe('Alt text for accessibility/SEO'),
              caption: z
                .string()
                .optional()
                .describe('Caption shown under the image'),
            }),
          )
          .default([])
          .describe('Product screenshots shown in the carousel'),
        steps: z
          .array(
            z.object({
              icon: z
                .string()
                .describe('Lucide icon name, e.g. lucide:user-plus'),
              title: z.string().describe('Step title'),
              body: z.string().describe('Step description'),
            }),
          )
          .default([])
          .describe('How-it-works steps'),
        features: z
          .array(
            z.object({
              icon: z.string().describe('Lucide icon name'),
              title: z.string().describe('Feature title'),
              body: z.string().describe('Feature description'),
            }),
          )
          .default([])
          .describe('Feature grid items'),
        testimonials: z
          .array(
            z.object({
              quote: z.string().describe('Testimonial quote'),
              author: z.string().describe('Author name or handle'),
              role: z
                .string()
                .optional()
                .describe('Author role or source, e.g. GitHub'),
            }),
          )
          .default([])
          .describe('Community testimonials'),
        faqs: z
          .array(
            z.object({
              question: z.string().describe('Question'),
              answer: z.string().describe('Answer'),
            }),
          )
          .default([])
          .describe(
            'FAQ entries — also emitted as FAQPage structured data',
          ),
      }),
    }),
  },
})

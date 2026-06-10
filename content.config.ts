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
 *   - useCases   – who Besidka is for (replaces the old testimonials key)
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
  icon: z
    .string()
    .optional()
    .describe('Optional icon name, e.g. lucide:arrow-right or streamline-logos:github-logo-2-solid'),
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
        useCases: z
          .array(
            z.object({
              icon: z
                .string()
                .describe('Lucide icon name, e.g. lucide:code-2'),
              persona: z
                .string()
                .describe('Short label for the user type, e.g. Developer'),
              scenario: z
                .string()
                .describe('What this person does with Besidka'),
              payoff: z
                .string()
                .describe('The concrete benefit they get'),
            }),
          )
          .default([])
          .describe('Use-case cards describing who Besidka is for'),
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
        benefits: z
          .array(
            z.object({
              icon: z.string().describe('Lucide icon name'),
              title: z.string().describe('Benefit title'),
              body: z
                .string()
                .describe('Customer-outcome description — what\'s in it for me'),
            }),
          )
          .default([])
          .describe(
            'Customer-outcome benefits — distinct from capability features',
          ),
        comparison: z
          .object({
            caption: z
              .string()
              .optional()
              .describe('Accessible table caption (shown visually below table)'),
            columns: z
              .array(z.string())
              .default([])
              .describe('Column headers: first is Besidka, then competitors'),
            rows: z
              .array(
                z.object({
                  label: z
                    .string()
                    .describe('Row label describing the criterion'),
                  values: z
                    .array(z.string())
                    .default([])
                    .describe(
                      'Cell values matching column order; use ✓ yes / ✗ no'
                      + ' + sr-only text via the component',
                    ),
                }),
              )
              .default([])
              .describe('Table rows'),
            note: z
              .string()
              .optional()
              .describe('Worked cost example shown below the table'),
            priceDate: z
              .string()
              .optional()
              .describe(
                'As-of date for competitor prices, e.g. "June 2026"',
              ),
          })
          .optional()
          .describe('Competitor comparison table data'),
        video: z
          .object({
            src: z
              .string()
              .optional()
              .describe(
                'Default video URL, e.g. /videos/demo.mp4 from CMS_BUCKET',
              ),
            poster: z
              .string()
              .optional()
              .describe('Poster image URL shown before the video plays'),
            caption: z
              .string()
              .optional()
              .describe('Short caption displayed below the video player'),
            qualities: z
              .array(
                z.object({
                  src: z
                    .string()
                    .describe('Resolution URL, e.g. /videos/demo-720.mp4'),
                  size: z
                    .number()
                    .describe('Frame height in px, e.g. 720 (quality key)'),
                  label: z
                    .string()
                    .optional()
                    .describe('Optional label; defaults to "${size}p"'),
                }),
              )
              .default([])
              .describe('Selectable resolutions for the quality menu'),
            captions: z
              .array(
                z.object({
                  src: z
                    .string()
                    .describe('WebVTT URL, e.g. /videos/demo.en.vtt'),
                  label: z
                    .string()
                    .describe('Menu label, e.g. "English"'),
                  srclang: z
                    .string()
                    .describe('BCP 47 language tag, e.g. "en"'),
                  default: z
                    .boolean()
                    .optional()
                    .describe('Active by default when true'),
                }),
              )
              .default([])
              .describe('WebVTT caption tracks'),
            markers: z
              .array(
                z.object({
                  time: z
                    .string()
                    .describe('Timecode "m:ss"/"mm:ss"/"h:mm:ss", e.g. 0:12'),
                  label: z
                    .string()
                    .describe('Chapter label shown on hover, e.g. "Projects"'),
                }),
              )
              .default([])
              .describe('Chapter markers rendered on the progress bar'),
            thumbnails: z
              .boolean()
              .optional()
              .describe(
                'Generate hover preview thumbnails on the client'
                + ' via mediabunny (default true)',
              ),
          })
          .optional()
          .describe('Demo video shown in the how-it-works section'),
      }),
    }),
  },
})

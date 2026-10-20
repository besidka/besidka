import { z } from 'zod'
import { providerMeta } from './provider-meta'

const HTTPS_ONLY_MESSAGE = 'Must be an https:// URL'
const SITE_RELATIVE_OR_HTTPS_MESSAGE
  = 'Must be a site-relative path starting with a single / or an https:// URL'

const keyGuideProviderIds = Object.keys(providerMeta) as [
  string,
  ...string[],
]

export const httpsUrl = z.url({
  protocol: /^https$/,
  message: HTTPS_ONLY_MESSAGE,
})

export const siteRelativeOrHttpsUrl = z
  .string()
  .refine((value) => {
    return /^\/(?![/\\])/.test(value) || httpsUrl.safeParse(value).success
  }, { message: SITE_RELATIVE_OR_HTTPS_MESSAGE })

const sourceLink = z.object({
  label: z.string().describe('Link text, e.g. Pricing page'),
  url: httpsUrl.describe('Official source URL'),
})

/**
 * Frontmatter of a public key guide (content/key-guides/*.md). Shared by the
 * keyGuides collection in content.config.ts and the content unit test, so the
 * test validates the exact schema Nuxt Content enforces.
 */
export const keyGuideSchema = z.object({
  provider: z
    .enum(keyGuideProviderIds)
    .describe(
      'Provider id from shared/utils/provider-meta, e.g. google or'
      + ' openrouter. Drives the "Add your key" deep link and the guide shown'
      + ' on that provider\'s card on /profile/keys.',
    ),
  description: z
    .string()
    .describe('SEO meta description and social share text'),
  summary: z
    .string()
    .optional()
    .describe('One line shown above the steps'),
  updatedAt: z
    .string()
    .describe(
      'ISO date this guide last changed, e.g. 2026-10-20. Shown to'
      + ' users, emitted as dateModified and used as the sitemap'
      + ' lastmod.',
    ),
  checkedAt: z
    .string()
    .describe(
      'ISO date the third-party facts below were last verified against'
      + ' the provider. Shown to users next to the sources.',
    ),
  keyUrl: httpsUrl
    .describe('Official page where the user creates the API key'),
  keyUrlLabel: z
    .string()
    .optional()
    .describe(
      'Full button text for the key page link, e.g.'
      + ' "Open Google AI Studio keys page"',
    ),
  requirements: z
    .object({
      card: z
        .boolean()
        .describe('Whether the provider requires a payment card to start'),
      cardNote: z
        .string()
        .optional()
        .describe(
          'Plain-language card requirement shown instead of'
          + ' Required / Not required, e.g. "Only to buy credits."',
        ),
      minimumTopUp: z
        .string()
        .optional()
        .describe('Smallest prepaid top-up, e.g. $5'),
      freeTier: z
        .string()
        .optional()
        .describe('Short description of the free tier, if any'),
      sources: z
        .array(sourceLink)
        .default([])
        .describe('Official pages that back these facts'),
    })
    .describe('Facts a reader needs before creating the key'),
  video: z
    .object({
      src: siteRelativeOrHttpsUrl
        .describe('Video URL, e.g. /videos/key-guide-google.mp4'),
      poster: siteRelativeOrHttpsUrl
        .describe('Poster image URL, also used as the schema thumbnail'),
      duration: z
        .string()
        .regex(/^PT(\d+H)?(\d+M)?(\d+S)?$/, 'Must be an ISO 8601 duration')
        .describe('ISO 8601 duration, e.g. PT1M12S'),
      uploadDate: z
        .string()
        .describe('ISO date the video was published, e.g. 2026-10-20'),
      caption: z
        .string()
        .optional()
        .describe('Short caption displayed below the video player'),
      alt: z
        .string()
        .optional()
        .describe(
          'Text description of what the video shows, used as the accessible'
          + ' label of the poster and player',
        ),
      captions: z
        .array(
          z.object({
            src: siteRelativeOrHttpsUrl
              .describe('WebVTT URL, e.g. /videos/key.en.vtt'),
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
    })
    .optional()
    .describe(
      'Walkthrough video. Omit it entirely until a real video exists:'
      + ' VideoObject structured data is only emitted when it is set.',
    ),
})

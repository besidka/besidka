import { minimarkToMarkdown } from '~~/server/utils/content/minimark'
import type {
  ComponentRenderers,
  MinimarkBody,
} from '~~/server/utils/content/minimark'

export type PublicPageCollection = 'guides' | 'legal'

export interface PublicPageDefinition {
  collection: PublicPageCollection
  contentPath: string
  route: string
}

export interface PublicPageRecord {
  title: string
  description: string
  updatedAt: string
  summary?: string
  body: MinimarkBody
}

export const publicPages = {
  'byok': {
    collection: 'guides',
    contentPath: '/guides/byok',
    route: '/byok',
  },
  'memory': {
    collection: 'guides',
    contentPath: '/guides/memory',
    route: '/memory',
  },
  'privacy-policy': {
    collection: 'legal',
    contentPath: '/legal/privacy-policy',
    route: '/privacy-policy',
  },
  'terms-of-use': {
    collection: 'legal',
    contentPath: '/legal/terms-of-use',
    route: '/terms-of-use',
  },
  'cookie-policy': {
    collection: 'legal',
    contentPath: '/legal/cookie-policy',
    route: '/cookie-policy',
  },
} as const satisfies Record<string, PublicPageDefinition>

export type PublicPageSlug = keyof typeof publicPages

export const publicPageSlugs = Object.keys(publicPages) as [
  PublicPageSlug,
  ...PublicPageSlug[],
]

export function createPageComponentRenderers(
  privacyEmail: string,
): ComponentRenderers {
  return {
    'privacy-email-link': () => {
      return privacyEmail
    },
  }
}

export function formatPublicPage(
  slug: PublicPageSlug,
  page: PublicPageRecord,
  siteOrigin: string,
  components: ComponentRenderers,
) {
  return {
    slug,
    title: page.title,
    url: `${siteOrigin}${publicPages[slug].route}`,
    description: page.description,
    updatedAt: page.updatedAt,
    summary: page.summary ?? undefined,
    markdown: minimarkToMarkdown(page.body, { components }),
  }
}

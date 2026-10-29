import type { H3Event } from 'h3'
import { queryCollection } from '@nuxt/content/server'
import type { KeyGuideIndexEntry } from '~~/server/utils/mcp/key-guides'
import { publicPages } from '~~/server/utils/mcp/pages'
import type {
  PublicPageRecord,
  PublicPageSlug,
} from '~~/server/utils/mcp/pages'

export const MCP_CONTENT_CACHE_MAX_AGE_SECONDS = 3600

const sharedCacheOptions = {
  group: 'mcp',
  maxAge: MCP_CONTENT_CACHE_MAX_AGE_SECONDS,
  swr: false,
  shouldBypassCache: () => {
    return import.meta.dev
  },
}

export const keyGuideIndexCacheOptions = {
  ...sharedCacheOptions,
  name: 'mcp-key-guide-index',
  getKey: () => {
    return 'all'
  },
}

export const publicPageCacheOptions = {
  ...sharedCacheOptions,
  name: 'mcp-public-page',
  getKey: (_event: H3Event, slug: PublicPageSlug) => {
    return slug
  },
  validate: (entry: { value?: unknown }) => {
    return Boolean(entry.value)
  },
}

export const getKeyGuideIndex = defineCachedFunction(
  async (event: H3Event): Promise<KeyGuideIndexEntry[]> => {
    return await queryCollection(event, 'keyGuides')
      .select('path', 'provider', 'title')
      .all()
  },
  keyGuideIndexCacheOptions,
)

export const getPublicPageRecord = defineCachedFunction(
  async (
    event: H3Event,
    slug: PublicPageSlug,
  ): Promise<PublicPageRecord | null> => {
    const { collection, contentPath } = publicPages[slug]

    if (collection === 'legal') {
      return await queryCollection(event, 'legal').path(contentPath).first()
    }

    return await queryCollection(event, 'guides').path(contentPath).first()
  },
  publicPageCacheOptions,
)

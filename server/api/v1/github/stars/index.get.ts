import { useLogger } from 'evlog'
import { fetchGithubStars } from '~~/server/utils/landing/github-stars'
import { CACHE_TTL_DAY } from '~~/server/utils/cache-or-fetch'

/**
 * GET /api/v1/github/stars
 *
 * Returns GitHub repository stats for besidka/besidka, served from KV cache
 * with a 24h TTL. Unauthenticated; falls back to zeroed values on failure.
 *
 * Response shape:
 * {
 *   repo: string        // 'besidka/besidka'
 *   stars: number
 *   forks: number
 *   watchers: number
 *   htmlUrl: string
 *   updatedAt: string   // ISO8601 — when GitHub was last queried
 *   source: 'cache' | 'fresh' | 'fallback'
 * }
 */
export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  logger.set({ endpoint: 'github-stars' })

  const GITHUB_STARS_FALLBACK = {
    repo: 'besidka/besidka',
    stars: 0,
    forks: 0,
    watchers: 0,
    htmlUrl: 'https://github.com/besidka/besidka',
    updatedAt: new Date(0).toISOString(),
  }

  const result = await cacheOrFetch({
    key: 'landing:github-stars:v1',
    ttlSeconds: CACHE_TTL_DAY,
    fetcher: () => fetchGithubStars('besidka/besidka'),
    fallback: GITHUB_STARS_FALLBACK,
  })

  logger.set({
    githubStars: {
      source: result.source,
      updatedAt: result.updatedAt,
    },
  })

  setResponseHeaders(event, {
    'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
  })

  return {
    ...result.value,
    source: result.source,
    updatedAt: result.updatedAt,
  }
})

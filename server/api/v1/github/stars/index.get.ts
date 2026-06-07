import { useLogger } from 'evlog'
import { cachedGithubStars } from '~~/server/utils/landing/github-stars'

/**
 * GET /api/v1/github/stars
 *
 * Returns GitHub repository stats for besidka/besidka, served from the Nitro
 * cache (KV in production) with a 1h TTL and SWR up to 24h.
 * Unauthenticated; falls back to zeroed values on failure.
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
    source: 'fallback' as const,
  }

  let result: Awaited<ReturnType<typeof cachedGithubStars>> & {
    source: string
  }

  try {
    const data = await cachedGithubStars('besidka/besidka')

    result = { ...data, source: 'cache' }
  } catch {
    result = GITHUB_STARS_FALLBACK
  }

  logger.set({
    githubStars: {
      source: result.source,
      updatedAt: result.updatedAt,
    },
  })

  setResponseHeaders(event, {
    'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
  })

  return result
})

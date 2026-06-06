import { useLogger } from 'evlog'
import { readStatsFromDb } from '~~/server/utils/landing/stats'
import { CACHE_TTL_DAY } from '~~/server/utils/cache-or-fetch'

/**
 * GET /api/v1/stats
 *
 * Returns aggregate platform statistics, served from KV cache with a 24h TTL.
 *
 * Response shape:
 * {
 *   users: number
 *   chats: number
 *   messages: number
 *   files: number
 *   updatedAt: string   // ISO8601 — when the D1 counts were last fetched
 *   source: 'cache' | 'fresh' | 'fallback'
 * }
 */
export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  logger.set({ endpoint: 'stats' })

  const STATS_FALLBACK = {
    users: 0,
    chats: 0,
    messages: 0,
    files: 0,
    updatedAt: new Date(0).toISOString(),
  }

  const result = await cacheOrFetch({
    key: 'landing:stats:v1',
    ttlSeconds: CACHE_TTL_DAY,
    fetcher: readStatsFromDb,
    fallback: STATS_FALLBACK,
  })

  logger.set({
    stats: {
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

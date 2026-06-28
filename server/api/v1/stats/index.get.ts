import { useLogger } from 'evlog'
import { cachedStats } from '~~/server/utils/landing/stats'

/**
 * GET /api/v1/stats
 *
 * Returns aggregate platform statistics, served from the Nitro cache (KV in
 * production) with a 24h TTL and SWR up to 24h.
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
    source: 'fallback' as const,
  }

  let result: Awaited<ReturnType<typeof cachedStats>> & { source: string }

  try {
    const data = await cachedStats(event)

    result = { ...data, source: 'cache' }
  } catch {
    result = STATS_FALLBACK
  }

  logger.set({
    stats: {
      source: result.source,
      updatedAt: result.updatedAt,
    },
  })

  setResponseHeaders(event, {
    'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
  })

  return result
})

import { cachedStats } from '~~/server/utils/landing/stats'
import { defineEventHandler } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

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
 *   uploadedFiles: number
 *   generatedImages: number
 *   sharedChats: number
 *   researches: number  // completed deep research jobs
 *   updatedAt: string   // ISO8601 — when the D1 counts were last fetched
 *   source: 'cache' | 'fresh' | 'fallback'
 * }
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  logger.set({ endpoint: 'stats' })

  const STATS_FALLBACK = {
    users: 0,
    chats: 0,
    messages: 0,
    files: 0,
    uploadedFiles: 0,
    generatedImages: 0,
    sharedChats: 0,
    researches: 0,
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
      files: result.files,
      uploadedFiles: result.uploadedFiles,
      generatedImages: result.generatedImages,
    },
  })

  event.res.headers.set(
    'cache-control',
    'public, max-age=300, stale-while-revalidate=86400',
  )

  return result
})

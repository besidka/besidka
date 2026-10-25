import { defineEventHandler } from 'nuxt/server'
import type { MemoryBackfillCancelResponse } from '#shared/types/memory-backfill.d'
import { cancelBackfill } from '~~/server/utils/memory/backfill'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * POST /memory/backfill/cancel
 *
 * Cancels the caller's running backfill. Idempotent: with nothing running it
 * changes nothing and answers with the latest job. Chats the job has not
 * reached yet are never processed; entries already written stay.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const job = await cancelBackfill({ userId, db: useDb() })

  logger.set({
    userId,
    attributes: {
      memoryBackfill: {
        phase: 'cancel',
        jobId: job?.id ?? null,
        status: job?.status ?? null,
      },
    },
  })

  const response: MemoryBackfillCancelResponse = { job }

  return response
})

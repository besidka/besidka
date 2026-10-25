import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import type { MemoryBackfillJobResponse } from '#shared/types/memory-backfill.d'
import {
  advanceBackfill,
  claimBackfillCooldown,
  findRunningBackfill,
} from '~~/server/utils/memory/backfill'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * POST /memory/backfill/step
 *
 * Drives one bounded batch of the caller's running backfill inline, which is
 * how previews (no crons) make progress when the UI calls it repeatedly. It
 * never starts a job: with none running it answers 409. A per-user cooldown
 * answers 429 between steps. The step is request-bound, so each chat's model
 * call gets a timeout shorter than the cron path's. Counts only.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const running = await findRunningBackfill(userId, db)

  if (!running) {
    throw createError({
      message: 'No running backfill',
      status: 409,
      why: 'There is no backfill to advance.',
      fix: 'Start a backfill first.',
    })
  }

  await claimBackfillCooldown({ userId, action: 'drive' })

  const step = await advanceBackfill({
    job: running,
    chatsLimit: MEMORY_EXTRACTION_LIMITS.backfillChatsPerStep,
    deadlineMs: MEMORY_EXTRACTION_LIMITS.backfillStepDeadlineMs,
    isInteractive: true,
    db,
    logger,
  })

  logger.set({
    userId,
    attributes: {
      memoryBackfill: {
        phase: 'drive',
        jobId: running.id,
        chatsProcessed: step.chatsProcessed,
        isBusy: step.isBusy,
      },
    },
  })

  if (!step.job) {
    throw createError({
      message: 'Backfill not found',
      status: 404,
    })
  }

  const response: MemoryBackfillJobResponse = { job: step.job }

  return response
})

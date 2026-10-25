import { defineEventHandler } from 'nuxt/server'
import type {
  MemoryBackfillOverview,
  MemoryBackfillUnavailableReason,
} from '#shared/types/memory-backfill.d'
import { getBackfillEstimate } from '~~/server/utils/memory/backfill-estimate'
import {
  getBackfillProgress,
  readBackfillGate,
} from '~~/server/utils/memory/backfill'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * GET /memory/backfill
 *
 * The caller's latest backfill job (running, or the last finished one). While
 * no job is running it also carries an approximate estimate of what a new run
 * would cost, computed with a dry-run model resolution, or the reason none
 * can be given (the estimate is cached per user for ten minutes, and a
 * failing estimate answers `estimate-failed`, never an error). Counts only;
 * never any chat text.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const job = await getBackfillProgress({ userId, db })
  const response: MemoryBackfillOverview = {
    job,
    estimate: null,
    reason: null,
  }

  applyResponseHeaders(event, { 'Cache-Control': 'no-store' })

  if (job?.status === 'running') {
    return response
  }

  const gateReason: MemoryBackfillUnavailableReason | null
    = await readBackfillGate(userId, db)

  if (gateReason) {
    response.reason = gateReason

    return response
  }

  const selection = await resolveMemoryModel({
    userId,
    scope: 'profile',
    db,
    logger,
  })

  if (!selection) {
    response.reason = 'no-model'

    return response
  }

  try {
    response.estimate = await getBackfillEstimate({
      userId,
      selection,
      db,
    })
  } catch (exception) {
    response.reason = 'estimate-failed'
    logger.set({
      userId,
      attributes: {
        memoryBackfill: {
          phase: 'estimate',
          error: memoryExtractionErrorSummary(exception),
        },
      },
    })

    return response
  }

  logger.set({
    userId,
    attributes: {
      memoryBackfill: {
        phase: 'estimate',
        chats: response.estimate.chats,
        inputTokens: response.estimate.inputTokens,
        outputTokens: response.estimate.outputTokens,
      },
    },
  })

  return response
})

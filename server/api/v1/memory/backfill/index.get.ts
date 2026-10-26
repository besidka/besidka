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
import { resolveBackfillWindow } from '~~/server/utils/memory/backfill-queue'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { resolveMemoryModel } from '~~/server/utils/memory/resolve-model'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * GET /memory/backfill
 *
 * The caller's latest backfill job (running, or the last finished one). While
 * no job is running it also carries an approximate estimate of what the next
 * run would cost (a fresh run, or the continuation of a run that stopped at
 * its chat cap, see `resolveBackfillWindow`), computed with a dry-run model
 * resolution, or the reason none can be given: `all-chats-read` once the last
 * run read every past chat, `estimate-failed` when the estimate throws (never
 * an error). The estimate is cached per user for ten minutes. Counts only;
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

  const window = await resolveBackfillWindow(db, userId, new Date())

  if (!window) {
    response.reason = 'all-chats-read'

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
      window,
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

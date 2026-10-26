import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import type { MemoryBackfillJobResponse } from '#shared/types/memory-backfill.d'
import {
  claimBackfillCooldown,
  findRunningBackfill,
  startBackfill,
} from '~~/server/utils/memory/backfill'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

/**
 * POST /memory/backfill
 *
 * Starts a backfill of the caller's past account chats and answers with its
 * progress and estimate. It only ever starts: with a job already running it
 * answers 409 (progress is made by `POST /memory/backfill/step`, which never
 * starts one). A short per-user cooldown bounds repeated start attempts.
 * Needs memory and automatic memory updates on, and a usable memory model
 * (409 otherwise). Counts only.
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

  await requireLegalConsent(userId)

  if (await findRunningBackfill(userId, db)) {
    throw createError({
      message: 'A backfill is already running',
      status: 409,
      why: 'Only one backfill can run per account at a time.',
      fix: 'Wait for it to finish or cancel it first.',
    })
  }

  await claimBackfillCooldown({ userId, action: 'start' })

  const response: MemoryBackfillJobResponse = {
    job: await startBackfill({ userId, db, logger }),
  }

  return response
})

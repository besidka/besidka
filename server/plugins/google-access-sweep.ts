import { createRequestLogger } from 'evlog'
import type { R2Bucket } from '@cloudflare/workers-types'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepGoogleAccessEnded } from '~~/server/utils/google/access-ended'

const GOOGLE_ACCESS_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunGoogleAccessSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
  storage?: Pick<R2Bucket, 'delete'>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== GOOGLE_ACCESS_SWEEP_CRON) {
      return
    }

    await runGoogleAccessSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * The hourly backup for Google access that ended without a finished
 * cleanup (docs/google.md, "What is deleted, and when"): clears tokens
 * left on rows that are not active, deletes the Google copies of users
 * with no active connection and removes `revoked` rows with nothing left
 * to clean. No feature flag on purpose: deletion when access ends must run
 * even after the flag is turned off.
 */
export async function runGoogleAccessSweepJob(
  input: RunGoogleAccessSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/google-access-sweep',
    requestId: `google-access-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const result = await sweepGoogleAccessEnded({
      db: input.db || useDb(),
      storage: input.storage,
      logger,
    })

    logger.set({
      attributes: {
        googleAccessSweep: { cron: input.controller.cron, ...result },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        googleAccessSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

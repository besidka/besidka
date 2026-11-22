import { createRequestLogger } from 'evlog'
import type { KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepGoogleAccessEnded } from '~~/server/utils/google/access-ended'
import type { GoogleFetchOptions } from '~~/server/utils/google/http'
import { validateStaleGoogleConnections } from '~~/server/utils/google/tokens'

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
  kv?: KVNamespace
  storage?: Pick<R2Bucket, 'delete'>
  fetchOptions?: GoogleFetchOptions
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
 * cleanup (docs/google.md, section 9.6): first refreshes up to ten active
 * connections idle for more than a day, so a revoke made at Google is
 * detected and ends access through the normal `invalid_grant` path, then
 * clears tokens left on rows that are not active, deletes the Google copies
 * of users with no active connection within its file and time budget, and
 * removes `revoked` rows with nothing left to clean. No feature flag on
 * purpose: deletion when access ends must run even after the flag is off.
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
    const db = input.db || useDb()
    const kv = input.kv || useKV()
    const now = () => Date.now()
    const validation = await validateStaleGoogleConnections({
      db,
      kv,
      logger,
      storage: input.storage,
      fetchOptions: input.fetchOptions,
      now,
    })
    const result = await sweepGoogleAccessEnded({
      db,
      kv,
      storage: input.storage,
      logger,
      now,
    })

    logger.set({
      attributes: {
        googleAccessSweep: {
          cron: input.controller.cron,
          ...result,
          staleChecked: validation.checked,
          staleEnded: validation.ended,
          staleFailed: validation.failed,
        },
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

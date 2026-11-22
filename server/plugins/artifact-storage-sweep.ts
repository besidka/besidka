import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepViewerArtifactStorage } from '~~/server/utils/artifacts/viewer-storage-retention'

const ARTIFACT_STORAGE_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunArtifactStorageSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== ARTIFACT_STORAGE_SWEEP_CRON) {
      return
    }

    await runArtifactStorageSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Purges saved progress of non-owner viewers on the hourly cron. Like the
 * report sweep it has no feature flag: the retention promise holds whether
 * or not artifact storage is enabled.
 */
export async function runArtifactStorageSweepJob(
  input: RunArtifactStorageSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/artifact-storage-sweep',
    requestId: `artifact-storage-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const deleted = await sweepViewerArtifactStorage({
      db: input.db || useDb(),
      now: new Date(input.controller.scheduledTime),
    })

    logger.set({
      attributes: {
        artifactStorageSweep: { cron: input.controller.cron, deleted },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        artifactStorageSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

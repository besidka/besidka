import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepClosedArtifactReports } from '~~/server/utils/artifacts/report-retention'

const ARTIFACT_REPORT_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunArtifactReportSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== ARTIFACT_REPORT_SWEEP_CRON) {
      return
    }

    await runArtifactReportSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Enforces the retention of closed artifact reports on the hourly cron. It
 * has no feature flag on purpose: the retention promise holds whether or not
 * artifacts are enabled.
 */
export async function runArtifactReportSweepJob(
  input: RunArtifactReportSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/artifact-report-sweep',
    requestId: `artifact-report-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const deleted = await sweepClosedArtifactReports({
      db: input.db || useDb(),
      now: new Date(input.controller.scheduledTime),
    })

    logger.set({
      attributes: {
        artifactReportSweep: { cron: input.controller.cron, deleted },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        artifactReportSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

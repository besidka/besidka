import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepLegalNotices } from '~~/server/utils/legal/notice-sweep'

const LEGAL_NOTICE_SWEEP_CRON = '*/5 * * * *'

const ALERTING_STOP_REASONS: ReadonlySet<string> = new Set([
  'error',
  'consecutive-failures',
  'email-noop',
])

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface LegalNoticeSweepConfig {
  legalNoticeSweepEnabled: boolean
  legalNoticeSweepBatchSize: number
  legalNoticeSweepMaxRuntimeMs: number
  legalNoticeDailyCap: number
  privacyEmail: string
}

interface RunLegalNoticeSweepJobInput {
  controller: ScheduledControllerLike
  config: LegalNoticeSweepConfig
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  runSweep?: typeof sweepLegalNotices
  isDevelopment?: boolean
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== LEGAL_NOTICE_SWEEP_CRON) {
      return
    }

    const runtimeConfig = useRuntimeConfig()

    await runLegalNoticeSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
      config: {
        legalNoticeSweepEnabled: runtimeConfig.legalNoticeSweepEnabled,
        legalNoticeSweepBatchSize: runtimeConfig.legalNoticeSweepBatchSize,
        legalNoticeSweepMaxRuntimeMs:
          runtimeConfig.legalNoticeSweepMaxRuntimeMs,
        legalNoticeDailyCap: runtimeConfig.legalNoticeDailyCap,
        privacyEmail: String(runtimeConfig.public.privacyEmail ?? ''),
      },
    })
  })
})

export async function runLegalNoticeSweepJob(
  input: RunLegalNoticeSweepJobInput,
): Promise<void> {
  const isDevelopment = input.isDevelopment ?? import.meta.dev

  if (!input.config.legalNoticeSweepEnabled || isDevelopment) {
    return
  }

  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepLegalNotices
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/legal-notice-sweep',
    requestId: `legal-notice-sweep-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    attributes: {
      legalNoticeSweepJob: {
        job: 'legal-notice-sweep',
        cron: input.controller.cron,
        scheduledTime,
        batchSize: input.config.legalNoticeSweepBatchSize,
        maxRuntimeMs: input.config.legalNoticeSweepMaxRuntimeMs,
        dailyCap: input.config.legalNoticeDailyCap,
      },
    },
  })

  try {
    const result = await runSweep({
      batchSize: input.config.legalNoticeSweepBatchSize,
      maxRuntimeMs: input.config.legalNoticeSweepMaxRuntimeMs,
      dailyCap: input.config.legalNoticeDailyCap,
      privacyEmail: input.config.privacyEmail,
      logger,
    })

    logger.set({
      attributes: {
        legalNoticeSweepResult: {
          selectedCount: result.selectedCount,
          sentCount: result.sentCount,
          skippedCount: result.skippedCount,
          failedCount: result.failedCount,
          lateDeliveries: result.lateDeliveries,
          claimMissedCount: result.claimMissedCount,
          userDeletedCount: result.userDeletedCount,
          errorCodes: result.errorCodes,
          notices: result.notices,
          stopReason: result.stopReason,
          runtimeMs: result.runtimeMs,
        },
      },
    })

    if (ALERTING_STOP_REASONS.has(result.stopReason)) {
      status = 500
    }
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        legalNoticeSweepError: {
          phase: 'sweep-run',
          message: exceptionMessage(exception),
        },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

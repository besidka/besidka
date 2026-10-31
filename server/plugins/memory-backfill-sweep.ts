import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { sweepBackfillJobs } from '~~/server/utils/memory/backfill'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'

const MEMORY_BACKFILL_SWEEP_CRON = '* * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface MemoryBackfillSweepConfig {
  memoryBackfillSweepEnabled: boolean
  memoryBackfillSweepMaxRuntimeMs: number
}

interface RunMemoryBackfillSweepJobInput {
  controller: ScheduledControllerLike
  config: MemoryBackfillSweepConfig
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  runSweep?: typeof sweepBackfillJobs
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== MEMORY_BACKFILL_SWEEP_CRON) {
      return
    }

    const runtimeConfig = useRuntimeConfig()

    await runMemoryBackfillSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
      config: {
        memoryBackfillSweepEnabled: runtimeConfig.memoryBackfillSweepEnabled,
        memoryBackfillSweepMaxRuntimeMs:
          runtimeConfig.memoryBackfillSweepMaxRuntimeMs,
      },
    })
  })
})

export async function runMemoryBackfillSweepJob(
  input: RunMemoryBackfillSweepJobInput,
): Promise<void> {
  if (!input.config.memoryBackfillSweepEnabled) {
    return
  }

  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepBackfillJobs
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/memory-backfill-sweep',
    requestId: `memory-backfill-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200
  let isIdleRun = false

  logger.set({
    attributes: {
      memoryBackfillSweepJob: {
        job: 'memory-backfill-sweep',
        cron: input.controller.cron,
        scheduledTime: new Date(input.controller.scheduledTime).toISOString(),
        maxRuntimeMs: input.config.memoryBackfillSweepMaxRuntimeMs,
      },
    },
  })

  try {
    const startedAt = Date.now()
    const result = await runSweep({
      maxRuntimeMs: input.config.memoryBackfillSweepMaxRuntimeMs,
      logger,
    })

    isIdleRun = result.jobs === 0 && result.chats === 0 && result.failed === 0

    logger.set({
      attributes: {
        memoryBackfillSweep: {
          ...result,
          runtimeMs: Date.now() - startedAt,
        },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        memoryBackfillSweepError: {
          phase: 'sweep-run',
          ...memoryExtractionErrorSummary(exception),
        },
      },
    })
  }

  if (isIdleRun) {
    return
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

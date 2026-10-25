import { createRequestLogger } from 'evlog'
import { memoryExtractionErrorSummary } from '~~/server/utils/memory/extract-error'
import { sweepMemoryExtraction } from '~~/server/utils/memory/extract-sweep'

const MEMORY_EXTRACTION_SWEEP_CRON = '*/5 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface MemoryExtractionSweepConfig {
  memoryExtractionSweepEnabled: boolean
  memoryExtractionSweepBatchSize: number
  memoryExtractionSweepMaxRuntimeMs: number
}

interface RunMemoryExtractionSweepJobInput {
  controller: ScheduledControllerLike
  config: MemoryExtractionSweepConfig
  waitUntil?: (promise: Promise<unknown>) => void
  createLogger?: typeof createRequestLogger
  runSweep?: typeof sweepMemoryExtraction
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook(
    'cloudflare:scheduled',
    async ({ controller, context }) => {
      if (controller.cron !== MEMORY_EXTRACTION_SWEEP_CRON) {
        return
      }

      const runtimeConfig = useRuntimeConfig()

      await runMemoryExtractionSweepJob({
        controller: {
          cron: controller.cron,
          scheduledTime: controller.scheduledTime,
        },
        config: {
          memoryExtractionSweepEnabled:
            runtimeConfig.memoryExtractionSweepEnabled,
          memoryExtractionSweepBatchSize:
            runtimeConfig.memoryExtractionSweepBatchSize,
          memoryExtractionSweepMaxRuntimeMs:
            runtimeConfig.memoryExtractionSweepMaxRuntimeMs,
        },
        waitUntil: context.waitUntil.bind(context),
      })
    },
  )
})

export async function runMemoryExtractionSweepJob(
  input: RunMemoryExtractionSweepJobInput,
): Promise<void> {
  if (!input.config.memoryExtractionSweepEnabled) {
    return
  }

  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepMemoryExtraction
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/memory-extraction-sweep',
    requestId: `memory-extraction-sweep-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    memoryExtractionSweepJob: {
      job: 'memory-extraction-sweep',
      cron: input.controller.cron,
      scheduledTime,
      batchSize: input.config.memoryExtractionSweepBatchSize,
      maxRuntimeMs: input.config.memoryExtractionSweepMaxRuntimeMs,
    },
  })

  try {
    const result = await runSweep({
      batchSize: input.config.memoryExtractionSweepBatchSize,
      maxRuntimeMs: input.config.memoryExtractionSweepMaxRuntimeMs,
      logger,
    })

    logger.set({
      memoryExtractionSweepResult: {
        selectedCount: result.selectedCount,
        extractedCount: result.extractedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        erroredCount: result.erroredCount,
        leasedCount: result.leasedCount,
        runtimeMs: result.runtimeMs,
        opsApplied: result.opsApplied,
        opsDropped: result.opsDropped,
        models: result.models,
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      memoryExtractionSweepError: {
        phase: 'sweep-run',
      },
      attributes: {
        memoryExtractionSweepError: memoryExtractionErrorSummary(exception),
      },
    })
  }

  logger.emit({ status })
}

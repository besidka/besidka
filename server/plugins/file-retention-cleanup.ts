import { createRequestLogger } from 'evlog'
import { cleanupExpiredFiles } from '~~/server/utils/files/cleanup-expired-files'

const ERROR_STACK_MAX_LENGTH = 2000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RetentionCleanupConfig {
  filesRetentionCleanupEnabled: boolean
  filesRetentionCleanupBatchSize: number
  filesRetentionCleanupMaxRuntimeMs: number
}

interface RunFileRetentionCleanupJobInput {
  controller: ScheduledControllerLike
  config: RetentionCleanupConfig
  createLogger?: typeof createRequestLogger
  runCleanup?: typeof cleanupExpiredFiles
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    const runtimeConfig = useRuntimeConfig()

    await runFileRetentionCleanupJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
      config: {
        filesRetentionCleanupEnabled: runtimeConfig
          .filesRetentionCleanupEnabled,
        filesRetentionCleanupBatchSize: runtimeConfig
          .filesRetentionCleanupBatchSize,
        filesRetentionCleanupMaxRuntimeMs: runtimeConfig
          .filesRetentionCleanupMaxRuntimeMs,
      },
    })
  })
})

export async function runFileRetentionCleanupJob(
  input: RunFileRetentionCleanupJobInput,
): Promise<void> {
  if (!input.config.filesRetentionCleanupEnabled) {
    return
  }

  const batchSize = Math.max(input.config.filesRetentionCleanupBatchSize, 1)
  const maxRuntimeMs = Math.max(
    input.config.filesRetentionCleanupMaxRuntimeMs,
    1000,
  )
  const createLogger = input.createLogger || createRequestLogger
  const runCleanup = input.runCleanup || cleanupExpiredFiles
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/file-retention-cleanup',
    requestId: `file-retention-cleanup-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    retentionCleanupJob: {
      job: 'file-retention-cleanup',
      cron: input.controller.cron,
      scheduledTime,
      batchSize,
      maxRuntimeMs,
    },
  })

  try {
    const result = await runCleanup({
      batchSize,
      maxRuntimeMs,
      logger,
    })

    logger.set({
      retentionCleanupResult: {
        selectedCount: result.selectedCount,
        deletedCount: result.deletedCount,
        failedCount: result.failedCount,
        hasMore: result.hasMore,
        runtimeMs: result.runtimeMs,
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      retentionCleanupError: {
        phase: 'cleanup-run',
        message: exception instanceof Error
          ? exception.message
          : String(exception),
        stack: getSafeErrorStack(exception),
      },
    })
  }

  logger.emit({ status })
}

function getSafeErrorStack(exception: unknown): string | undefined {
  if (!(exception instanceof Error) || !exception.stack) {
    return undefined
  }

  return exception.stack.slice(0, ERROR_STACK_MAX_LENGTH)
}

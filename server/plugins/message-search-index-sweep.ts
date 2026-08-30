import { createRequestLogger } from 'evlog'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepMessageSearchIndex } from '~~/server/utils/search/sweeper'

const ERROR_STACK_MAX_LENGTH = 2000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface MessageSearchSweepConfig {
  messageSearchSweepEnabled: boolean
  messageSearchSweepBatchSize: number
  messageSearchSweepMaxRuntimeMs: number
}

interface RunMessageSearchSweepJobInput {
  controller: ScheduledControllerLike
  config: MessageSearchSweepConfig
  createLogger?: typeof createRequestLogger
  runSweep?: typeof sweepMessageSearchIndex
}

const MESSAGE_SEARCH_SWEEP_CRON = '0 * * * *'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== MESSAGE_SEARCH_SWEEP_CRON) {
      return
    }

    const runtimeConfig = useRuntimeConfig()

    await runMessageSearchSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
      config: {
        messageSearchSweepEnabled: runtimeConfig
          .messageSearchSweepEnabled,
        messageSearchSweepBatchSize: runtimeConfig
          .messageSearchSweepBatchSize,
        messageSearchSweepMaxRuntimeMs: runtimeConfig
          .messageSearchSweepMaxRuntimeMs,
      },
    })
  })
})

export async function runMessageSearchSweepJob(
  input: RunMessageSearchSweepJobInput,
): Promise<void> {
  if (!input.config.messageSearchSweepEnabled) {
    return
  }

  const batchSize = Math.max(input.config.messageSearchSweepBatchSize, 1)
  const maxRuntimeMs = Math.max(
    input.config.messageSearchSweepMaxRuntimeMs,
    1000,
  )
  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepMessageSearchIndex
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/message-search-index-sweep',
    requestId: `message-search-index-sweep-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    messageSearchSweepJob: {
      job: 'message-search-index-sweep',
      cron: input.controller.cron,
      scheduledTime,
      batchSize,
      maxRuntimeMs,
    },
  })

  try {
    const result = await runSweep({
      batchSize,
      maxRuntimeMs,
      logger,
    })

    logger.set({
      messageSearchSweepResult: {
        backfilledCount: result.backfilledCount,
        garbageCollectedCount: result.garbageCollectedCount,
        hasMore: result.hasMore,
        runtimeMs: result.runtimeMs,
        nextCursor: result.nextCursor,
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      messageSearchSweepError: {
        phase: 'sweep-run',
      },
      attributes: {
        messageSearchSweepError: {
          message: exceptionMessage(exception),
          stack: getSafeErrorStack(exception),
        },
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

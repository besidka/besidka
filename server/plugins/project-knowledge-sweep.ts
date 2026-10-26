import { createRequestLogger } from 'evlog'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepProjectKnowledge } from '~~/server/utils/knowledge/sweep'

const ERROR_STACK_MAX_LENGTH = 2000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface ProjectKnowledgeSweepConfig {
  knowledgeSweepEnabled: boolean
  knowledgeSweepBatchSize: number
  knowledgeSweepMaxRuntimeMs: number
}

interface RunProjectKnowledgeSweepJobInput {
  controller: ScheduledControllerLike
  config: ProjectKnowledgeSweepConfig
  createLogger?: typeof createRequestLogger
  runSweep?: typeof sweepProjectKnowledge
}

const PROJECT_KNOWLEDGE_SWEEP_CRON = '0 * * * *'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== PROJECT_KNOWLEDGE_SWEEP_CRON) {
      return
    }

    const runtimeConfig = useRuntimeConfig()

    await runProjectKnowledgeSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
      config: {
        knowledgeSweepEnabled: runtimeConfig.knowledgeSweepEnabled,
        knowledgeSweepBatchSize: runtimeConfig.knowledgeSweepBatchSize,
        knowledgeSweepMaxRuntimeMs: runtimeConfig
          .knowledgeSweepMaxRuntimeMs,
      },
    })
  })
})

export async function runProjectKnowledgeSweepJob(
  input: RunProjectKnowledgeSweepJobInput,
): Promise<void> {
  if (!input.config.knowledgeSweepEnabled) {
    return
  }

  const batchSize = Math.max(input.config.knowledgeSweepBatchSize, 1)
  const maxRuntimeMs = Math.max(
    input.config.knowledgeSweepMaxRuntimeMs,
    1000,
  )
  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepProjectKnowledge
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/project-knowledge-sweep',
    requestId: `project-knowledge-sweep-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    attributes: {
      projectKnowledgeSweepJob: {
        job: 'project-knowledge-sweep',
        cron: input.controller.cron,
        scheduledTime,
        batchSize,
        maxRuntimeMs,
      },
    },
  })

  try {
    const result = await runSweep({
      batchSize,
      maxRuntimeMs,
      logger,
    })

    logger.set({
      attributes: {
        projectKnowledgeSweepResult: {
          pagesScanned: result.pagesScanned,
          scannedCount: result.scannedCount,
          orphanItemObjectsDeleted: result.orphanItemObjectsDeleted,
          orphanProjectObjectsDeleted: result.orphanProjectObjectsDeleted,
          stalePackObjectsDeleted: result.stalePackObjectsDeleted,
          youngSkippedCount: result.youngSkippedCount,
          unrecognizedCount: result.unrecognizedCount,
          failedDeleteCount: result.failedDeleteCount,
          hasMore: result.hasMore,
          runtimeMs: result.runtimeMs,
        },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        projectKnowledgeSweepError: {
          phase: 'sweep-run',
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

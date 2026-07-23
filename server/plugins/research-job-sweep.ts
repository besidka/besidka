import { createRequestLogger } from 'evlog'
import type { VapidKeys } from '~~/server/utils/push'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepResearchJobs } from '~~/server/utils/research/sweep'

const ERROR_STACK_MAX_LENGTH = 2000
const RESEARCH_SWEEP_CRON = '*/5 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface ResearchSweepConfig {
  researchSweepEnabled: boolean
  researchSweepBatchSize: number
  researchSweepMaxRuntimeMs: number
}

interface RunResearchJobSweepJobInput {
  controller: ScheduledControllerLike
  config: ResearchSweepConfig
  vapid: VapidKeys
  waitUntil?: (promise: Promise<unknown>) => void
  createLogger?: typeof createRequestLogger
  runSweep?: typeof sweepResearchJobs
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook(
    'cloudflare:scheduled',
    async ({ controller, context }) => {
      if (controller.cron !== RESEARCH_SWEEP_CRON) {
        return
      }

      const runtimeConfig = useRuntimeConfig()

      await runResearchJobSweepJob({
        controller: {
          cron: controller.cron,
          scheduledTime: controller.scheduledTime,
        },
        config: {
          researchSweepEnabled: runtimeConfig.researchSweepEnabled,
          researchSweepBatchSize: runtimeConfig.researchSweepBatchSize,
          researchSweepMaxRuntimeMs: runtimeConfig.researchSweepMaxRuntimeMs,
        },
        vapid: {
          subject: buildVapidSubject(runtimeConfig.vapidSubject),
          publicKey: runtimeConfig.public.vapidPublicKey || undefined,
          privateKey: runtimeConfig.vapidPrivateKey || undefined,
        },
        waitUntil: context.waitUntil.bind(context),
      })
    },
  )
})

export async function runResearchJobSweepJob(
  input: RunResearchJobSweepJobInput,
): Promise<void> {
  if (!input.config.researchSweepEnabled) {
    return
  }

  const createLogger = input.createLogger || createRequestLogger
  const runSweep = input.runSweep || sweepResearchJobs
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/research-job-sweep',
    requestId: `research-job-sweep-${input.controller.scheduledTime}`,
  })
  const scheduledTime = new Date(input.controller.scheduledTime).toISOString()
  let status = 200

  logger.set({
    researchSweepJob: {
      job: 'research-job-sweep',
      cron: input.controller.cron,
      scheduledTime,
      batchSize: input.config.researchSweepBatchSize,
      maxRuntimeMs: input.config.researchSweepMaxRuntimeMs,
    },
  })

  try {
    const result = await runSweep({
      batchSize: input.config.researchSweepBatchSize,
      maxRuntimeMs: input.config.researchSweepMaxRuntimeMs,
      vapid: input.vapid,
      waitUntil: input.waitUntil,
      logger,
    })

    logger.set({
      researchSweepResult: {
        selectedCount: result.selectedCount,
        finalizedCount: result.finalizedCount,
        stillRunningCount: result.stillRunningCount,
        failedCount: result.failedCount,
        erroredCount: result.erroredCount,
        runtimeMs: result.runtimeMs,
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      researchSweepError: {
        phase: 'sweep-run',
      },
      attributes: {
        researchSweepError: {
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

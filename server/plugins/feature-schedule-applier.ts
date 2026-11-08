import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  createFeatureScheduleNotifier,
} from '~~/server/utils/features/schedule-notify'
import {
  applyDueFeatureSchedules,
} from '~~/server/utils/features/schedules'

const FEATURE_SCHEDULE_APPLIER_CRON = '*/5 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunFeatureScheduleApplierJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  applyDue?: typeof applyDueFeatureSchedules
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== FEATURE_SCHEDULE_APPLIER_CRON) {
      return
    }

    await runFeatureScheduleApplierJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Applies due scheduled feature changes on the 5-minute cron. Each step has
 * its own wide event (the Axiom replay ledger line); this job event carries
 * the counts. Steps run through the same `setFeatureRule` as the admin UI.
 */
export async function runFeatureScheduleApplierJob(
  input: RunFeatureScheduleApplierJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const applyDue = input.applyDue || applyDueFeatureSchedules
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/feature-schedule-applier',
    requestId: `feature-schedule-applier-${input.controller.scheduledTime}`,
  })
  const now = new Date(input.controller.scheduledTime)
  let status = 200

  logger.set({
    attributes: {
      featureScheduleJob: {
        cron: input.controller.cron,
        scheduledTime: now.toISOString(),
      },
    },
  })

  try {
    const runtimeConfig = useRuntimeConfig()
    const db = useDb()
    const result = await applyDue({
      db,
      kv: useKV(),
      now,
      rolloutOverride: runtimeConfig.featuresRolloutEnabled,
      shipWideEvent: input.shipWideEvent,
      createLogger,
      notify: createFeatureScheduleNotifier(db, now, logger),
    })

    logger.set({ attributes: { featureScheduleResult: result } })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        featureScheduleJob: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

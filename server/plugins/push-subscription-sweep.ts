import { createRequestLogger } from 'evlog'
import { and, isNull, lt, or } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const PUSH_SUBSCRIPTION_TTL_DAYS = 60

const PUSH_SUBSCRIPTION_SWEEP_CRON = '0 * * * *'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunPushSubscriptionSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  db?: ReturnType<typeof useDb>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== PUSH_SUBSCRIPTION_SWEEP_CRON) {
      return
    }

    await runPushSubscriptionSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

export async function runPushSubscriptionSweepJob(
  input: RunPushSubscriptionSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/push-subscription-sweep',
    requestId: `push-subscription-sweep-${input.controller.scheduledTime}`,
  })
  const cutoff = new Date(
    input.controller.scheduledTime
    - PUSH_SUBSCRIPTION_TTL_DAYS * MILLISECONDS_PER_DAY,
  )
  let status = 200

  logger.set({
    attributes: {
      pushSweep: {
        cron: input.controller.cron,
        scheduledTime: new Date(input.controller.scheduledTime).toISOString(),
        cutoff: cutoff.toISOString(),
      },
    },
  })

  try {
    const db = input.db || useDb()
    const deletedRows = await db.delete(schema.pushSubscriptions)
      .where(or(
        lt(schema.pushSubscriptions.lastSeenAt, cutoff),
        and(
          isNull(schema.pushSubscriptions.lastSeenAt),
          lt(schema.pushSubscriptions.createdAt, cutoff),
        ),
      ))
      .returning({ id: schema.pushSubscriptions.id })

    logger.set({
      attributes: {
        pushSweep: {
          deleted: deletedRows.length,
        },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        pushSweep: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  logger.emit({ status })
}

import { createRequestLogger } from 'evlog'
import { asc, inArray, lt } from 'drizzle-orm'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const FEATURE_AUDIT_RETENTION_DAYS = 365
export const FEATURE_AUDIT_SWEEP_BATCH_SIZE = 100
export const FEATURE_AUDIT_SWEEP_MAX_BATCHES = 10

const FEATURE_AUDIT_SWEEP_CRON = '0 * * * *'
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunFeatureAuditSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== FEATURE_AUDIT_SWEEP_CRON) {
      return
    }

    await runFeatureAuditSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

async function deleteExpiredAuditRows(
  db: ReturnType<typeof useDb>,
  cutoff: Date,
): Promise<number> {
  let deleted = 0

  for (let batch = 0; batch < FEATURE_AUDIT_SWEEP_MAX_BATCHES; batch++) {
    const rows = await db.delete(schema.featureAuditLog)
      .where(inArray(
        schema.featureAuditLog.id,
        db.select({ id: schema.featureAuditLog.id })
          .from(schema.featureAuditLog)
          .where(lt(schema.featureAuditLog.createdAt, cutoff))
          .orderBy(asc(schema.featureAuditLog.id))
          .limit(FEATURE_AUDIT_SWEEP_BATCH_SIZE),
      ))
      .returning({ id: schema.featureAuditLog.id })

    deleted += rows.length

    if (rows.length < FEATURE_AUDIT_SWEEP_BATCH_SIZE) {
      break
    }
  }

  return deleted
}

/**
 * Deletes `feature_audit_log` rows older than 365 days, the retention the
 * Privacy Policy states (compliance pre-check C6). It runs on the hourly
 * cron without an off switch, so the limit always holds; each run is bounded
 * by a batch size and count, and a backlog drains over the following hours.
 */
export async function runFeatureAuditSweepJob(
  input: RunFeatureAuditSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/feature-audit-sweep',
    requestId: `feature-audit-sweep-${input.controller.scheduledTime}`,
  })
  const cutoff = new Date(
    input.controller.scheduledTime
    - FEATURE_AUDIT_RETENTION_DAYS * MILLISECONDS_PER_DAY,
  )
  let status = 200

  logger.set({
    attributes: {
      featureAuditSweep: {
        cron: input.controller.cron,
        cutoff: cutoff.toISOString(),
      },
    },
  })

  try {
    const deleted = await deleteExpiredAuditRows(input.db || useDb(), cutoff)

    logger.set({
      attributes: {
        featureAuditSweep: { deleted },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        featureAuditSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

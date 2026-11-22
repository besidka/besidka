import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  pruneConnectorAuditRows,
} from '~~/server/utils/connectors/audit-prune'

const CONNECTOR_AUDIT_PRUNE_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunConnectorAuditPruneJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
  maxRuntimeMs?: number
  readClockMs?: () => number
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== CONNECTOR_AUDIT_PRUNE_CRON) {
      return
    }

    await runConnectorAuditPruneJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Prunes `connector_tool_calls` audit rows past their 90 day retention on
 * the hourly cron. It has no feature flag on purpose: the audit trail must
 * not outlive its retention whether or not connectors are still enabled.
 */
export async function runConnectorAuditPruneJob(
  input: RunConnectorAuditPruneJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/connector-audit-prune',
    requestId: `connector-audit-prune-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const result = await pruneConnectorAuditRows({
      db: input.db || useDb(),
      now: new Date(input.controller.scheduledTime),
      maxRuntimeMs: input.maxRuntimeMs,
      readClockMs: input.readClockMs,
    })

    logger.set({
      attributes: {
        connectorAuditPrune: {
          cron: input.controller.cron,
          deleted: result.deleted,
          batches: result.batches,
          truncated: result.isTruncated,
        },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        connectorAuditPrune: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

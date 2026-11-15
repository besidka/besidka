import { createRequestLogger } from 'evlog'
import type { KVNamespace } from '@cloudflare/workers-types'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { REGISTRY_SYNC_CRON } from '#shared/utils/connectors-policy'
import { syncMcpRegistry } from '~~/server/utils/connectors/registry-sync'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunMcpRegistrySyncJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
  kv?: KVNamespace
  fetchImpl?: typeof fetch
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== REGISTRY_SYNC_CRON) {
      return
    }

    await runMcpRegistrySyncJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Hourly mirror of the official MCP Registry (docs/connectors.md section 9).
 * It runs whatever the state of the `connectors.registry` flag, so the data
 * is ready when the flag flips. A registry outage, a bad page or a missing
 * binding is logged and ends the run with status 500; nothing is ever thrown
 * to the scheduler and the previous rows stay searchable.
 */
export async function runMcpRegistrySyncJob(
  input: RunMcpRegistrySyncJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/mcp-registry-sync',
    requestId: `mcp-registry-sync-${input.controller.scheduledTime}`,
  })
  let status: number

  try {
    const result = await syncMcpRegistry({
      db: input.db || useDb(),
      kv: input.kv || useKV(),
      now: new Date(input.controller.scheduledTime),
      fetchImpl: input.fetchImpl,
      logger,
    })

    status = result.outcome === 'failed' ? 500 : 200
    logger.set({
      attributes: {
        registry: {
          cron: input.controller.cron,
          outcome: result.outcome,
          mode: result.mode,
          pages: result.pages,
          upserted: result.upserted,
          deleted: result.deleted,
          skipped: result.skipped,
          skippedByReason: result.skippedByReason,
          swept: result.swept,
          error: result.error,
        },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: { registry: { error: exceptionMessage(exception) } },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

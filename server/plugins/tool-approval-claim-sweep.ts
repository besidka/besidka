import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepToolApprovalClaims } from '~~/server/utils/tool-approval/claims'

const TOOL_APPROVAL_CLAIM_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunToolApprovalClaimSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== TOOL_APPROVAL_CLAIM_SWEEP_CRON) {
      return
    }

    await runToolApprovalClaimSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Deletes `tool_approval_claims` rows older than 48 hours on the hourly
 * cron. It has no feature flag on purpose: a claim only exists to make an
 * approved call run once, and nothing may keep it past its retention.
 */
export async function runToolApprovalClaimSweepJob(
  input: RunToolApprovalClaimSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/tool-approval-claim-sweep',
    requestId: `tool-approval-claim-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const deleted = await sweepToolApprovalClaims({
      db: input.db || useDb(),
      now: new Date(input.controller.scheduledTime),
    })

    logger.set({
      attributes: {
        toolApprovalClaimSweep: { cron: input.controller.cron, deleted },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        toolApprovalClaimSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

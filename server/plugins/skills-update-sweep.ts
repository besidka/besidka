import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepSkillUpdates } from '~~/server/utils/skills/import/update-sweep'
import type { SkillUpdateKv } from '~~/server/utils/skills/import/update-state'

const SKILLS_UPDATE_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunSkillsUpdateSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
  kv?: SkillUpdateKv
  fetchImpl?: typeof fetch
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== SKILLS_UPDATE_SWEEP_CRON) {
      return
    }

    await runSkillsUpdateSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Once an hour looks, for at most 50 skills that have not been looked at in
 * 24 hours, for a newer version of a skill imported from GitHub, and
 * remembers it for the manager's "Update 2.1.3" badge. It reads the git ref
 * list only: nothing is downloaded or changed, no key is used, nothing is
 * spent. The event carries counts, never ids, names or URLs.
 */
export async function runSkillsUpdateSweepJob(
  input: RunSkillsUpdateSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/skills-update-sweep',
    requestId: `skills-update-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const result = await sweepSkillUpdates({
      db: input.db || useDb(),
      kv: input.kv || useKV(),
      now: new Date(input.controller.scheduledTime),
      fetchImpl: input.fetchImpl,
      logger,
    })

    logger.set({
      attributes: {
        skillsUpdateSweep: { cron: input.controller.cron, ...result },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        skillsUpdateSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

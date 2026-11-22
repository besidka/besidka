import { createRequestLogger } from 'evlog'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { sweepSkillStorage } from '~~/server/utils/skills/sweep'
import type { SkillBlobBucket } from '~~/server/utils/skills/storage'
import type { SkillSweepKv } from '~~/server/utils/skills/sweep'

const SKILLS_STORAGE_SWEEP_CRON = '0 * * * *'

interface ScheduledControllerLike {
  cron: string
  scheduledTime: number
}

interface RunSkillsStorageSweepJobInput {
  controller: ScheduledControllerLike
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
  db?: ReturnType<typeof useDb>
  bucket?: SkillBlobBucket
  kv?: SkillSweepKv
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('cloudflare:scheduled', async ({ controller }) => {
    if (controller.cron !== SKILLS_STORAGE_SWEEP_CRON) {
      return
    }

    await runSkillsStorageSweepJob({
      controller: {
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
      },
    })
  })
})

/**
 * Removes staged import files older than one hour and blobs that no
 * `skill_files` row references on the hourly cron. Like the artifact sweeps
 * it has no feature flag: the retention promise holds whether or not skills
 * are enabled.
 */
export async function runSkillsStorageSweepJob(
  input: RunSkillsStorageSweepJobInput,
): Promise<void> {
  const createLogger = input.createLogger || createRequestLogger
  const logger = createLogger({
    method: 'CRON',
    path: '/internal/jobs/skills-storage-sweep',
    requestId: `skills-storage-sweep-${input.controller.scheduledTime}`,
  })
  let status = 200

  try {
    const result = await sweepSkillStorage({
      db: input.db || useDb(),
      bucket: input.bucket || useFileStorage(),
      kv: input.kv || useKV(),
      now: new Date(input.controller.scheduledTime),
    })

    logger.set({
      attributes: {
        skillsStorageSweep: { cron: input.controller.cron, ...result },
      },
    })
  } catch (exception) {
    status = 500
    logger.set({
      attributes: {
        skillsStorageSweep: { error: exceptionMessage(exception) },
      },
    })
  }

  await emitScheduledJobEvent(logger, status, input.shipWideEvent)
}

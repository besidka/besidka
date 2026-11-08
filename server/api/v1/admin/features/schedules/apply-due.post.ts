import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { applyDueFeatureSchedules } from '~~/server/utils/features/schedules'
import {
  isFeatureScheduleTestHookEnabled,
} from '~~/server/utils/features/schedule-test-hook'
import {
  createFeatureScheduleNotifier,
} from '~~/server/utils/features/schedule-notify'
import {
  createFeatureAdminWriteContext,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)

  if (!isFeatureScheduleTestHookEnabled()) {
    throw createError({
      message: 'Not found',
      status: 404,
      why: 'schedule_test_hook_disabled',
    })
  }

  const context = createFeatureAdminWriteContext(event, adminContext)
  const now = new Date()

  return {
    result: await applyDueFeatureSchedules({
      db: context.db,
      kv: context.kv,
      now,
      rolloutOverride: useRuntimeConfig().featuresRolloutEnabled,
      notify: createFeatureScheduleNotifier(
        context.db as ReturnType<typeof useDb>,
        now,
        context.logger,
      ),
    }),
  }
})

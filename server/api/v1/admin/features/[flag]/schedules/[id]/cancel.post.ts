import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { cancelFeatureSchedule } from '~~/server/utils/features/schedules'
import {
  createFeatureAdminWriteContext,
  readAdminFlagParam,
  readAdminIdParam,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)

  return {
    cancelled: await cancelFeatureSchedule(
      context,
      readAdminFlagParam(event),
      readAdminIdParam(event),
    ),
  }
})

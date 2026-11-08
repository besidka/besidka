import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import {
  featureScheduleCreateSchema,
} from '#shared/utils/features/schedule-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import { createFeatureSchedules } from '~~/server/utils/features/schedules'
import {
  createFeatureAdminWriteContext,
  readAdminFlagParam,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const flag = readAdminFlagParam(event)
  const body = await readValidatedBody(
    event,
    featureScheduleCreateSchema.safeParse,
  )

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  return {
    schedule: await createFeatureSchedules(context, flag, body.data),
  }
})

import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { getAdminFeature } from '~~/server/utils/features/admin-queries'
import { readAdminFlagParam } from '~~/server/utils/features/admin-request'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const result = await getAdminFeature(
    useDb(),
    readAdminFlagParam(event),
    adminContext.config,
  )

  if (!result) {
    throw createError({
      message: 'Feature not found',
      status: 404,
      why: 'unknown_flag',
    })
  }

  logFeatureAdminRead(useRequestLogger(event), 'feature', 1)

  return result
})

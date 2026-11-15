import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { getLegalAdminOverview } from '~~/server/utils/legal/admin'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const result = await getLegalAdminOverview(useDb(), {
    sweepEnabled: useRuntimeConfig().legalNoticeSweepEnabled === true,
  })

  logFeatureAdminRead(useRequestLogger(event), 'legal', result.notices.length)

  return result
})

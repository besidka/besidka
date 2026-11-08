import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { listAdminUserRoles } from '~~/server/utils/features/admin-queries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const result = await listAdminUserRoles(useDb(), adminContext.config)

  logFeatureAdminRead(
    useRequestLogger(event),
    'roles',
    result.roles.length + result.envAdmins.length,
  )

  return result
})

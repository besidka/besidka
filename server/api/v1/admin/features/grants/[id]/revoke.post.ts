import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { revokeFeatureGrant } from '~~/server/utils/features/admin'
import {
  createFeatureAdminWriteContext,
  readAdminIdParam,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)

  return {
    revoked: await revokeFeatureGrant(context, readAdminIdParam(event)),
  }
})

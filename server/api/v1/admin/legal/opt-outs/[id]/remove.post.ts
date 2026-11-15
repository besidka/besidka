import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import {
  createFeatureAdminWriteContext,
  readAdminIdParam,
} from '~~/server/utils/features/admin-request'
import { removeLegalNoticeOptOut } from '~~/server/utils/legal/admin'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)

  return {
    optOut: await removeLegalNoticeOptOut(context, readAdminIdParam(event)),
  }
})

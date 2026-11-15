import { defineEventHandler } from 'nuxt/server'
import { requireAdmin } from '~~/server/utils/features/guards'
import { createFeatureAdminWriteContext } from '~~/server/utils/features/admin-request'
import {
  readLegalNoticeIdParam,
  withdrawLegalNoticeApproval,
} from '~~/server/utils/legal/admin'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)

  return {
    approval: await withdrawLegalNoticeApproval(
      context,
      readLegalNoticeIdParam(event),
    ),
  }
})

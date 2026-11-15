import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { legalNoticeApprovalInputSchema } from '#shared/utils/legal-admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import {
  createFeatureAdminWriteContext,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'
import {
  approveLegalNotice,
  readLegalNoticeIdParam,
} from '~~/server/utils/legal/admin'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const noticeId = readLegalNoticeIdParam(event)
  const body = await readValidatedBody(
    event,
    legalNoticeApprovalInputSchema.safeParse,
  )

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  return {
    approval: await approveLegalNotice(context, noticeId, body.data),
  }
})

import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { consentVersionApprovalInputSchema } from '#shared/utils/legal-admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import {
  createFeatureAdminWriteContext,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'
import { approveConsentVersion } from '~~/server/utils/legal/admin'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const body = await readValidatedBody(
    event,
    consentVersionApprovalInputSchema.safeParse,
  )

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  return {
    consentVersion: await approveConsentVersion(context, body.data),
  }
})

import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { userRoleInputSchema } from '#shared/utils/features/admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import { setUserRole } from '~~/server/utils/features/admin'
import {
  createFeatureAdminWriteContext,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const body = await readValidatedBody(event, userRoleInputSchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  return {
    role: await setUserRole(context, body.data),
  }
})

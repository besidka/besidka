import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { featureGrantInputSchema } from '#shared/utils/features/admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import { setFeatureGrant } from '~~/server/utils/features/admin'
import {
  createFeatureAdminWriteContext,
  readAdminFlagParam,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const flag = readAdminFlagParam(event)
  const body = await readValidatedBody(event, featureGrantInputSchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  const grant = await setFeatureGrant(context, flag, body.data)

  return {
    grant: {
      flag: grant.flag,
      userId: grant.userId,
      effect: grant.effect,
      variant: grant.variant,
      expiresAt: grant.expiresAt?.toISOString() ?? null,
    },
  }
})

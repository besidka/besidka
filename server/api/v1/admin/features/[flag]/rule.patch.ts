import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { featureRulePatchSchema } from '#shared/utils/features/admin-schemas'
import { requireAdmin } from '~~/server/utils/features/guards'
import { setFeatureRule } from '~~/server/utils/features/admin'
import {
  createFeatureAdminWriteContext,
  readAdminFlagParam,
  throwInvalidAdminBody,
} from '~~/server/utils/features/admin-request'

export default defineEventHandler(async (event) => {
  const adminContext = await requireAdmin(event)
  const context = createFeatureAdminWriteContext(event, adminContext)
  const flag = readAdminFlagParam(event)
  const body = await readValidatedBody(event, featureRulePatchSchema.safeParse)

  if (body.error) {
    throwInvalidAdminBody(body.error.message)
  }

  return {
    rule: await setFeatureRule(context, flag, body.data),
  }
})

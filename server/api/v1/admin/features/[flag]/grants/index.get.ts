import { createError } from 'evlog'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { getFeatureDefinition } from '#shared/utils/features/registry'
import { requireAdmin } from '~~/server/utils/features/guards'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { listAdminFeatureGrants } from '~~/server/utils/features/admin-queries'
import { readAdminFlagParam } from '~~/server/utils/features/admin-request'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const flag = readAdminFlagParam(event)

  if (!getFeatureDefinition(flag)) {
    throw createError({
      message: 'Feature not found',
      status: 404,
      why: 'unknown_flag',
    })
  }

  const query = await getValidatedQuery(event, z.object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  }).safeParse)

  if (query.error) {
    throw createError({
      message: 'Invalid query',
      status: 400,
      why: query.error.message,
    })
  }

  const result = await listAdminFeatureGrants(
    useDb(),
    flag,
    query.data.offset,
  )

  logFeatureAdminRead(
    useRequestLogger(event),
    'feature_grants',
    result.grants.length,
  )

  return result
})

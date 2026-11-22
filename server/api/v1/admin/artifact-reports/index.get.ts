import { createError } from 'evlog'
import { defineEventHandler, getValidatedQuery } from 'nuxt/server'
import { z } from 'zod'
import { ARTIFACT_REPORT_STATUSES } from '#shared/utils/artifacts'
import { listArtifactReportsForAdmin } from '~~/server/utils/artifacts/takedown'
import { logFeatureAdminRead } from '~~/server/utils/features/admin'
import { requireAdmin } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MAX_OFFSET = 100_000

const querySchema = z.object({
  status: z.enum(ARTIFACT_REPORT_STATUSES).optional(),
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  event.res.headers.set('Cache-Control', 'private, no-store')

  const query = await getValidatedQuery(event, querySchema.safeParse)

  if (query.error) {
    throw createError({
      message: 'Invalid query',
      status: 400,
      why: query.error.message,
    })
  }

  const result = await listArtifactReportsForAdmin({
    db: useDb(),
    ...query.data,
  })

  logFeatureAdminRead(
    useRequestLogger(event),
    'artifact-reports',
    result.items.length,
  )

  return result
})

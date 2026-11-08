import { createError } from 'evlog'
import { z } from 'zod'
import { ARTIFACT_KINDS } from '#shared/utils/artifacts'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { listArtifacts } from '~~/server/utils/artifacts/queries'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MAX_OFFSET = 100_000
const MAX_QUERY_LENGTH = 200

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(MAX_OFFSET).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  query: z.string().max(MAX_QUERY_LENGTH).optional(),
  kind: z.enum(ARTIFACT_KINDS).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'artifacts', { active: false })

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: query.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const result = await listArtifacts({
    db: useDb(),
    userId,
    ...query.data,
  })

  logger.set({
    userId,
    attributes: {
      artifacts: {
        operation: 'list',
        hasQuery: !!query.data.query?.trim(),
        kind: query.data.kind ?? null,
        total: result.total,
      },
    },
  })

  return result
})

import { createError } from 'evlog'
import { z } from 'zod'
import { defineEventHandler, getQuery } from 'nuxt/server'
import {
  DOCUMENT_FORMATS,
  DOCUMENT_LIBRARY_SOURCES,
} from '#shared/utils/documents'
import { listLibraryDocuments } from '~~/server/utils/documents/library'
import { parseSessionUserId } from '~~/server/utils/documents/route'
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
  format: z.enum(DOCUMENT_FORMATS).optional(),
  source: z.enum(DOCUMENT_LIBRARY_SOURCES).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'documents')

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: query.error.message,
    })
  }

  const userId = parseSessionUserId(session)
  const result = await listLibraryDocuments({
    db: useDb(),
    userId,
    ...query.data,
  })

  logger.set({
    userId,
    attributes: {
      documents: {
        operation: 'list',
        hasQuery: !!query.data.query?.trim(),
        format: query.data.format ?? null,
        source: query.data.source ?? null,
        total: result.total,
      },
    },
  })

  return result
})

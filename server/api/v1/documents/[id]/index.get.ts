import { defineEventHandler } from 'nuxt/server'
import { getOwnedDocument } from '~~/server/utils/documents/store'
import {
  createDocumentNotFoundError,
  parseDocumentIdParam,
  parseSessionUserId,
} from '~~/server/utils/documents/route'
import { resolveDocumentStatus } from '~~/server/utils/documents/status'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'documents')

  const documentId = parseDocumentIdParam(event)
  const userId = parseSessionUserId(session)
  const db = useDb()
  const row = await getOwnedDocument(db, userId, documentId)

  if (!row) {
    throw createDocumentNotFoundError()
  }

  logger.set({
    userId,
    attributes: {
      documents: {
        operation: 'status',
        format: row.format,
        status: row.status,
      },
    },
  })

  return await resolveDocumentStatus(db, userId, row)
})

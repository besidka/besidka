import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import {
  getOwnedDocument,
  readDocumentSpec,
} from '~~/server/utils/documents/store'
import {
  createInvalidSpecError,
  parseStoredSpec,
} from '~~/server/utils/documents/stored-spec'
import {
  createDocumentNotFoundError,
  parseDocumentIdParam,
  parseSessionUserId,
} from '~~/server/utils/documents/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
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
  const row = await getOwnedDocument(useDb(), userId, documentId)

  if (!row) {
    throw createDocumentNotFoundError()
  }

  logger.set({
    userId,
    attributes: {
      documents: { operation: 'spec', format: row.format },
    },
  })

  if (row.specR2Key === null) {
    throw createError({
      message: 'The document spec is gone',
      status: 410,
      why: 'The document has no stored spec',
      fix: 'Ask for the document again',
    })
  }

  const specText = await readDocumentSpec(row.specR2Key)

  if (specText === null) {
    throw createError({
      message: 'Document spec not found',
      status: 404,
      why: 'The stored spec object is missing',
      fix: 'Ask for the document again',
    })
  }

  applyResponseHeaders(event, { 'Cache-Control': 'private, no-store' })

  const spec = parseStoredSpec(specText)

  if (spec === undefined) {
    throw createInvalidSpecError()
  }

  return spec
})

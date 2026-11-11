import { createError } from 'evlog'
import { defineEventHandler, getRequestHeader } from 'nuxt/server'
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_FORMAT_HEADER,
  DOCUMENT_MAX_FILE_BYTES,
} from '#shared/utils/documents'
import {
  failClaimedDocument,
  finalizeRenderedDocument,
  setDocumentLog,
  withClaimRelease,
} from '~~/server/utils/documents/finalize'
import { enforceDocumentRateLimit } from '~~/server/utils/documents/rate-limit'
import { validateDocumentBytes } from '~~/server/utils/documents/renderer'
import {
  readBodyBytes,
  readDeclaredContentLength,
} from '~~/server/utils/documents/request-body'
import {
  createDocumentNotFoundError,
  parseDocumentIdParam,
  parseSessionUserId,
} from '~~/server/utils/documents/route'
import {
  claimDocumentRender,
  getOwnedDocument,
  readDocumentSpec,
} from '~~/server/utils/documents/store'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const MAX_STORED_ERROR_CODE_LENGTH = 64

function createValidationFailure(code: string) {
  return createError({
    message: 'The document file did not pass validation',
    status: 422,
    why: code,
    fix: 'Let the server render the document instead',
  })
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await requireFeature(event, 'documents')

  const documentId = parseDocumentIdParam(event)
  const userId = parseSessionUserId(session)

  await enforceDocumentRateLimit(event, userId, 'file')

  const db = useDb()
  const row = await getOwnedDocument(db, userId, documentId)

  if (!row) {
    throw createDocumentNotFoundError()
  }

  logger.set({
    userId,
    attributes: {
      documents: { operation: 'file', format: row.format },
    },
  })

  if (getRequestHeader(event, DOCUMENT_FORMAT_HEADER) !== row.format) {
    throw createError({
      message: 'Document format mismatch',
      status: 400,
      why: `The ${DOCUMENT_FORMAT_HEADER} header does not match the document`,
      fix: `Send ${DOCUMENT_FORMAT_HEADER}: ${row.format}`,
    })
  }

  readDeclaredContentLength(event, DOCUMENT_MAX_FILE_BYTES)

  const specR2Key = row.specR2Key

  if (specR2Key === null) {
    throw createError({
      message: 'The document spec is gone',
      status: 410,
      why: DOCUMENT_ERROR_CODES.specMissing,
      fix: 'Ask for the document again',
    })
  }

  const claimed = await claimDocumentRender(db, { userId, documentId })

  if (!claimed) {
    throw createError({
      message: 'The document is already ready or being rendered',
      status: 409,
      why: 'Another request holds the render lease or the file exists',
      fix: 'Reload the status of the document',
    })
  }

  return await withClaimRelease(db, documentId, logger, async () => {
    const bytes = await readBodyBytes(event, DOCUMENT_MAX_FILE_BYTES)
    let spec: unknown

    if (claimed.format === 'xlsx') {
      const specText = await readDocumentSpec(specR2Key)

      if (specText === null) {
        await failClaimedDocument(
          db,
          documentId,
          DOCUMENT_ERROR_CODES.specMissing,
        )

        throw createError({
          message: 'Document spec not found',
          status: 404,
          why: DOCUMENT_ERROR_CODES.specMissing,
          fix: 'Ask for the document again',
        })
      }

      spec = JSON.parse(specText)
    }

    const validation = await validateDocumentBytes(
      { format: claimed.format, bytes, spec },
      logger,
    )

    if (!validation.ok) {
      const errorCode = validation.code.slice(0, MAX_STORED_ERROR_CODE_LENGTH)

      await failClaimedDocument(db, documentId, errorCode)
      setDocumentLog(logger, {
        format: claimed.format,
        status: 'failed',
        renderedBy: 'client',
        bytes: bytes.byteLength,
        durationMs: Date.now() - startedAt,
        errorCode,
      })

      throw createValidationFailure(errorCode)
    }

    if (validation.provenance !== 'ai') {
      await failClaimedDocument(
        db,
        documentId,
        DOCUMENT_ERROR_CODES.provenanceMissing,
      )
      setDocumentLog(logger, {
        format: claimed.format,
        status: 'failed',
        renderedBy: 'client',
        bytes: bytes.byteLength,
        durationMs: Date.now() - startedAt,
        errorCode: DOCUMENT_ERROR_CODES.provenanceMissing,
      })

      throw createValidationFailure(DOCUMENT_ERROR_CODES.provenanceMissing)
    }

    const file = await finalizeRenderedDocument({
      db,
      userId,
      row: claimed,
      bytes,
      renderedBy: 'client',
      logger,
    })

    setDocumentLog(logger, {
      format: claimed.format,
      status: 'ready',
      renderedBy: 'client',
      bytes: bytes.byteLength,
      durationMs: Date.now() - startedAt,
    })

    return { status: 'ready', file }
  })
})

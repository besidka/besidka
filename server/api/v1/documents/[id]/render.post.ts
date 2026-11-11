import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { collectImageIds, parseDocumentSpec } from '@besidka/doc-renderer/spec'
import { DOCUMENT_ERROR_CODES } from '#shared/utils/documents'
import {
  failClaimedDocument,
  finalizeRenderedDocument,
  setDocumentLog,
  withClaimRelease,
} from '~~/server/utils/documents/finalize'
import { loadDocumentImageAssets } from '~~/server/utils/documents/images'
import { enforceDocumentRateLimit } from '~~/server/utils/documents/rate-limit'
import {
  getRenderFailureStatus,
  renderDocument,
} from '~~/server/utils/documents/renderer'
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

const SPEC_INVALID_CODE = DOCUMENT_ERROR_CODES.specInvalid

function parseStoredSpec(specText: string): unknown {
  try {
    return JSON.parse(specText)
  } catch {
    return undefined
  }
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

  await enforceDocumentRateLimit(event, userId, 'render')

  const db = useDb()
  const row = await getOwnedDocument(db, userId, documentId)

  if (!row) {
    throw createDocumentNotFoundError()
  }

  logger.set({
    userId,
    attributes: {
      documents: { operation: 'render', format: row.format },
    },
  })

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
    const logOutcome = (
      status: 'ready' | 'failed',
      fields: { bytes?: number, errorCode?: string },
    ): void => {
      setDocumentLog(logger, {
        format: claimed.format,
        status,
        renderedBy: 'worker',
        durationMs: Date.now() - startedAt,
        ...fields,
      })
    }

    const rejectWith = async (
      errorCode: string,
      status: number,
      message: string,
    ): Promise<never> => {
      await failClaimedDocument(db, documentId, errorCode)
      logOutcome('failed', { errorCode })

      throw createError({
        message,
        status,
        why: errorCode,
        fix: 'Ask for the document again',
      })
    }

    const specText = await readDocumentSpec(specR2Key)

    if (specText === null) {
      return await rejectWith(
        DOCUMENT_ERROR_CODES.specMissing,
        404,
        'Document spec not found',
      )
    }

    const parsed = parseDocumentSpec(parseStoredSpec(specText))

    if (!parsed.ok || parsed.spec.format !== claimed.format) {
      return await rejectWith(
        SPEC_INVALID_CODE,
        422,
        'The document spec is invalid',
      )
    }

    const { spec } = parsed
    const images = await loadDocumentImageAssets(
      db,
      userId,
      collectImageIds(spec),
    )

    if (!images.ok) {
      return await rejectWith(
        images.code,
        422,
        'An image of the document is unavailable',
      )
    }

    const result = await renderDocument({
      specVersion: spec.specVersion,
      spec,
      assets: images.assets,
      provenance: {
        model: claimed.originModel ?? null,
        createdVia: 'chat',
        aiGenerated: true,
      },
    }, logger)

    if (!result.ok) {
      const status = getRenderFailureStatus(result.code, 'chat')

      if (result.code === 'spec_version_unsupported') {
        throw createError({
          message: 'Document rendering is unavailable',
          status,
          why: result.code,
          fix: 'Try again later',
        })
      }

      return await rejectWith(
        result.code,
        status,
        'The document could not be rendered',
      )
    }

    const file = await finalizeRenderedDocument({
      db,
      userId,
      row: claimed,
      bytes: result.bytes,
      renderedBy: 'worker',
      logger,
    })

    logOutcome('ready', { bytes: result.bytes.byteLength })

    return { status: 'ready', file }
  })
})

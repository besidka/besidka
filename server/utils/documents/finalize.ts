import { and, eq } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_MEDIA_TYPES,
  getDocumentFileName,
} from '#shared/utils/documents'
import type {
  DocumentFileRef,
  DocumentRenderedBy,
} from '#shared/utils/documents'
import * as schema from '~~/server/db/schema'
import { decodePublicId } from '~~/server/utils/custom-db-types'
import {
  markDocumentFailed,
  markDocumentReady,
  releaseDocumentClaim,
} from '~~/server/utils/documents/store'
import type { DocumentRow } from '~~/server/utils/documents/store'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { deleteOwnedFile } from '~~/server/utils/files/delete-files'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { persistFile } from '~~/server/utils/files/persist-file'
import type { PersistedFile } from '~~/server/utils/files/persist-file'

type DbClient = ReturnType<typeof useDb>

export interface DocumentLogFields {
  format?: string
  status?: string
  renderedBy?: string
  bytes?: number
  durationMs?: number
  errorCode?: string
  releaseError?: string
  cleanupError?: string
}

export interface FinalizeRenderedDocumentInput {
  db: DbClient
  userId: number
  row: DocumentRow
  bytes: Uint8Array
  renderedBy: Extract<DocumentRenderedBy, 'client' | 'worker'>
  logger: LoggerLike
}

const QUOTA_ERROR_MESSAGE_PREFIX = 'Not enough storage'

export function setDocumentLog(
  logger: LoggerLike,
  fields: DocumentLogFields,
): void {
  logger.set({ attributes: { documents: fields } })
}

export function isStorageQuotaError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) {
    return false
  }

  const { status, message } = exception as {
    status?: unknown
    message?: unknown
  }

  return status === 400
    && typeof message === 'string'
    && message.startsWith(QUOTA_ERROR_MESSAGE_PREFIX)
}

/**
 * Resolves the integer `messages.id` of the assistant reply a document was
 * created in. A row only keeps the message public id until the reply is
 * persisted, so this returns null while the message does not exist yet or
 * belongs to another chat.
 */
export async function resolveOriginMessageRowId(
  db: DbClient,
  row: Pick<
    DocumentRow,
    'originMessageId' | 'originMessagePublicId' | 'originChatId'
  >,
): Promise<number | null> {
  if (row.originMessageId !== null) {
    return row.originMessageId
  }

  if (row.originMessagePublicId === null || row.originChatId === null) {
    return null
  }

  const [message] = await db.select({ id: schema.messages.id })
    .from(schema.messages)
    .where(and(
      eq(schema.messages.publicId, row.originMessagePublicId),
      eq(schema.messages.chatId, row.originChatId),
    ))
    .limit(1)

  if (!message) {
    return null
  }

  const decoded = decodePublicId(message.id)

  return Number.isSafeInteger(decoded) && decoded > 0 ? decoded : null
}

export function toDocumentFileRef(file: DocumentFileRef): DocumentFileRef {
  return {
    id: file.id,
    storageKey: file.storageKey,
    name: file.name,
    size: file.size,
    type: file.type,
  }
}

/**
 * Runs the work of a claimed render and gives the claim back when it throws,
 * so a renderer outage, a quota error or a storage failure never leaves the
 * row `rendering` until the lease expires. Releasing only touches a
 * `rendering` row, so it does nothing after the work already marked the row
 * failed or ready.
 */
export async function withClaimRelease<Result>(
  db: DbClient,
  documentId: string,
  logger: LoggerLike,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work()
  } catch (exception) {
    try {
      await releaseDocumentClaim(db, { documentId })
    } catch (releaseException) {
      setDocumentLog(logger, {
        releaseError: exceptionMessage(releaseException),
      })
    }

    throw exception
  }
}

export async function failClaimedDocument(
  db: DbClient,
  documentId: string,
  errorCode: string,
): Promise<void> {
  await markDocumentFailed(db, { documentId, errorCode })
}

async function discardOrphanedFile(
  userId: number,
  fileId: string,
  logger: LoggerLike,
): Promise<void> {
  try {
    await deleteOwnedFile({ userId, fileId, logger })
  } catch (exception) {
    setDocumentLog(logger, {
      cleanupError: exceptionMessage(exception),
    })
  }
}

/**
 * Stores validated or server-rendered bytes as the document's file and marks
 * the claimed row ready. A quota error becomes a 507 and the claim is given
 * back by `withClaimRelease`, so a retry works after space was freed. When
 * the lease was taken over meanwhile, the freshly stored file is deleted
 * again and the caller gets a 409.
 */
export async function finalizeRenderedDocument(
  input: FinalizeRenderedDocumentInput,
): Promise<DocumentFileRef> {
  const { db, userId, row, bytes, renderedBy, logger } = input
  const originMessageId = await resolveOriginMessageRowId(db, row)
  let persisted: PersistedFile

  try {
    persisted = await persistFile({
      userId,
      fileName: getDocumentFileName(row.title || '', row.format),
      mediaType: DOCUMENT_MEDIA_TYPES[row.format],
      fileData: bytes,
      source: 'assistant',
      originMessageId,
      originProvider: row.originProvider,
      originModel: row.originModel,
      logger,
    })
  } catch (exception) {
    if (isStorageQuotaError(exception)) {
      setDocumentLog(logger, {
        format: row.format,
        errorCode: DOCUMENT_ERROR_CODES.quotaExceeded,
      })

      throw createError({
        message: 'Not enough storage space',
        status: 507,
        code: DOCUMENT_ERROR_CODES.quotaExceeded,
        why: DOCUMENT_ERROR_CODES.quotaExceeded,
        fix: 'Delete some files and try again',
      })
    }

    throw exception
  }

  const ready = await markDocumentReady(db, {
    documentId: row.id,
    fileId: persisted.id,
    renderedBy,
  })

  if (!ready) {
    await discardOrphanedFile(userId, persisted.id, logger)

    throw createError({
      message: 'The document is no longer being rendered',
      status: 409,
      why: 'The render lease was taken over before the file was stored',
      fix: 'Reload the chat to see the finished document',
    })
  }

  return toDocumentFileRef(persisted)
}

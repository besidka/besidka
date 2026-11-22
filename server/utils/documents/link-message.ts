import type { UIMessage } from 'ai'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { isDataDocumentPart } from '#shared/utils/documents'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

const MAX_BATCH_QUERY_PARAMS = 90

export interface LinkDocumentsToMessageInput {
  userId: number
  messageRowId: number
  documentIds: string[]
  logger: LoggerLike
}

export interface LinkDocumentsToMessageResult {
  documentsLinked: number
  filesLinked: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

/**
 * Document ids of the `data-document` parts of one persisted message.
 */
export function collectMessageDocumentIds(
  parts: UIMessage['parts'],
): string[] {
  const documentIds = new Set<string>()

  for (const part of parts) {
    if (isDataDocumentPart(part) && part.data.documentId !== null) {
      documentIds.add(part.data.documentId)
    }
  }

  return [...documentIds]
}

/**
 * Records the assistant message a reply's documents were persisted under.
 * Only the owner's rows without an origin message yet are linked, so a row is
 * never moved to another message. A document that already finished rendering
 * has its file linked too when the file has no origin message yet. Best
 * effort and never throws: the reply is already saved, and a document that
 * misses the link still resolves through its message public id.
 */
export async function linkDocumentsToMessage(
  db: DbClient,
  input: LinkDocumentsToMessageInput,
): Promise<LinkDocumentsToMessageResult> {
  const result: LinkDocumentsToMessageResult = {
    documentsLinked: 0,
    filesLinked: 0,
  }
  const documentIds = [...new Set(input.documentIds)]

  if (documentIds.length === 0) {
    return result
  }

  try {
    for (const chunk of chunkItems(documentIds, MAX_BATCH_QUERY_PARAMS)) {
      const linked = await db.update(schema.documents)
        .set({ originMessageId: input.messageRowId })
        .where(and(
          eq(schema.documents.userId, input.userId),
          isNull(schema.documents.originMessageId),
          inArray(schema.documents.id, chunk),
        ))
        .returning({
          id: schema.documents.id,
          fileId: schema.documents.fileId,
        })

      result.documentsLinked += linked.length

      const fileIds = linked
        .map((row) => {
          return row.fileId
        })
        .filter((fileId): fileId is string => {
          return fileId !== null
        })

      if (fileIds.length === 0) {
        continue
      }

      const files = await db.update(schema.files)
        .set({ originMessageId: input.messageRowId })
        .where(and(
          eq(schema.files.userId, input.userId),
          isNull(schema.files.originMessageId),
          inArray(schema.files.id, fileIds),
        ))
        .returning({ id: schema.files.id })

      result.filesLinked += files.length
    }
  } catch (exception) {
    input.logger.set({
      attributes: {
        documents: {
          linkMessageError: exceptionMessage(exception),
          requested: documentIds.length,
        },
      },
    })

    return result
  }

  input.logger.set({
    attributes: {
      documents: {
        linkedToMessage: result.documentsLinked,
        linkedFilesToMessage: result.filesLinked,
      },
    },
  })

  return result
}

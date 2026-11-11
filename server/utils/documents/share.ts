import type { UIMessage } from 'ai'
import type { H3Event } from 'h3'
import type {
  DataDocumentPartData,
  SharedDocumentPart,
} from '#shared/utils/documents'
import { and, eq, inArray } from 'drizzle-orm'
import {
  DOCUMENT_DATA_PART_TYPE,
  isDataDocumentPart,
} from '#shared/utils/documents'
import * as schema from '~~/server/db/schema'
import { SHARE_FILE_TOKEN_TTL_SECONDS } from '~~/server/utils/chats/share'
import { createFileAccessToken } from '~~/server/utils/files/file-share-access'

const MAX_BATCH_QUERY_PARAMS = 90

interface SharedDocumentFile {
  storageKey: string
  name: string
  size: number
  type: string
  fileId: string
}

export interface ResolveSharedDocumentPartsInput {
  shareId: string
  chatId: string
  showFiles: boolean
  event?: H3Event
}

type MessagePart = UIMessage['parts'][number]

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

function collectDocumentIds<TMessage extends { parts: UIMessage['parts'] }>(
  messages: TMessage[],
): string[] {
  const documentIds = new Set<string>()

  for (const message of messages) {
    for (const part of message.parts) {
      if (isDataDocumentPart(part) && part.data.documentId !== null) {
        documentIds.add(part.data.documentId)
      }
    }
  }

  return Array.from(documentIds)
}

async function loadGrantedDocumentFiles(
  documentIds: string[],
  input: ResolveSharedDocumentPartsInput,
): Promise<Map<string, SharedDocumentFile>> {
  const db = useDb()
  const filesByDocumentId = new Map<string, SharedDocumentFile>()

  for (const chunk of chunkArray(documentIds, MAX_BATCH_QUERY_PARAMS)) {
    const rows = await db
      .select({
        documentId: schema.documents.id,
        fileId: schema.files.id,
        storageKey: schema.files.storageKey,
        name: schema.files.name,
        size: schema.files.size,
        type: schema.files.type,
      })
      .from(schema.documents)
      .innerJoin(schema.files, and(
        eq(schema.files.id, schema.documents.fileId),
        eq(schema.files.userId, schema.documents.userId),
      ))
      .innerJoin(schema.chatShareFiles, and(
        eq(schema.chatShareFiles.fileId, schema.files.id),
        eq(schema.chatShareFiles.chatShareId, input.shareId),
      ))
      .where(and(
        inArray(schema.documents.id, chunk),
        eq(schema.documents.originChatId, input.chatId),
        eq(schema.documents.status, 'ready'),
      ))

    for (const row of rows) {
      filesByDocumentId.set(row.documentId, row)
    }
  }

  return filesByDocumentId
}

function buildSharedPart(
  data: DataDocumentPartData,
  file: { url: string, name: string, size: number, type: string } | null,
): SharedDocumentPart {
  return {
    type: DOCUMENT_DATA_PART_TYPE,
    data: {
      documentId: null,
      format: data.format,
      title: data.title,
      specVersion: data.specVersion,
      status: file ? 'ready' : data.status,
      ...(file ? { file } : {}),
    },
  }
}

/**
 * Rewrites the `data-document` parts of a public share. A visitor never gets
 * a document id: a part becomes a title-only card, or, when the share shows
 * files and the document's file is granted to this share, a card with a
 * tokenized download link. A document that belongs to another chat (copied
 * through a branch) stays title-only.
 */
export async function resolveSharedDocumentParts<
  TMessage extends { parts: UIMessage['parts'] },
>(
  messages: TMessage[],
  input: ResolveSharedDocumentPartsInput,
): Promise<TMessage[]> {
  const documentIds = collectDocumentIds(messages)

  if (documentIds.length === 0) {
    return messages
  }

  const filesByDocumentId = input.showFiles
    ? await loadGrantedDocumentFiles(documentIds, input)
    : new Map<string, SharedDocumentFile>()
  const tokensByFileId = new Map<string, string>()
  const rewrittenMessages: TMessage[] = []

  for (const message of messages) {
    const rewrittenParts: UIMessage['parts'] = []

    for (const part of message.parts) {
      if (!isDataDocumentPart(part) || part.data.documentId === null) {
        rewrittenParts.push(part)

        continue
      }

      const documentFile = filesByDocumentId.get(part.data.documentId)

      if (!documentFile) {
        rewrittenParts.push(
          buildSharedPart(part.data, null) as unknown as MessagePart,
        )

        continue
      }

      const token = tokensByFileId.get(documentFile.fileId)
        ?? await createFileAccessToken(
          {
            shareId: input.shareId,
            fileId: documentFile.fileId,
            expiresInSeconds: SHARE_FILE_TOKEN_TTL_SECONDS,
          },
          input.event ?? useEvent(),
        )

      tokensByFileId.set(documentFile.fileId, token)

      rewrittenParts.push(buildSharedPart(part.data, {
        url: `/files/${documentFile.storageKey}?token=${encodeURIComponent(token)}`,
        name: documentFile.name,
        size: documentFile.size,
        type: documentFile.type,
      }) as unknown as MessagePart)
    }

    rewrittenMessages.push({ ...message, parts: rewrittenParts })
  }

  return rewrittenMessages
}

export function dropDocumentParts<
  TMessage extends { parts: UIMessage['parts'] },
>(messages: TMessage[]): TMessage[] {
  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.filter((part) => {
        return part.type !== DOCUMENT_DATA_PART_TYPE
      }),
    }
  })
}

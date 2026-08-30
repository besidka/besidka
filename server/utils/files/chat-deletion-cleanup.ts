import { and, eq, inArray, like, or } from 'drizzle-orm'
import { extractLocalFileStorageKey } from '#shared/utils/files'
import type { LoggerLike } from '~~/server/utils/files/logger'
import * as schema from '~~/server/db/schema'
import { invalidateFileCache } from '~~/server/utils/files/convert-files-for-ai'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const MAX_BATCH_QUERY_PARAMS = 90

export interface ChatOriginFile {
  id: string
  storageKey: string
}

export interface OrphanedChatFileCleanupResult {
  candidateCount: number
  stillReferencedCount: number
  deletedCount: number
  failedCount: number
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

export async function findChatOriginFiles(
  chatId: string,
  userId: number,
): Promise<ChatOriginFile[]> {
  const db = useDb()

  return db
    .select({
      id: schema.files.id,
      storageKey: schema.files.storageKey,
    })
    .from(schema.files)
    .innerJoin(
      schema.messages,
      eq(schema.files.originMessageId, schema.messages.id),
    )
    .where(and(
      eq(schema.messages.chatId, chatId),
      eq(schema.files.userId, userId),
    ))
}

export async function findMessageOriginFiles(
  messageId: number,
  userId: number,
): Promise<ChatOriginFile[]> {
  const db = useDb()

  return db
    .select({
      id: schema.files.id,
      storageKey: schema.files.storageKey,
    })
    .from(schema.files)
    .where(and(
      eq(schema.files.originMessageId, messageId),
      eq(schema.files.userId, userId),
    ))
}

/**
 * A file's `originMessageId` only records where it was first uploaded or
 * generated — branching a chat copies message parts (including file URLs)
 * into a new chat, and the "attach existing file" flow lets a user reuse the
 * same file across unrelated chats, both without ever touching that column.
 * So a file whose origin message is being deleted may still be referenced by
 * a `file` part in some other surviving message. This must run after the
 * origin row(s) being deleted are already gone, so the origin chat's own
 * self-references don't shadow the check.
 */
async function findStorageKeysStillReferenced(
  storageKeys: string[],
  userId: number,
): Promise<Set<string>> {
  const db = useDb()
  const stillReferencedStorageKeys = new Set<string>()

  for (const chunk of chunkArray(storageKeys, MAX_BATCH_QUERY_PARAMS)) {
    const matchingMessages = await db
      .select({ parts: schema.messages.parts })
      .from(schema.messages)
      .innerJoin(schema.chats, eq(schema.messages.chatId, schema.chats.id))
      .where(and(
        eq(schema.chats.userId, userId),
        or(...chunk.map((storageKey) => {
          return like(schema.messages.parts, `%${storageKey}%`)
        })),
      ))

    for (const message of matchingMessages) {
      for (const part of message.parts) {
        if (part.type !== 'file' || part.url.startsWith('data:')) {
          continue
        }

        const storageKey = extractLocalFileStorageKey(part.url)

        if (storageKey) {
          stillReferencedStorageKeys.add(storageKey)
        }
      }
    }
  }

  return stillReferencedStorageKeys
}

export async function cleanupFilesOrphanedByChatDeletion(
  candidateFiles: ChatOriginFile[],
  userId: number,
  logger: LoggerLike,
): Promise<OrphanedChatFileCleanupResult> {
  if (candidateFiles.length === 0) {
    return {
      candidateCount: 0,
      stillReferencedCount: 0,
      deletedCount: 0,
      failedCount: 0,
    }
  }

  const storage = useFileStorage()
  const db = useDb()
  const stillReferencedStorageKeys = await findStorageKeysStillReferenced(
    candidateFiles.map(file => file.storageKey),
    userId,
  )

  const filesToDelete = candidateFiles.filter((file) => {
    return !stillReferencedStorageKeys.has(file.storageKey)
  })

  let failedCount = 0
  const batchDeleteErrors: string[] = []

  for (const chunk of chunkArray(filesToDelete, MAX_BATCH_QUERY_PARAMS)) {
    const storageKeys = chunk.map(file => file.storageKey)

    try {
      await storage.delete(storageKeys)
    } catch (exception) {
      failedCount += chunk.length
      batchDeleteErrors.push(exceptionMessage(exception))
      continue
    }

    for (const storageKey of storageKeys) {
      await invalidateFileCache(storageKey, logger)
    }

    await db
      .delete(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        inArray(schema.files.id, chunk.map(file => file.id)),
      ))
  }

  const deletedCount = filesToDelete.length - failedCount

  if (deletedCount > 0) {
    await invalidateStorageCache(userId, logger)
  }

  const result = {
    candidateCount: candidateFiles.length,
    stillReferencedCount: stillReferencedStorageKeys.size,
    deletedCount,
    failedCount,
  }

  logger.set({
    orphanedFileCleanup: result,
    attributes: batchDeleteErrors.length > 0
      ? { orphanedFileCleanup: { batchDeleteErrors } }
      : undefined,
  })

  return result
}

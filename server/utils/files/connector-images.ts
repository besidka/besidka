import type { UIMessage } from 'ai'
import { and, eq, inArray, like } from 'drizzle-orm'
import {
  CONNECTOR_IMAGE_PART_TYPE,
  collectConnectorImageFileIds,
  isConnectorImageDataPart,
} from '#shared/utils/connector-image-parts'
import { withDerivedKeys } from '#shared/utils/office-files'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { invalidateFileCache } from '~~/server/utils/files/convert-files-for-ai'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export const CONNECTOR_IMAGE_DELETE_BATCH_SIZE = 90
export const CONNECTOR_IMAGE_DELETE_MAX_BATCHES = 20

export interface ConnectorImageFile {
  id: string
  storageKey: string
}

export interface DeleteConnectorImagesResult {
  deleted: number
  failed: number
  hasMore: boolean
}

function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

async function findConnectorFilesByIds(
  db: DbClient,
  userId: number,
  fileIds: readonly string[],
): Promise<ConnectorImageFile[]> {
  const files: ConnectorImageFile[] = []

  for (const chunk of chunkArray(fileIds, CONNECTOR_IMAGE_DELETE_BATCH_SIZE)) {
    const rows = await db
      .select({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
      })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        eq(schema.files.source, 'connector'),
        inArray(schema.files.id, chunk),
      ))

    files.push(...rows)
  }

  return files
}

/**
 * Every connector image the messages of these chats show, found through
 * their `data-connector-image` parts, so a chat takes its connector images
 * with it even when a row was never linked to its origin message. Must run
 * before the chats are deleted.
 */
export async function findChatsConnectorImageFiles(
  db: DbClient,
  chatIds: readonly string[],
  userId: number,
): Promise<ConnectorImageFile[]> {
  const fileIds = new Set<string>()

  for (const chunk of chunkArray(chatIds, CONNECTOR_IMAGE_DELETE_BATCH_SIZE)) {
    const messages = await db
      .select({ parts: schema.messages.parts })
      .from(schema.messages)
      .where(and(
        inArray(schema.messages.chatId, chunk),
        like(schema.messages.parts, `%${CONNECTOR_IMAGE_PART_TYPE}%`),
      ))

    for (const message of messages) {
      for (const fileId of collectConnectorImageFileIds(message.parts)) {
        fileIds.add(fileId)
      }
    }
  }

  return fileIds.size > 0
    ? await findConnectorFilesByIds(db, userId, [...fileIds])
    : []
}

/**
 * The connector image ids these parts point at whose file no longer exists
 * (deleted from the Storage page, with its message, or by MCP), in one query
 * per 90 ids, so the chat shows a "deleted" tile instead of requesting each
 * missing image.
 */
export async function findMissingConnectorImageFileIds(
  db: DbClient,
  userId: number,
  parts: readonly unknown[],
): Promise<string[]> {
  const fileIds = collectConnectorImageFileIds(parts)

  if (fileIds.length === 0) {
    return []
  }

  const existing = new Set(
    (await findConnectorFilesByIds(db, userId, fileIds)).map(file => file.id),
  )

  return fileIds.filter(fileId => !existing.has(fileId))
}

/**
 * Marks every `data-connector-image` part whose file is gone with
 * `deleted: true`, from one existence check over all messages, so the chat
 * shows a "deleted" tile instead of requesting each missing image. Owner
 * chat payload only; nothing is written back.
 */
export async function markDeletedConnectorImages<
  TMessage extends { parts: UIMessage['parts'] },
>(
  db: DbClient,
  userId: number,
  messages: TMessage[],
): Promise<TMessage[]> {
  const missing = new Set(await findMissingConnectorImageFileIds(
    db,
    userId,
    messages.flatMap(message => message.parts),
  ))

  if (missing.size === 0) {
    return messages
  }

  return messages.map((message) => {
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (
          !isConnectorImageDataPart(part)
          || !missing.has(part.data.fileId)
        ) {
          return part
        }

        return { ...part, data: { ...part.data, deleted: true } }
      }),
    }
  })
}

/**
 * Deletes connector image files: R2 objects in one batch delete per 90
 * files, then their rows, batch by batch, then the storage cache. A batch
 * whose R2 delete fails keeps its rows, so nothing is counted that cannot be
 * deleted again.
 */
export async function deleteConnectorImageFiles(
  db: DbClient,
  userId: number,
  files: readonly ConnectorImageFile[],
  logger: LoggerLike,
): Promise<{ deleted: number, failed: number }> {
  const storage = useFileStorage()
  let deleted = 0
  let failed = 0

  for (const chunk of chunkArray(files, CONNECTOR_IMAGE_DELETE_BATCH_SIZE)) {
    const storageKeys = chunk.map(file => file.storageKey)

    try {
      await storage.delete(withDerivedKeys(storageKeys))
    } catch (exception) {
      failed += chunk.length
      logger.set({
        attributes: {
          connectorImagesDelete: { error: exceptionMessage(exception) },
        },
      })

      continue
    }

    for (const storageKey of storageKeys) {
      await invalidateFileCache(storageKey, logger)
    }

    await db
      .delete(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        eq(schema.files.source, 'connector'),
        inArray(schema.files.id, chunk.map(file => file.id)),
      ))

    deleted += chunk.length
  }

  if (deleted > 0) {
    await invalidateStorageCache(userId, logger)
  }

  return { deleted, failed }
}

/**
 * Deletes the user's connector images batch by batch, at most
 * `CONNECTOR_IMAGE_DELETE_MAX_BATCHES` batches of 90 per call. `hasMore`
 * tells the caller to call again; a batch that fails stops the run.
 */
export async function deleteAllConnectorImages(
  db: DbClient,
  userId: number,
  logger: LoggerLike,
): Promise<DeleteConnectorImagesResult> {
  let deleted = 0
  let failed = 0

  for (
    let batchIndex = 0;
    batchIndex < CONNECTOR_IMAGE_DELETE_MAX_BATCHES;
    batchIndex++
  ) {
    const files = await db
      .select({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
      })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        eq(schema.files.source, 'connector'),
      ))
      .limit(CONNECTOR_IMAGE_DELETE_BATCH_SIZE)

    if (files.length === 0) {
      return { deleted, failed, hasMore: false }
    }

    const result = await deleteConnectorImageFiles(db, userId, files, logger)

    deleted += result.deleted
    failed += result.failed

    if (result.failed > 0) {
      return { deleted, failed, hasMore: true }
    }
  }

  const remaining = await db
    .select({ id: schema.files.id })
    .from(schema.files)
    .where(and(
      eq(schema.files.userId, userId),
      eq(schema.files.source, 'connector'),
    ))
    .limit(1)
    .get()

  return { deleted, failed, hasMore: !!remaining }
}

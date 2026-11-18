import type { UIMessage } from 'ai'
import { and, eq, inArray } from 'drizzle-orm'
import {
  collectConnectorImageFileIds,
  isConnectorImageDataPart,
  toConnectorImageChatMarker,
} from '#shared/utils/connector-image-parts'
import { withDerivedKeys } from '#shared/utils/office-files'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'

type DbClient = ReturnType<typeof useDb>

export const CONNECTOR_IMAGE_DELETE_BATCH_SIZE = 90
export const CONNECTOR_IMAGE_DELETE_MAX_BATCHES = 3

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
 * The connector image files these parts point at (the user's own rows
 * only), so deleting a message can check them like its origin files even
 * when their origin is another message.
 */
export async function findConnectorImageFilesForParts(
  db: DbClient,
  userId: number,
  parts: readonly unknown[],
): Promise<ConnectorImageFile[]> {
  const fileIds = collectConnectorImageFileIds(parts)

  return fileIds.length > 0
    ? await findConnectorFilesByIds(db, userId, fileIds)
    : []
}

/**
 * Every connector image of these chats, by the chat marker in
 * `files.origin_provider` (`toConnectorImageChatMarker`), so a chat takes
 * all of them with it, including rows whose reply was never stored.
 */
export async function findChatsConnectorImageFiles(
  db: DbClient,
  chatIds: readonly string[],
  userId: number,
): Promise<ConnectorImageFile[]> {
  const files: ConnectorImageFile[] = []

  for (const chunk of chunkArray(chatIds, CONNECTOR_IMAGE_DELETE_BATCH_SIZE)) {
    const rows = await db
      .select({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
      })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, userId),
        eq(schema.files.source, 'connector'),
        inArray(
          schema.files.originProvider,
          chunk.map(toConnectorImageChatMarker),
        ),
      ))

    files.push(...rows)
  }

  return files
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
 * Deletes connector image files batch by batch: the rows first, then the R2
 * objects in one batch delete per 90, then the storage cache. A batch whose
 * row delete fails keeps its objects, so no row is left without its object;
 * an R2 failure after the rows are gone only leaves objects nothing points
 * at, which is logged. No per-file KV cache is invalidated: connector images
 * are never a `file` part, so the model-file cache never holds them.
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
    try {
      await db
        .delete(schema.files)
        .where(and(
          eq(schema.files.userId, userId),
          eq(schema.files.source, 'connector'),
          inArray(schema.files.id, chunk.map(file => file.id)),
        ))
    } catch (exception) {
      failed += chunk.length
      logger.set({
        attributes: {
          connectorImagesDelete: { rowError: exceptionMessage(exception) },
        },
      })

      continue
    }

    deleted += chunk.length

    try {
      await storage.delete(withDerivedKeys(chunk.map(file => file.storageKey)))
    } catch (exception) {
      logger.set({
        attributes: {
          connectorImagesDelete: {
            orphanedObjects: chunk.length,
            objectError: exceptionMessage(exception),
          },
        },
      })
    }
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

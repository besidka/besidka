import { and, asc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { invalidateFileCache } from '~~/server/utils/files/convert-files-for-ai'
import type { LoggerLike } from '~~/server/utils/files/logger'

export interface CleanupExpiredFilesInput {
  now?: Date
  batchSize: number
  maxRuntimeMs: number
  logger?: LoggerLike
}

export interface CleanupExpiredFilesResult {
  selectedCount: number
  deletedCount: number
  failedCount: number
  hasMore: boolean
  runtimeMs: number
}

export async function cleanupExpiredFiles(
  input: CleanupExpiredFilesInput,
): Promise<CleanupExpiredFilesResult> {
  const logger = input.logger
  const db = useDb()
  const now = input.now || new Date()
  const startedAt = Date.now()
  const affectedUserIds = new Set<number>()
  const selectedFiles = await db.query.files.findMany({
    where(files, { and, isNotNull, lte }) {
      return and(
        isNotNull(files.expiresAt),
        lte(files.expiresAt, now),
      )
    },
    orderBy: asc(schema.files.expiresAt),
    limit: Math.max(input.batchSize, 1),
    columns: {
      id: true,
      userId: true,
      storageKey: true,
      expiresAt: true,
    },
  })

  let deletedCount = 0
  let failedCount = 0
  let processedCount = 0

  for (const file of selectedFiles) {
    const runtimeMs = Date.now() - startedAt
    const expiresAt = file.expiresAt
      ? file.expiresAt.toISOString()
      : null

    if (runtimeMs >= input.maxRuntimeMs) {
      break
    }

    processedCount++

    try {
      await useFileStorage().delete(file.storageKey)
    } catch (exception) {
      failedCount++
      logger?.set({
        retentionCleanup: {
          phase: 'r2-delete',
          fileId: file.id,
          storageKey: file.storageKey,
          userId: file.userId,
          expiresAt,
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })
      continue
    }

    try {
      await invalidateFileCache(file.storageKey, logger)
    } catch (exception) {
      logger?.set({
        retentionCleanup: {
          phase: 'cache-invalidate',
          fileId: file.id,
          storageKey: file.storageKey,
          userId: file.userId,
          expiresAt,
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })
    }

    try {
      await db
        .delete(schema.files)
        .where(and(
          eq(schema.files.id, file.id),
          eq(schema.files.userId, file.userId),
        ))
        .run()
    } catch (exception) {
      logger?.set({
        retentionCleanup: {
          phase: 'db-delete',
          fileId: file.id,
          storageKey: file.storageKey,
          userId: file.userId,
          expiresAt,
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })

      throw exception
    }

    affectedUserIds.add(file.userId)
    deletedCount++
  }

  for (const userId of affectedUserIds) {
    try {
      await invalidateStorageCache(userId, logger)
    } catch (exception) {
      logger?.set({
        retentionCleanup: {
          phase: 'storage-cache-invalidate',
          userId,
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })
    }
  }

  const runtimeMs = Date.now() - startedAt
  const hasMore = (
    selectedFiles.length === input.batchSize
    || processedCount < selectedFiles.length
  )

  return {
    selectedCount: selectedFiles.length,
    deletedCount,
    failedCount,
    hasMore,
    runtimeMs,
  }
}

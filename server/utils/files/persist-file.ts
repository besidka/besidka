import type { FileMetadata, FileSource } from '#shared/types/files.d'
import { and, eq } from 'drizzle-orm'
import {
  getPreferredFileExtension,
  normalizeMediaType,
} from '#shared/utils/files'
import { useLogger } from 'evlog'
import type { RequestLogger } from 'evlog'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import {
  getEffectiveUserFilePolicy,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'

type ServerLogger = RequestLogger<Record<string, unknown>>

type StoragePutResponse = Awaited<
  ReturnType<ReturnType<typeof useFileStorage>['put']>
>

export interface PersistFileInput {
  userId: number
  fileName: string
  mediaType: string
  fileData: Uint8Array
  quotaSizeBytes?: number
  source?: FileSource
  originMessageId?: number | null
  originProvider?: string | null
  logger?: ServerLogger
}

export type PersistedFile = Pick<
  FileMetadata,
  'id'
  | 'storageKey'
  | 'name'
  | 'size'
  | 'type'
  | 'source'
  | 'expiresAt'
>

export async function persistFile(
  input: PersistFileInput,
): Promise<PersistedFile> {
  const logger = input.logger || useLogger(useEvent())
  const db = useDb()
  const source = input.source || 'upload'
  const normalizedMediaType = normalizeMediaType(input.mediaType)
  const quotaSizeBytes = input.quotaSizeBytes ?? input.fileData.byteLength

  if (!normalizedMediaType) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid file media type',
    })
  }

  const policy = await getEffectiveUserFilePolicy(input.userId)
  const totalFilesSize = await getUserStorageUsageBytes(input.userId)
  const wouldExceed = totalFilesSize + quotaSizeBytes > policy.maxStorageBytes
  const expiresAt = getExpiresAtByRetentionDays(policy.fileRetentionDays)

  if (wouldExceed) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Not enough storage space. Please delete some files.',
    })
  }

  const fileExtension = getPreferredFileExtension(normalizedMediaType)
  const fileSize = input.fileData.byteLength
  let response: StoragePutResponse

  try {
    response = await useFileStorage().put(
      `${crypto.randomUUID()}.${fileExtension}`,
      input.fileData,
      {
        httpMetadata: {
          contentType: normalizedMediaType,
        },
        customMetadata: {
          name: input.fileName,
        },
      },
    )
  } catch (exception) {
    logger.set({
      filePersistence: {
        operation: 'r2-put',
        fileName: input.fileName,
        mediaType: input.mediaType,
        fileSize,
        source,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upload file',
    })
  }

  if (!response.key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upload file',
    })
  }

  let storedFile: PersistedFile | undefined

  try {
    storedFile = await db
      .insert(schema.files)
      .values({
        userId: input.userId,
        storageKey: response.key,
        name: input.fileName,
        type: normalizedMediaType,
        size: fileSize,
        source,
        expiresAt,
        originMessageId: input.originMessageId ?? null,
        originProvider: input.originProvider ?? null,
      })
      .returning({
        id: schema.files.id,
        storageKey: schema.files.storageKey,
        name: schema.files.name,
        size: schema.files.size,
        type: schema.files.type,
        source: schema.files.source,
        expiresAt: schema.files.expiresAt,
      })
      .get()
  } catch (exception) {
    logger.set({
      filePersistence: {
        operation: 'db-insert',
        fileName: input.fileName,
        mediaType: input.mediaType,
        fileSize,
        source,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    try {
      await useFileStorage().delete(response.key)
    } catch (rollbackException) {
      logger.set({
        filePersistence: {
          operation: 'r2-rollback',
          fileName: input.fileName,
          mediaType: input.mediaType,
          fileSize,
          source,
          key: response.key,
          error: rollbackException instanceof Error
            ? rollbackException.message
            : String(rollbackException),
        },
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upload file',
    })
  }

  if (!storedFile) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upload file',
    })
  }

  const updatedStorageUsage = await getUserStorageUsageBytes(input.userId)
  const isOverQuotaAfterInsert = (
    updatedStorageUsage > policy.maxStorageBytes
  )

  if (isOverQuotaAfterInsert) {
    await rollbackPersistedFile({
      db,
      userId: input.userId,
      fileId: storedFile.id,
      storageKey: response.key,
      fileName: input.fileName,
      mediaType: input.mediaType,
      fileSize,
      source,
      logger,
    })

    throw createError({
      statusCode: 400,
      statusMessage: 'Not enough storage space. Please delete some files.',
    })
  }

  await invalidateStorageCache(input.userId)

  return storedFile
}

interface RollbackPersistedFileInput {
  db: ReturnType<typeof useDb>
  userId: number
  fileId: string
  storageKey: string
  fileName: string
  mediaType: string
  fileSize: number
  source: FileSource
  logger: ServerLogger
}

async function rollbackPersistedFile(
  input: RollbackPersistedFileInput,
): Promise<void> {
  try {
    await input.db
      .delete(schema.files)
      .where(and(
        eq(schema.files.id, input.fileId),
        eq(schema.files.userId, input.userId),
      ))
  } catch (exception) {
    input.logger.set({
      filePersistence: {
        operation: 'quota-db-rollback',
        fileName: input.fileName,
        mediaType: input.mediaType,
        fileSize: input.fileSize,
        source: input.source,
        key: input.storageKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to upload file',
    })
  }

  try {
    await useFileStorage().delete(input.storageKey)
  } catch (exception) {
    input.logger.set({
      filePersistence: {
        operation: 'quota-r2-rollback',
        fileName: input.fileName,
        mediaType: input.mediaType,
        fileSize: input.fileSize,
        source: input.source,
        key: input.storageKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }
}

function getExpiresAtByRetentionDays(
  retentionDays: number | null,
): Date | null {
  if (retentionDays === null) {
    return null
  }

  return new Date(
    Date.now() + retentionDays * 24 * 60 * 60 * 1000,
  )
}

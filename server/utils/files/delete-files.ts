import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { exceptionMessage, exceptionSummary } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  findKnowledgeProjectIdsForFiles,
  findKnowledgeTextTargetsForFile,
} from '~~/server/utils/knowledge/linked-files'
import type { KnowledgeTextTarget } from '~~/server/utils/knowledge/linked-files'
import { deleteKnowledgeItemTexts } from '~~/server/utils/knowledge/text-store'
import { bumpKnowledgeVersion } from '~~/server/utils/knowledge/version'

type KnowledgeLogSubject = Record<string, string | number>

export type DeleteOwnedFileOutcome = 'deleted' | 'not_found' | 'storage_error'

export interface DeleteOwnedFilesResult {
  deleted: string[]
  notFound: string[]
  failed: string[]
  errored: string[]
}

interface RemovableFile {
  userId: number
  fileId: string
  storageKey: string
}

async function bumpKnowledgeBeforeDelete(
  userId: number,
  fileIds: string[],
  subject: KnowledgeLogSubject,
  logger: LoggerLike,
): Promise<number[]> {
  try {
    const knowledgeProjectIds = await findKnowledgeProjectIdsForFiles(
      userId,
      fileIds,
    )

    await bumpKnowledgeVersion(knowledgeProjectIds)

    return knowledgeProjectIds
  } catch (exception) {
    logger.set({
      attributes: {
        knowledgeVersionBump: {
          phase: 'before-delete',
          ...subject,
          error: exceptionMessage(exception),
        },
      },
    })

    return []
  }
}

async function bumpKnowledgeAfterDelete(
  knowledgeProjectIds: number[],
  subject: KnowledgeLogSubject,
  logger: LoggerLike,
): Promise<void> {
  try {
    await bumpKnowledgeVersion(knowledgeProjectIds)
  } catch (exception) {
    logger.set({
      attributes: {
        knowledgeVersionBump: {
          phase: 'after-delete',
          ...subject,
        },
        knowledgeVersionBumpAfterDelete: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

async function collectKnowledgeTextTargets(
  file: RemovableFile,
  logger: LoggerLike,
): Promise<KnowledgeTextTarget[]> {
  try {
    return await findKnowledgeTextTargetsForFile(file.userId, file.fileId)
  } catch (exception) {
    logger.set({
      attributes: {
        knowledgeTextCleanup: {
          phase: 'collect',
          fileId: file.fileId,
          error: exceptionMessage(exception),
        },
      },
    })

    return []
  }
}

async function deleteKnowledgeTextObjects(
  file: RemovableFile,
  targets: KnowledgeTextTarget[],
  logger: LoggerLike,
): Promise<void> {
  const itemIdsByProject = new Map<number, number[]>()

  for (const target of targets) {
    const itemIds = itemIdsByProject.get(target.projectId) ?? []

    itemIds.push(target.itemId)
    itemIdsByProject.set(target.projectId, itemIds)
  }

  for (const [projectId, itemIds] of itemIdsByProject) {
    try {
      await deleteKnowledgeItemTexts({
        userId: file.userId,
        projectId,
        itemIds,
      })
    } catch (exception) {
      logger.set({
        attributes: {
          knowledgeTextCleanup: {
            phase: 'delete',
            fileId: file.fileId,
            projectId,
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }
}

/**
 * Removes one owned file: its R2 object, the cached data URL, the D1 row
 * and the R2 text objects of the knowledge items that linked it (the row
 * delete cascades those items away, so their text would otherwise be left
 * in R2). Returns `storage_error` without touching D1 when the R2 delete
 * fails, so the file stays listed and can be retried.
 */
async function removeOwnedFile(
  file: RemovableFile,
  logger: LoggerLike,
): Promise<'deleted' | 'storage_error'> {
  try {
    await useFileStorage().delete(file.storageKey)
  } catch (exception) {
    logger.set({
      storage: {
        operation: 'delete',
        fileId: file.fileId,
        key: file.storageKey,
      },
      attributes: {
        storage: {
          error: exceptionMessage(exception),
        },
      },
    })

    return 'storage_error'
  }

  try {
    await invalidateFileCache(file.storageKey)
  } catch (exception) {
    logger.set({
      cache: {
        operation: 'invalidate',
        fileId: file.fileId,
        key: file.storageKey,
      },
      attributes: {
        cache: {
          error: exceptionMessage(exception),
        },
      },
    })
  }

  const knowledgeTextTargets = await collectKnowledgeTextTargets(file, logger)

  await useDb()
    .delete(schema.files)
    .where(and(
      eq(schema.files.id, file.fileId),
      eq(schema.files.userId, file.userId),
    ))

  await deleteKnowledgeTextObjects(file, knowledgeTextTargets, logger)

  return 'deleted'
}

async function findOwnedStorageKey(
  userId: number,
  fileId: string,
): Promise<string | null> {
  const file = await useDb().query.files.findFirst({
    where: {
      id: fileId,
      userId,
    },
    columns: {
      storageKey: true,
    },
  })

  return file?.storageKey ?? null
}

export async function deleteOwnedFile(input: {
  userId: number
  fileId: string
  logger: LoggerLike
}): Promise<DeleteOwnedFileOutcome> {
  const { userId, fileId, logger } = input
  const storageKey = await findOwnedStorageKey(userId, fileId)

  if (storageKey === null) {
    return 'not_found'
  }

  const subject = { fileId }
  const knowledgeProjectIds = await bumpKnowledgeBeforeDelete(
    userId,
    [fileId],
    subject,
    logger,
  )
  const outcome = await removeOwnedFile(
    { userId, fileId, storageKey },
    logger,
  )

  if (outcome === 'storage_error') {
    return outcome
  }

  await bumpKnowledgeAfterDelete(knowledgeProjectIds, subject, logger)
  await invalidateStorageCache(userId)

  return 'deleted'
}

/**
 * Deletes owned files one at a time (a Worker holds at most six
 * simultaneous connections). The knowledge versions of every project that
 * links any of the files are bumped once before and once after, and the
 * storage stats cache is invalidated when at least one file was deleted.
 * A file whose removal throws is listed in `errored` and the loop goes on,
 * so the result always lists what was already deleted.
 */
export async function deleteOwnedFiles(input: {
  userId: number
  fileIds: string[]
  logger: LoggerLike
}): Promise<DeleteOwnedFilesResult> {
  const { userId, fileIds, logger } = input
  const subject = { fileCount: fileIds.length }
  const result: DeleteOwnedFilesResult = {
    deleted: [],
    notFound: [],
    failed: [],
    errored: [],
  }
  const knowledgeProjectIds = await bumpKnowledgeBeforeDelete(
    userId,
    fileIds,
    subject,
    logger,
  )

  for (const fileId of fileIds) {
    try {
      const storageKey = await findOwnedStorageKey(userId, fileId)

      if (storageKey === null) {
        result.notFound.push(fileId)

        continue
      }

      const outcome = await removeOwnedFile(
        { userId, fileId, storageKey },
        logger,
      )

      if (outcome === 'storage_error') {
        result.failed.push(fileId)

        continue
      }

      result.deleted.push(fileId)
    } catch (exception) {
      logger.set({
        attributes: {
          fileDelete: {
            fileId,
            ...exceptionSummary(exception),
          },
        },
      })
      result.errored.push(fileId)
    }
  }

  if (result.deleted.length > 0) {
    await bumpKnowledgeAfterDelete(knowledgeProjectIds, subject, logger)
    await invalidateStorageCache(userId)
  }

  return result
}

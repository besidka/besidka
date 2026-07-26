import type { LoggerLike } from '~~/server/utils/files/logger'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { invalidateStorageCache } from '~~/server/api/v1/storage/index.get'
import { invalidateFileCache } from '~~/server/utils/files/convert-files-for-ai'
import { resolveServerLogger } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const r2BatchDeleteLimit = 1000

// Mirrors the `dataKey` prefix the Better Auth `secondaryStorage` in
// `server/utils/auth.ts` writes every session under: it stores a session as
// `${dataKey}:${token}` and the per-user token list as
// `${dataKey}:active-sessions-${userId}`. Keep both in sync.
const authSecondaryStoragePrefix = 'auth'

function authSecondaryStorageKey(key: string): string {
  return `${authSecondaryStoragePrefix}:${key}`
}

export interface PurgeUserDataInput {
  userId: number
  logger?: LoggerLike
}

export interface PurgeUserDataResult {
  filesFound: number
  storageKeysDeleted: number
  storageBatches: number
  fileCacheKeysInvalidated: number
  imageGenerationLocksDeleted: number
  verificationsDeleted: number
  sessionKeysDeleted: number
}

/**
 * Removes every trace of a user that deleting the `users` row cannot reach.
 *
 * The D1 cascade takes care of the user's own tables, but four classes of
 * data survive it and must be handled here:
 *   - R2 objects behind `files.storageKey` (a D1 cascade never touches R2),
 *   - KV cache entries holding file bytes and storage quota,
 *   - KV session records: `getSession` answers from `secondaryStorage` before
 *     it ever reads D1, so a surviving KV entry keeps a deleted account
 *     authenticated until its TTL expires,
 *   - rows carrying a `userId` with no foreign key to `users`
 *     (`image_generation_locks`, and `verifications` whose `value` is the id).
 *
 * MUST run before the `users` row is deleted: once the cascade removes the
 * `files` rows, the R2 storage keys are gone and the objects are orphaned
 * forever. R2 failures are rethrown so the deletion aborts and stays
 * retryable rather than silently leaving blobs behind.
 */
export async function purgeUserData(
  input: PurgeUserDataInput,
): Promise<PurgeUserDataResult> {
  const { userId } = input
  const logger = resolveServerLogger(input.logger)
  const db = useDb()
  const files = await db.query.files.findMany({
    where: { userId },
    columns: {
      storageKey: true,
    },
  })
  const storageKeys = files.map((file) => {
    return file.storageKey
  })

  let storageBatches = 0

  if (storageKeys.length > 0) {
    const storage = useFileStorage()

    for (
      let index = 0;
      index < storageKeys.length;
      index += r2BatchDeleteLimit
    ) {
      const batch = storageKeys.slice(index, index + r2BatchDeleteLimit)

      try {
        await storage.delete(batch)
      } catch (exception) {
        logger.set({
          accountPurge: {
            phase: 'r2-delete',
            userId,
            batchSize: batch.length,
            completedBatches: storageBatches,
          },
          attributes: {
            accountPurge: {
              error: exceptionMessage(exception),
            },
          },
        })

        throw exception
      }

      storageBatches++
    }
  }

  for (const storageKey of storageKeys) {
    await invalidateFileCache(storageKey, logger)
  }

  await invalidateStorageCache(userId, logger)

  const imageGenerationLocks = await db
    .delete(schema.imageGenerationLocks)
    .where(eq(schema.imageGenerationLocks.userId, userId))
    .returning({
      userId: schema.imageGenerationLocks.userId,
    })

  const verifications = await db
    .delete(schema.verifications)
    .where(eq(schema.verifications.value, String(userId)))
    .returning({
      id: schema.verifications.id,
    })

  const sessions = await db.query.sessions.findMany({
    where: { userId },
    columns: {
      token: true,
    },
  })
  const kv = useKV()
  const sessionStorageKeys = sessions.map((session) => {
    return authSecondaryStorageKey(session.token)
  })

  sessionStorageKeys.push(
    authSecondaryStorageKey(`active-sessions-${userId}`),
  )

  for (const sessionStorageKey of sessionStorageKeys) {
    try {
      await kv.delete(sessionStorageKey)
    } catch (exception) {
      logger.set({
        accountPurge: {
          phase: 'kv-session-delete',
          userId,
        },
        attributes: {
          accountPurge: {
            error: exceptionMessage(exception),
          },
        },
      })

      throw exception
    }
  }

  const result: PurgeUserDataResult = {
    filesFound: files.length,
    storageKeysDeleted: storageKeys.length,
    storageBatches,
    fileCacheKeysInvalidated: storageKeys.length,
    imageGenerationLocksDeleted: imageGenerationLocks.length,
    verificationsDeleted: verifications.length,
    sessionKeysDeleted: sessionStorageKeys.length,
  }

  logger.set({
    accountPurge: {
      phase: 'completed',
      userId,
      ...result,
    },
  })

  return result
}

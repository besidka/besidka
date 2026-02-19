import { useLogger } from 'evlog'
import type { StorageStats } from '#shared/types/files.d'
import {
  getEffectiveUserFilePolicy,
  getGlobalMonthlyTransformStats,
  getUserStorageUsageBytes,
} from '~~/server/utils/files/file-governance'
import {
  resolveServerLogger,
} from '~~/server/utils/files/logger'
import type { LoggerLike } from '~~/server/utils/files/logger'

const CACHE_TTL_SECONDS = 60

function getStorageCacheKey(userId: number): string {
  return `storage-stats:${userId}`
}

export default defineEventHandler(async (event): Promise<StorageStats> => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const kv = useKV()
  const cacheKey = getStorageCacheKey(userId)

  try {
    const cached = await kv.get<StorageStats>(cacheKey, 'json')

    if (cached) {
      return cached
    }
  } catch (exception) {
    logger.set({
      cache: {
        operation: 'read',
        key: cacheKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }

  const policy = await getEffectiveUserFilePolicy(userId)
  const used = await getUserStorageUsageBytes(userId)
  const globalTransformStats = await getGlobalMonthlyTransformStats()
  const total = policy.maxStorageBytes

  const percentage = total > 0 ? Math.round((used / total) * 100) : 0

  const stats: StorageStats = {
    used,
    total,
    percentage,
    tier: policy.tier,
    maxStorageBytes: policy.maxStorageBytes,
    maxFilesPerMessage: policy.maxFilesPerMessage,
    maxMessageFilesBytes: policy.maxMessageFilesBytes,
    fileRetentionDays: policy.fileRetentionDays,
    imageTransformLimitTotal: policy.imageTransformLimitTotal,
    imageTransformUsedTotal: policy.imageTransformUsedTotal,
    globalTransformRemainingMonth: globalTransformStats.remaining,
  }

  try {
    await kv.put(cacheKey, JSON.stringify(stats), {
      expirationTtl: CACHE_TTL_SECONDS,
    })
  } catch (exception) {
    logger.set({
      cache: {
        operation: 'write',
        key: cacheKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }

  return stats
})

export async function invalidateStorageCache(
  userId: number,
  logger?: LoggerLike,
): Promise<void> {
  const activeLogger = resolveServerLogger(logger)
  const cacheKey = getStorageCacheKey(userId)

  try {
    const kv = useKV()

    await kv.delete(cacheKey)
  } catch (exception) {
    activeLogger.set({
      cache: {
        operation: 'invalidate',
        key: cacheKey,
        error: exception instanceof Error
          ? exception.message
          : String(exception),
      },
    })
  }
}

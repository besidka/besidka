import type { FilePolicyResponse } from '#shared/types/files.d'
import { useLogger } from 'evlog'
import {
  getEffectiveUserFilePolicy,
  getGlobalMonthlyTransformStats,
} from '~~/server/utils/files/file-governance'

const CACHE_TTL_SECONDS = 60

export function getFilePolicyCacheKey(userId: number): string {
  return `file-policy:${userId}`
}

export default defineEventHandler(async (
  event,
): Promise<FilePolicyResponse> => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const kv = useKV()
  const cacheKey = getFilePolicyCacheKey(userId)

  try {
    const cached = await kv.get<FilePolicyResponse>(cacheKey, 'json')

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

  const [policy, globalTransformStats] = await Promise.all([
    getEffectiveUserFilePolicy(userId),
    getGlobalMonthlyTransformStats(),
  ])

  const response: FilePolicyResponse = {
    policy,
    globalTransformRemainingMonth: globalTransformStats.remaining,
  }

  try {
    await kv.put(cacheKey, JSON.stringify(response), {
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

  return response
})

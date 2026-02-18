import type { FilePolicyResponse } from '#shared/types/files.d'
import {
  getEffectiveUserFilePolicy,
  getGlobalMonthlyTransformStats,
} from '~~/server/utils/files/file-governance'

export default defineEventHandler(async (): Promise<FilePolicyResponse> => {
  const session = await useUserSession()

  if (!session) {
    throw useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)
  const policy = await getEffectiveUserFilePolicy(userId)
  const globalTransformStats = await getGlobalMonthlyTransformStats()

  return {
    policy,
    globalTransformRemainingMonth: globalTransformStats.remaining,
  }
})

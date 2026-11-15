import { defineEventHandler } from 'nuxt/server'
import {
  requireChatToolApprovalAccess,
  resetChatToolApprovalGrants,
} from '~~/server/utils/tool-approval/grants'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * Clears every "Allow in this chat" grant of this chat, so the next call of
 * each tool asks again. "Always allow" grants are removed one by one with
 * `revoke`.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireChatToolApprovalAccess(
    event,
    { write: true },
  )
  const cleared = await resetChatToolApprovalGrants(
    useDb(),
    userId,
    chatPublicId,
  )

  useRequestLogger(event).set({
    attributes: { toolApproval: { chatGrantsReset: cleared } },
  })

  return { ok: true }
})

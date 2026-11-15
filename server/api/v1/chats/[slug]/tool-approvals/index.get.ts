import { defineEventHandler } from 'nuxt/server'
import type { ChatToolApprovalGrants } from '#shared/types/tool-approval-grants.d'
import {
  listChatToolApprovalGrants,
  requireChatToolApprovalAccess,
} from '~~/server/utils/tool-approval/grants'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * The approvals the user gave that still apply in this chat ("Allow in
 * this chat" and "Always allow"), for the chat context panel.
 */
export default defineEventHandler(async (event) => {
  const { userId, chatPublicId } = await requireChatToolApprovalAccess(
    event,
    { write: false },
  )
  const grants = await listChatToolApprovalGrants(
    useDb(),
    userId,
    chatPublicId,
  )

  useRequestLogger(event).set({
    attributes: { toolApproval: { grantsListed: grants.length } },
  })

  return { grants } satisfies ChatToolApprovalGrants
})

import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  requireChatToolApprovalAccess,
  revokeAlwaysToolApprovalGrant,
} from '~~/server/utils/tool-approval/grants'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  connectorId: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
  toolName: z.string().min(1).max(256),
})

/**
 * Sets one connector tool back to "Needs approval" in every chat, removing
 * its "Always allow" grant. Listed in the chat context panel next to the
 * chat's grants.
 */
export default defineEventHandler(async (event) => {
  const { userId } = await requireChatToolApprovalAccess(event, {
    write: true,
  })
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)
  const isRevoked = await revokeAlwaysToolApprovalGrant(useDb(), userId, body)

  logger.set({
    attributes: {
      toolApproval: {
        alwaysGrantRevoke: isRevoked ? 'revoked' : 'not-found',
        connectorId: body.connectorId,
      },
    },
  })

  if (!isRevoked) {
    throw createError({
      message: 'Approval not found.',
      status: 404,
      why: 'No tool setting of this account matches the connector and tool',
    })
  }

  return { ok: true }
})

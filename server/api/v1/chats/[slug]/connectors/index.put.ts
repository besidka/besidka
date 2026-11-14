import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTORS_PER_USER } from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  persistChatConnectorSelection,
  resolveConnectorSelection,
} from '~~/server/utils/connectors/chat-selection'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { listConnectors } from '~~/server/utils/connectors/store'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  connectorIds: z.array(z.string().max(64)).max(CONNECTORS_PER_USER),
})

/**
 * Replaces the set of connectors this chat has switched on. Every id must
 * be a connector of the account that is on and connected; at most five can
 * be on at once.
 */
export default defineEventHandler(async (event) => {
  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const userId = await requireConnectorAccess(event, { selection: true })
  const body = await readConnectorBody(event, bodySchema)
  const db = useDb()
  const chat = await db.query.chats.findFirst({
    where: { slug: params.data.slug, userId },
    columns: { id: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  const connectors = await listConnectors(db, userId)
  const selection = resolveConnectorSelection(connectors, body.connectorIds)

  if (selection.unknownIds.length > 0) {
    throw createConnectorError('CONNECTOR_NOT_FOUND')
  }

  if (selection.skipped.length > 0) {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  if (selection.overCap.length > 0) {
    throw createError({
      message: 'Too many connectors for one chat',
      status: 409,
      code: 'CONNECTORS_PER_CHAT_LIMIT',
      why: 'A chat can use at most 5 connectors at a time',
      fix: 'Switch one off before turning another on',
    })
  }

  const selectedIds = selection.selected.map(connector => connector.id)

  await persistChatConnectorSelection(db, {
    userId,
    chatPublicId: chat.id,
    selectedIds,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: { step: 'chat-selection', selected: selectedIds.length },
    },
  })

  return { connectorIds: selectedIds }
})

import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { listChatConnectorIds } from '~~/server/utils/connectors/chat-selection'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'

/**
 * The connector ids this chat has switched on, as stored per chat so that
 * every device sees the same choice.
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

  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })
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

  return { connectorIds: await listChatConnectorIds(db, userId, chat.id) }
})

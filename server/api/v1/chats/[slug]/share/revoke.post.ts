import { createError } from 'evlog'
import { revokeChatShares } from '~~/server/utils/chats/share-management'
import { defineEventHandler } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsRules = z.object({
  slug: z.ulid(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const params = paramsRules.safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  logger.set({ userId, chatSlug: params.data.slug })

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const { deletedCount } = await revokeChatShares(db, userId, [chat.id])

  logger.set({ revokedCount: deletedCount })

  return { ok: true }
})

import { createError } from 'evlog'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { checkSharedChatForPii } from '~~/server/utils/chats/share-pii-check'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

const paramsRules = z.object({
  slug: z.ulid(),
})

const bodyRules = z.object({
  showFiles: z.boolean(),
  showMetadata: z.boolean(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const params = paramsRules.safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, bodyRules.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)

  await enforceMemoryRateLimit('share-check', userId, event)

  logger.set({
    userId,
    chatSlug: params.data.slug,
  })

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      title: true,
    },
    with: {
      messages: {
        columns: {
          role: true,
          parts: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  return await checkSharedChatForPii({
    db,
    userId,
    title: chat.title,
    messages: chat.messages,
    showFiles: body.data.showFiles,
    logger,
  })
})

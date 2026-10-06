import { createError } from 'evlog'
import {
  enumerateChatFileIds,
  getActiveShareForChat,
} from '~~/server/utils/chats/share'
import { defineEventHandler, getRouterParams } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const paramsRules = z.object({
  slug: z.ulid(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const params = paramsRules.safeParse(getRouterParams(event, { decode: true }))

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

  const userId = parseInt(session.user.id)

  logger.set({ userId, chatSlug: params.data.slug })

  const chat = await useDb().query.chats.findFirst({
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

  const fileIds = await enumerateChatFileIds(chat.id, userId)
  const hasFiles = fileIds.length > 0

  const share = await getActiveShareForChat(chat.id)

  if (!share) {
    return { share: null, hasFiles }
  }

  const baseUrl = (useRuntimeConfig().public.baseUrl as string)
    .replace(/\/$/, '')

  return {
    hasFiles,
    share: {
      slug: share.slug,
      url: share.slug ? `${baseUrl}/shared/${share.slug}` : null,
      expiresAt: share.expiresAt,
      indexable: share.indexable,
      showFiles: share.showFiles,
      showMetadata: share.showMetadata,
      showAuthorAvatar: share.showAuthorAvatar,
      allowBranch: share.allowBranch,
    },
  }
})

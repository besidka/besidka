import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { loadOwnedChatContext } from '~~/server/utils/chats/context/load-chat-context'

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

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const logger = useRequestLogger(event)
  const context = await loadOwnedChatContext(
    useDb(),
    parseInt(session.user.id),
    params.data.slug,
  )

  if (!context) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  logger.set({
    chatContext: {
      outputs: context.counts.outputs,
      inputs: context.counts.inputs,
      used: context.counts.used,
    },
  })

  return context
})

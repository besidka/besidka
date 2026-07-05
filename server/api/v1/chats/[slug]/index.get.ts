import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { rewriteShareFileParts } from '~~/server/utils/files/rewrite-share-file-urls'

export default defineEventHandler(async (event) => {
  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
  }).safeParse)

  if (params.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request parameters',
      data: params.error,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const chat = await useDb().query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId: parseInt(session.user.id),
    },
    columns: {
      id: true,
      slug: true,
      title: true,
      projectId: true,
      forkedFromShareSlug: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          publicId: true,
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
          createdAt: true,
          usage: true,
        },
      },
    },
  })

  if (!chat) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Chat not found.',
    })
  }

  const messages = chat.messages
    .filter((message) => {
      return isPersistedMessageRole(message.role)
    })
    .map(message => ({
      ...message,
      id: message.publicId ?? message.id,
    }))

  const sourceShare = chat.forkedFromShareSlug
    ? await resolveActiveShareBySlug(chat.forkedFromShareSlug, event)
    : null

  const resolvedMessages = sourceShare
    ? await rewriteShareFileParts(messages, sourceShare.id, event)
    : messages

  return {
    ...chat,
    messages: resolvedMessages,
  }
})

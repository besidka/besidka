import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { resolveActiveShareBySlug } from '~~/server/utils/chats/share'
import { rewriteBranchedChatFileParts } from '~~/server/utils/files/rewrite-share-file-urls'
import { toResearchJobView } from '~~/server/utils/research/job-view'

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

  const userId = parseInt(session.user.id)
  const db = useDb()

  const chat = await db.query.chats.findFirst({
    where: {
      slug: params.data.slug,
      userId,
    },
    columns: {
      id: true,
      slug: true,
      title: true,
      projectId: true,
      branchedFromShareSlug: true,
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

  const sourceShare = chat.branchedFromShareSlug
    ? await resolveActiveShareBySlug(chat.branchedFromShareSlug, event)
    : null

  const resolvedMessages = chat.branchedFromShareSlug
    ? await rewriteBranchedChatFileParts(
      messages,
      userId,
      sourceShare?.id ?? null,
      event,
    )
    : messages

  const activeJob = await db.query.researchJobs.findFirst({
    where: {
      chatId: chat.id,
      status: { in: ['pending', 'running'] },
    },
    orderBy: { id: 'desc' },
  })

  return {
    ...chat,
    messages: resolvedMessages,
    activeResearchJob: activeJob ? toResearchJobView(activeJob) : null,
  }
})

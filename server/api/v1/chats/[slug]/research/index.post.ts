import type { UIMessage } from 'ai'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { useLogger, createError } from 'evlog'
import { persistUserMessage } from '~~/server/utils/chats/persist-user-message'
import { startResearchJobForChat } from '~~/server/utils/research/start'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const params = await getValidatedRouterParams(event, z.object({
    slug: z.ulid(),
  }).safeParse)

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, z.object({
    model: z.string().nonempty(),
    level: z.enum(['quick', 'thorough']),
    userMessage: z.object({
      id: z.string().nonempty(),
      parts: z.array(z.any()).min(1),
    }),
    answers: z.array(z.object({
      id: z.string(),
      question: z.string().max(500),
      answer: z.string().max(2000),
    })).max(12).optional(),
  }).safeParse)

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
      projectId: true,
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
        },
        orderBy: { id: 'asc' },
      },
    },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  logger.set({
    userId,
    chatId: chat.id,
    operation: 'research-start',
    level: body.data.level,
    hasAnswers: Boolean(body.data.answers?.length),
  })

  const previousMessages = chat.messages
    .filter((message) => {
      return isPersistedMessageRole(message.role)
    })
    .map(message => ({
      id: message.publicId ?? message.id,
      role: message.role,
      parts: message.parts,
      tools: message.tools,
      reasoning: message.reasoning,
    }))

  await persistUserMessage({
    db,
    event,
    logger,
    userId,
    chat: {
      id: chat.id,
      projectId: chat.projectId,
      messages: chat.messages,
    },
    previousMessages,
    newMessage: {
      id: body.data.userMessage.id,
      parts: body.data.userMessage.parts as UIMessage['parts'],
    },
    tools: [],
    reasoning: 'off',
  })

  const result = await startResearchJobForChat({
    db,
    event,
    logger,
    userId,
    chat: {
      id: chat.id,
      slug: chat.slug,
      projectId: chat.projectId,
    },
    userMessage: {
      id: body.data.userMessage.id,
      parts: body.data.userMessage.parts as UIMessage['parts'],
    },
    model: body.data.model,
    level: body.data.level,
    answers: body.data.answers,
  })

  logger.set({ jobId: result.jobId, jobStatus: result.status })

  return result
})

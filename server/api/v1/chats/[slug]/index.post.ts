import type { LanguageModelV1, CoreMessage } from 'ai'
import { streamText } from 'ai'
import * as schema from '~~/server/db/schema'

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

  const body = await readValidatedBody(event, z.object({
    id: z.string().nonempty(),
    model: z.string().nonempty(),
    messages: z.array(
      z.object({
        id: z.string().nonempty(),
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().nonempty(),
      }).partial(),
    ).min(1, 'At least one message is required'),
  }).safeParse)

  if (body.error) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid request body',
      data: body.error,
    })
  }

  const session = await useUserSession(event)

  if (!session) {
    return useUnathorizedError()
  }

  const db = useDb()
  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, parseInt(session.user.id)),
      )
    },
    columns: {
      id: true,
    },
    with: {
      messages: {
        columns: {
          role: true,
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

  const { messages } = body.data
  const lastMessage = messages[messages.length - 1]

  if (
    lastMessage
    && lastMessage.role === 'user'
    && messages.length > 1
    && lastMessage.content?.trim().length
  ) {
    await db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        role: 'user',
        content: lastMessage.content,
      })
  }

  const { provider, model } = useChatProvider(event)

  let instance: LanguageModelV1

  switch (provider.id) {
    case 'openai': {
      const {
        instance: openAiInstance,
      } = await useOpenAI(session.user.id, model)

      instance = openAiInstance
      break
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported provider',
      })
  }

  return streamText({
    model: instance,
    messages: body.data.messages as CoreMessage[],
    async onFinish(response) {
      await db.insert(schema.messages).values({
        chatId: chat.id,
        role: 'assistant',
        content: response.text,
      })
    },
  }).toDataStreamResponse()
})

import type { LanguageModelV1, CoreMessage } from 'ai'
import type { FormattedTools } from '~~/server/types/tools.d'
import { streamText, smoothStream } from 'ai'
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
    model: z.string().nonempty(),
    tools: z.array(z.enum(['web_search'])),
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

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
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
          tools: true,
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
        tools: body.data.tools,
      })
  }

  const { provider, model } = useChatProvider()
  const requestedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : body.data.tools

  let instance: LanguageModelV1
  let parsedTools: FormattedTools = {}

  switch (provider.id) {
    case 'openai': {
      const {
        instance: openAiInstance,
        tools: openAiTools,
      } = await useOpenAI(
        session.user.id,
        model.id,
        requestedTools,
      )

      instance = openAiInstance
      parsedTools = openAiTools
      break
    }
    case 'google': {
      const {
        instance: googleInstance,
      } = await useGoogle(
        session.user.id,
        model.id,
        requestedTools,
      )

      instance = googleInstance
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
    experimental_transform: smoothStream(),
    ...parsedTools,
    async onFinish(response) {
      await db.insert(schema.messages).values({
        chatId: chat.id,
        role: 'assistant',
        content: response.text,
        tools: body.data.tools,
      })
    },
    onError(error) {
      // eslint-disable-next-line no-console
      console.error(error)
    },
  }).toDataStreamResponse({
    getErrorMessage: errorHandler,
  })
})

function errorHandler(error: unknown) {
  if (error == null) {
    return 'An error occurred while processing the chat.'
  }

  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return JSON.stringify(error)
}

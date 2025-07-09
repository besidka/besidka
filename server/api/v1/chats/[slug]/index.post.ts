import type { LanguageModel, ProviderOptions } from 'ai'
import type { FormattedTools } from '~~/server/types/tools.d'
import { streamText, smoothStream, convertToModelMessages } from 'ai'
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
        createdAt: z.coerce.date().optional(),
        annotations: z.array(z.string()).optional(),
        parts: z.array(z.any()).min(1, 'At least one part is required'),
        experimental_attachments: z.array(
          z.object({
            name: z.string().optional(),
            contentType: z.string().optional(),
            url: z.string().nonempty(),
          }),
        ).optional(),
      }),
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
  ) {
    await db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        role: 'user',
        parts: lastMessage.parts,
        tools: body.data.tools,
      })
  }

  const { provider, model } = useChatProvider()
  const requestedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : body.data.tools

  let instance: LanguageModel
  let parsedTools: FormattedTools = {}
  let providerOptions: ProviderOptions = {}

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
        providerOptions: googleProviderOptions,
      } = await useGoogle(
        session.user.id,
        model.id,
        requestedTools,
      )

      instance = googleInstance
      providerOptions = googleProviderOptions
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
    messages: convertToModelMessages(body.data.messages),
    experimental_transform: smoothStream(),
    ...parsedTools,
    providerOptions,
    async onFinish(response) {
      await db.insert(schema.messages).values({
        chatId: chat.id,
        role: 'assistant',
        parts: [{
          type: 'text',
          text: response.text,
        }],
        tools: body.data.tools,
      })
    },
    onError(error) {
      // eslint-disable-next-line no-console
      console.error(error)
    },
  }).toUIMessageStreamResponse({
    onError: errorHandler,
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

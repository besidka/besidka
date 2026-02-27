import type { LanguageModel, UIMessage } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { FormattedTools } from '~~/server/types/tools.d'
import { useLogger } from 'evlog'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  smoothStream,
  convertToModelMessages,
} from 'ai'
import * as schema from '~~/server/db/schema'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import {
  normalizeAssistantMessagePartsForPersistence as normalizeAssistantParts,
  sanitizeMessagesForModelContext,
} from '~~/server/utils/files/assistant-files'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
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
    reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
    messages: z.array(
      z.object({
        id: z.string().nonempty(),
        role: z.enum(['system', 'user', 'assistant']),
        createdAt: z.coerce.date().optional(),
        annotations: z.array(z.string()).optional(),
        parts: z.array(z.any()),
        tools: z.array(z.any()).optional(),
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

  const userId = parseInt(session.user.id)

  const db = useDb()
  const chat = await db.query.chats.findFirst({
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
    },
    columns: {
      id: true,
    },
    with: {
      messages: {
        columns: {
          id: true,
          role: true,
          parts: true,
          tools: true,
          reasoning: true,
          createdAt: true,
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

  const { messages: newMessages, model: userModel } = body.data
  const newMessage = newMessages[0]

  if (!newMessage) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No message provided',
    })
  }

  const previousMessages = chat.messages.map(message => ({
    id: message.id,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt,
    tools: message.tools,
    reasoning: message.reasoning,
  }))

  const allMessages = [...previousMessages, newMessage]
  const modelContextMessages = sanitizeMessagesForModelContext(allMessages)

  if (!newMessage.parts || newMessage.parts.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message must include at least one part (text or file)',
    })
  }

  await validateMessageFilePolicy(
    userId,
    newMessage.parts as UIMessage['parts'],
  )

  const {
    messages: messagesForAI,
    missingFiles,
  } = await convertFilesForAI(modelContextMessages)

  const lastPersistedMessage = previousMessages[previousMessages.length - 1]
  const isDuplicateUserMessage = (
    newMessage.role === 'user'
    && lastPersistedMessage?.role === 'user'
    && hasSameParts(
      lastPersistedMessage.parts as UIMessage['parts'],
      newMessage.parts as UIMessage['parts'],
    )
    && hasSameTools(lastPersistedMessage.tools, body.data.tools)
    && lastPersistedMessage.reasoning === body.data.reasoning
  )

  if (newMessage.role === 'user' && !isDuplicateUserMessage) {
    await db
      .insert(schema.messages)
      .values({
        chatId: chat.id,
        role: 'user',
        parts: newMessage.parts,
        tools: body.data.tools,
        reasoning: body.data.reasoning,
      })
  }

  const { provider, model } = useChatProvider(userModel)
  const requestedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : body.data.tools

  let instance: LanguageModel
  let parsedTools: FormattedTools = {}
  const providerOptions: SharedV2ProviderOptions = {}

  switch (provider.id) {
    case 'openai': {
      const {
        instance: openAiInstance,
        tools: openAiTools,
        providerOptions: openAiProviderOptions,
      } = await useOpenAI(
        session.user.id,
        model.id,
        requestedTools,
        body.data.reasoning,
      )

      instance = openAiInstance
      parsedTools = openAiTools
      Object.assign(providerOptions, {
        openai: openAiProviderOptions,
      })

      break
    }
    case 'google': {
      const {
        instance: googleInstance,
        tools: googleTools,
        providerOptions: googleProviderOptions,
      } = await useGoogle(
        session.user.id,
        model.id,
        requestedTools,
        body.data.reasoning,
      )

      instance = googleInstance
      parsedTools = googleTools
      Object.assign(providerOptions, {
        google: googleProviderOptions,
      })

      break
    }
    default:
      throw createError({
        statusCode: 400,
        statusMessage: 'Unsupported provider',
      })
  }

  const stream = createUIMessageStream({
    async execute({ writer }) {
      if (missingFiles.length > 0) {
        writer.write({
          type: 'data-missing-files',
          data: {
            count: missingFiles.length,
            filenames: missingFiles
              .map(file => file.filename)
              .filter((name): name is string => Boolean(name)),
          },
        })
      }

      const result = streamText({
        model: instance,
        messages: await convertToModelMessages(messagesForAI),
        experimental_transform: smoothStream(),
        ...parsedTools,
        providerOptions,
      })

      result.consumeStream()

      writer.merge(result.toUIMessageStream({
        originalMessages: messagesForAI,
        sendSources: true,
        sendReasoning: body.data.reasoning !== 'off',
        onError: errorHandler,
        async onFinish({ isAborted, responseMessage }) {
          if (isAborted) {
            return
          }

          if ('id' in responseMessage) {
            // @ts-expect-error
            delete responseMessage.id
          }

          const normalizationInput = {
            parts: responseMessage.parts as UIMessage['parts'],
            providerId: provider.id,
            chatId: chat.id,
            userId,
            logger,
          }
          const normalizedParts = await normalizeAssistantParts(
            normalizationInput,
          )

          await db.insert(schema.messages).values({
            chatId: chat.id,
            ...responseMessage,
            parts: normalizedParts,
            reasoning: body.data.reasoning,
          })
        },
      }))
    },
  })

  return createUIMessageStreamResponse({
    stream,
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

function hasSameParts(
  leftParts: UIMessage['parts'],
  rightParts: UIMessage['parts'],
): boolean {
  return JSON.stringify(leftParts || []) === JSON.stringify(rightParts || [])
}

function hasSameTools(
  leftTools: Array<'web_search'>,
  rightTools: Array<'web_search'>,
): boolean {
  return JSON.stringify(leftTools || []) === JSON.stringify(rightTools || [])
}

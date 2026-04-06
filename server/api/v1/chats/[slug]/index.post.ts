import type { LanguageModel, UIMessage } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { FormattedTools } from '~~/server/types/tools.d'
import { useLogger, createError } from 'evlog'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  smoothStream,
  convertToModelMessages,
} from 'ai'
import * as schema from '~~/server/db/schema'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import {
  normalizeAssistantMessagePartsForPersistence as normalizeAssistantParts,
  sanitizeMessagesForModelContext,
} from '~~/server/utils/files/assistant-files'
import { resolveDataUrlsInModelMessages } from '~~/server/utils/files/resolve-data-urls'
import { buildProjectInstructionsMessage } from '~~/server/utils/projects/instructions'
import { markProjectsMemoryStale } from '~~/server/utils/projects/memory'

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
    where(chats, { and, eq }) {
      return and(
        eq(chats.slug, params.data.slug),
        eq(chats.userId, userId),
      )
    },
    columns: {
      id: true,
      projectId: true,
    },
    with: {
      project: {
        columns: {
          id: true,
          name: true,
          instructions: true,
          memory: true,
          memoryStatus: true,
        },
      },
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
    projectId: chat.projectId,
    reasoning: body.data.reasoning,
    tools: body.data.tools,
  })

  const { messages: newMessages, model: userModel } = body.data
  const newMessage = newMessages[0]

  if (!newMessage) {
    throw createError({
      message: 'No message provided',
      status: 400,
    })
  }

  const previousMessages = chat.messages.map(message => ({
    id: message.publicId ?? message.id,
    role: message.role,
    parts: message.parts,
    createdAt: message.createdAt,
    tools: message.tools,
    reasoning: message.reasoning,
  }))

  const allMessages = [...previousMessages, newMessage]
  const modelContextMessages = sanitizeMessagesForModelContext(allMessages)
  const projectInstructionsMessage = buildProjectInstructionsMessage(
    chat.project
      ? {
        name: chat.project.name,
        instructions: chat.project.instructions,
        memory: chat.project.memory,
        memoryStatus: chat.project.memoryStatus,
      }
      : null,
  )
  const contextMessages = projectInstructionsMessage
    ? [projectInstructionsMessage, ...modelContextMessages]
    : modelContextMessages

  if (!newMessage.parts || newMessage.parts.length === 0) {
    throw createError({
      message: 'Message must include at least one part (text or file)',
      status: 400,
    })
  }

  await validateMessageFilePolicy(
    userId,
    newMessage.parts as UIMessage['parts'],
  )

  const {
    messages: messagesForAI,
    missingFiles,
  } = await convertFilesForAI(contextMessages)

  logger.set({
    filesCount: newMessage.parts.filter(part => part.type === 'file').length,
    missingFilesCount: missingFiles.length,
  })

  const lastPersistedMessage = previousMessages[previousMessages.length - 1]
  const isDuplicateUserMessage = (
    newMessage.role === 'user'
    && lastPersistedMessage?.role === 'user'
    && (
      newMessage.id === lastPersistedMessage.id
      || (
        hasSameParts(
          lastPersistedMessage.parts as UIMessage['parts'],
          newMessage.parts as UIMessage['parts'],
        )
        && hasSameTools(
          lastPersistedMessage.tools,
          body.data.tools,
        )
        && lastPersistedMessage.reasoning
        === body.data.reasoning
      )
    )
  )

  if (newMessage.role === 'user') {
    if (!isDuplicateUserMessage) {
      const activityAt = new Date()

      try {
        await insertMessageWithPublicId({
          db,
          values: {
            chatId: chat.id,
            role: 'user',
            parts: newMessage.parts,
            tools: body.data.tools,
            reasoning: body.data.reasoning,
          },
          publicId: newMessage.id,
        })

        await db.update(schema.chats)
          .set({ activityAt })
          .where(eq(schema.chats.id, chat.id))

        if (chat.projectId) {
          await db.update(schema.projects)
            .set({ activityAt })
            .where(eq(schema.projects.id, chat.projectId))

          await markProjectsMemoryStale([chat.projectId], userId, db)
        }
      } catch (exception) {
        logger.set({
          stage: 'persist-user-message',
          errorCode: 'message-persist-failed',
          errorMessage: exception instanceof Error
            ? exception.message
            : String(exception),
        })

        throw createError({
          ...normalizeChatError({
            error: exception,
            event,
            code: 'message-persist-failed',
            message: 'The message could not be saved.',
          }),
        })
      }
    } else {
      const lastMessage = chat.messages[chat.messages.length - 1]

      if (lastMessage) {
        await db.update(schema.messages)
          .set({ publicId: newMessage.id })
          .where(eq(schema.messages.id, lastMessage.id))
      }
    }
  }

  const { provider, model } = useChatProvider(userModel)
  const requestedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : body.data.tools
  const providerId = toSupportedProviderId(provider.id)

  logger.set({
    providerId: provider.id,
    modelId: model.id,
  })

  let instance: LanguageModel
  let parsedTools: FormattedTools = {}
  const providerOptions: SharedV2ProviderOptions = {}

  try {
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
          message: 'Unsupported provider',
          status: 400,
        })
    }
  } catch (exception) {
    const chatError = normalizeChatError({
      error: exception,
      event,
      providerId,
    })

    logger.set({
      stage: 'prepare-provider',
      errorCode: chatError.code,
      providerStatus: chatError.status,
      providerRequestId: chatError.providerRequestId,
      errorMessage: chatError.why,
    })

    return new Response(JSON.stringify(chatError), {
      status: chatError.status || 500,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  const stream = createUIMessageStream({
    async execute({ writer }) {
      const messagePublicId = ulid()

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

      let result: ReturnType<typeof streamText>

      try {
        result = streamText({
          model: instance,
          messages: resolveDataUrlsInModelMessages(
            await convertToModelMessages(messagesForAI),
          ),
          experimental_transform: smoothStream(),
          ...parsedTools,
          providerOptions,
        })
      } catch (exception) {
        const chatError = normalizeChatError({
          error: exception,
          event,
          providerId,
        })

        logger.set({
          stage: 'start-stream',
          errorCode: chatError.code,
          providerStatus: chatError.status,
          providerRequestId: chatError.providerRequestId,
          errorMessage: chatError.why,
        })

        throw chatError
      }

      result.consumeStream()

      writer.merge(result.toUIMessageStream({
        originalMessages: messagesForAI,
        generateMessageId: () => messagePublicId,
        sendSources: true,
        sendReasoning: body.data.reasoning !== 'off',
        onError(error) {
          const chatError = normalizeChatError({
            error,
            event,
            providerId,
          })

          logger.set({
            stage: 'stream',
            errorCode: chatError.code,
            providerStatus: chatError.status,
            providerRequestId: chatError.providerRequestId,
            errorMessage: chatError.why,
          })

          return JSON.stringify(chatError)
        },
        async onFinish({ isAborted, responseMessage }) {
          if (isAborted) {
            return
          }

          try {
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

            await insertMessageWithPublicId({
              db,
              values: {
                chatId: chat.id,
                role: 'assistant',
                parts: normalizedParts,
                tools: [],
                reasoning: body.data.reasoning,
              },
              publicId: messagePublicId,
            })
          } catch (exception) {
            const chatError = normalizeChatError({
              error: exception,
              event,
              providerId,
              code: 'message-persist-failed',
              message: 'The response could not be saved.',
            })

            logger.set({
              stage: 'persist-assistant-message',
              errorCode: chatError.code,
              providerStatus: chatError.status,
              providerRequestId: chatError.providerRequestId,
              errorMessage: chatError.why,
            })

            throw chatError
          }
        },
      }))
    },
  })

  return createUIMessageStreamResponse({
    stream,
  })
})

async function insertMessageWithPublicId(input: {
  db: ReturnType<typeof useDb>
  values: typeof schema.messages.$inferInsert
  publicId: string
}) {
  return await input.db
    .insert(schema.messages)
    .values({
      ...input.values,
      publicId: input.publicId,
    })
    .returning({
      id: schema.messages.id,
      publicId: schema.messages.publicId,
    })
    .get()
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

function toSupportedProviderId(
  providerId: string,
): 'openai' | 'google' | undefined {
  if (
    providerId !== 'openai'
    && providerId !== 'google'
  ) {
    return undefined
  }

  return providerId
}

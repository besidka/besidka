import type { LanguageModel, UIMessage } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { H3Event } from 'h3'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import type { FormattedTools } from '~~/server/types/tools.d'
import { useLogger, createError, createRequestLogger, log } from 'evlog'
import { createAILogger, createEvlogIntegration } from 'evlog/ai'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  smoothStream,
  convertToModelMessages,
  readUIMessageStream,
} from 'ai'
import * as schema from '~~/server/db/schema'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { filterRecoverableUIMessageStreamErrors } from '~~/server/utils/chats/filter-ui-message-stream'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import {
  normalizeAssistantMessagePartsForPersistence as normalizeAssistantParts,
  sanitizeMessagesForModelContext,
} from '~~/server/utils/files/assistant-files'
import { resolveDataUrlsInModelMessages } from '~~/server/utils/files/resolve-data-urls'
import { buildProjectSystemPrompt } from '~~/server/utils/projects/instructions'
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
        role: z.enum(['user', 'assistant']),
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

  const previousMessages = chat.messages
    .filter((message) => {
      return isPersistedMessageRole(message.role)
    })
    .map(message => ({
      id: message.publicId ?? message.id,
      role: message.role,
      parts: message.parts,
      createdAt: message.createdAt,
      tools: message.tools,
      reasoning: message.reasoning,
    }))

  const allMessages = [...previousMessages, newMessage]
  const modelContextMessages = sanitizeMessagesForModelContext(allMessages)
  const projectSystemPrompt = buildProjectSystemPrompt(chat.project
    ? {
      name: chat.project.name,
      instructions: chat.project.instructions,
      memory: chat.project.memory,
      memoryStatus: chat.project.memoryStatus,
    }
    : null)

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
  } = await convertFilesForAI(modelContextMessages)

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

  // @TODO Replace `aiLogger` + this manual emit with
  //   `logger.fork('ai-stream', async () => { ... })`
  //   once evlog ships `fork()` support for the Nuxt/Nitro integration.
  //
  // Why we use a dedicated request logger here:
  //   Nuxt/Nitro emits the parent request wide event when the handler returns
  //   the streaming Response — which happens BEFORE the AI stream finishes.
  //   `createAILogger`'s middleware then writes `ai.{tokens, cost, ...}` onto
  //   the parent logger, which is already sealed, so evlog drops the keys
  //   and prints:
  //     "[evlog] log.set() called after the wide event was emitted —
  //      Keys dropped: ai. ... use log.fork('label', fn) when your
  //      integration supports it"
  //   `log.fork()` is currently attached only by Next.js, SvelteKit, Hono,
  //   Express, Fastify, NestJS, Elysia integrations — see the integration
  //   whitelist in evlog/dist/integration-*.mjs. The Nitro adapter does not
  //   call `attachForkToLogger`, so `logger.fork` is `undefined` here.
  //
  // What this workaround does:
  //   Creates a separate `aiLogger` via `createRequestLogger`, feeds it to
  //   `createAILogger`, and `emit()`s it in `onFinish`. The middleware writes
  //   to this independent logger (never sealed prematurely), so no warning
  //   fires and the resulting wide event carries the full `ai.*` block.
  //   `_parentRequestId` links it back to the parent request event.
  //
  // When to migrate to fork():
  //   - When evlog adds `attachForkToLogger` to its Nitro integration
  //     (track upstream: https://github.com/evlogdev/evlog).
  //   - Verify by checking `typeof logger.fork === 'function'`. The d.ts
  //     already declares `fork?` on `RequestLogger`.
  //   - Migration: replace `aiLogger` with the implicit child logger
  //     `logger.fork('ai-stream', async () => { /* await stream */ })`,
  //     remove `createRequestLogger` import + `aiLogger.emit(...)` calls.
  //     The child event will inherit `requestId` automatically as
  //     `_parentRequestId`.
  const parentRequestId = logger.getContext().requestId as string | undefined
  // Required on Cloudflare Workers — without this, the Axiom drain `fetch()`
  // initiated by `aiLogger.emit()` (running after the Response body finishes)
  // gets cancelled when the Worker deallocates. waitUntil() asks the runtime
  // to keep the Worker alive until the drain HTTP request resolves. This is
  // the same path evlog's own Nitro plugin uses for the request logger.
  type WaitUntilCtx = {
    cloudflare?: {
      context?: {
        waitUntil?: (promise: Promise<unknown>) => void
      }
    }
  }

  const cfCtx = (event.context as WaitUntilCtx | undefined)?.cloudflare?.context
  const aiLogger = createRequestLogger({
    method: 'POST',
    path: event.path,
    waitUntil: cfCtx?.waitUntil?.bind(cfCtx),
  })

  aiLogger.set({
    operation: 'ai-stream',
    service: 'app',
    _parentRequestId: parentRequestId,
    chatId: chat.id,
    userId,
    modelId: model.id,
    providerId: provider.id,
    reasoning: body.data.reasoning,
    tools: body.data.tools,
  })

  // Mirror Cloudflare edge metadata (colo, country, ASN, etc.) onto the
  // ai-stream event so geo-grouped queries work for AI cost too. The parent
  // request logger gets this via the evlog-request-observability plugin;
  // standalone child loggers don't inherit so we attach explicitly.
  attachCloudflareMeta(aiLogger, event)

  const ai = createAILogger(aiLogger, {
    cost: getModelCostMap(),
    toolInputs: { maxLength: 500 },
  })
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
      message: chatError.message,
      stage: 'prepare-provider',
      errorCode: chatError.code,
      providerStatus: chatError.status,
      providerRequestId: chatError.providerRequestId,
      errorMessage: chatError.why,
    })
    emitChatErrorLog({
      chatError,
      event,
      stage: 'prepare-provider',
      userId,
      chatId: chat.id,
      projectId: chat.projectId,
      modelId: model.id,
      reasoning: body.data.reasoning,
      tools: body.data.tools,
    })

    return new Response(JSON.stringify(chatError), {
      status: chatError.status || 500,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  const stream = createUIMessageStream({
    onError(error) {
      return JSON.stringify(normalizeChatError({
        error,
        event,
        providerId,
      }))
    },
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
          model: ai.wrap(instance),
          system: projectSystemPrompt || undefined,
          allowSystemInMessages: false,
          messages: resolveDataUrlsInModelMessages(
            await convertToModelMessages(messagesForAI),
          ),
          experimental_transform: smoothStream(),
          experimental_telemetry: {
            isEnabled: true,
            integrations: [createEvlogIntegration(ai)],
          },
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
          message: chatError.message,
          stage: 'start-stream',
          errorCode: chatError.code,
          providerStatus: chatError.status,
          providerRequestId: chatError.providerRequestId,
          errorMessage: chatError.why,
        })
        emitChatErrorLog({
          chatError,
          event,
          stage: 'start-stream',
          userId,
          chatId: chat.id,
          projectId: chat.projectId,
          modelId: model.id,
          reasoning: body.data.reasoning,
          tools: body.data.tools,
        })

        throw chatError
      }

      const uiMessageStream = result.toUIMessageStream({
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
            message: chatError.message,
            stage: 'stream',
            errorCode: chatError.code,
            providerStatus: chatError.status,
            providerRequestId: chatError.providerRequestId,
            errorMessage: chatError.why,
          })
          emitChatErrorLog({
            chatError,
            event,
            stage: 'stream',
            userId,
            chatId: chat.id,
            projectId: chat.projectId,
            modelId: model.id,
            reasoning: body.data.reasoning,
            tools: body.data.tools,
          })

          return JSON.stringify(chatError)
        },
      })
      const [clientStream, persistenceStream] = uiMessageStream.tee()

      writer.merge(filterRecoverableUIMessageStreamErrors(clientStream))

      await persistAssistantMessageFromStream({
        stream: persistenceStream,
        db,
        event,
        providerId: provider.id,
        supportedProviderId: providerId,
        userId,
        chatId: chat.id,
        projectId: chat.projectId,
        modelId: model.id,
        reasoning: body.data.reasoning,
        tools: body.data.tools,
        publicId: messagePublicId,
        logger,
      })

      // Emit the dedicated AI wide event AFTER the persistence stream is
      // fully consumed. By this point streamText.onFinish has fired, the
      // middleware's `wrapStream` transform has flushed its final state to
      // `aiLogger`, and `createEvlogIntegration`'s `onFinish` has run.
      // Emitting earlier (e.g. in streamText.onFinish) races with these
      // flushes and triggers evlog's "set called after emit" warning.
      //
      // Standalone `createRequestLogger().emit()` does NOT dispatch through
      // the Nitro hook system that our `evlog-drain.ts` plugin registers —
      // it goes through evlog's `globalDrain` / `globalPluginRunner`, which
      // the Nitro adapter doesn't populate. So `emit()` builds the event +
      // console.log's it (visible in CF Observability) but never ships it
      // to Axiom on its own. We manually push the built wide event to the
      // same Axiom drains used by the Nitro hook, registered via waitUntil
      // so the Worker stays alive until the fetch resolves.
      const aiWideEvent = aiLogger.emit({
        message: 'AI stream completed',
        status: 200,
      })

      if (aiWideEvent && cfCtx?.waitUntil) {
        cfCtx.waitUntil(shipWideEventToAxiom(aiWideEvent))
      }
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

async function persistAssistantMessageFromStream(input: {
  stream: ReadableStream<any>
  db: ReturnType<typeof useDb>
  event: H3Event
  providerId: string
  supportedProviderId: 'openai' | 'google' | undefined
  userId: number
  chatId: string
  projectId: string | null
  modelId: string
  reasoning: 'off' | 'low' | 'medium' | 'high'
  tools: string[]
  publicId: string
  logger: {
    set: (fields: Record<string, unknown>) => void
  }
}) {
  let isAborted = false
  let responseMessage: UIMessage | null = null
  const trackedStream = input.stream.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      if (chunk?.type === 'abort') {
        isAborted = true
      }

      controller.enqueue(chunk)
    },
  }))

  for await (const message of readUIMessageStream<UIMessage>({
    stream: trackedStream,
  })) {
    responseMessage = message
  }

  if (isAborted || !responseMessage) {
    return
  }

  try {
    const normalizationInput = {
      parts: responseMessage.parts as UIMessage['parts'],
      providerId: input.providerId,
      chatId: input.chatId,
      userId: input.userId,
      logger: input.logger,
    }
    const normalizedParts = await normalizeAssistantParts(
      normalizationInput,
    )

    await insertMessageWithPublicId({
      db: input.db,
      values: {
        chatId: input.chatId,
        role: 'assistant',
        parts: normalizedParts,
        tools: [],
        reasoning: input.reasoning,
      },
      publicId: input.publicId,
    })
  } catch (exception) {
    const chatError = normalizeChatError({
      error: exception,
      event: input.event,
      providerId: input.supportedProviderId,
      code: 'message-persist-failed',
      message: 'The response could not be saved.',
    })

    input.logger.set({
      message: chatError.message,
      stage: 'persist-assistant-message',
      errorCode: chatError.code,
      providerStatus: chatError.status,
      providerRequestId: chatError.providerRequestId,
      errorMessage: chatError.why,
    })
    emitChatErrorLog({
      chatError,
      event: input.event,
      stage: 'persist-assistant-message',
      userId: input.userId,
      chatId: input.chatId,
      projectId: input.projectId,
      modelId: input.modelId,
      reasoning: input.reasoning,
      tools: input.tools,
    })

    throw chatError
  }
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

function emitChatErrorLog(input: {
  chatError: ChatErrorPayload
  event: {
    method?: string
    path?: string
  }
  stage: string
  userId: number
  chatId: string
  projectId: string | null
  modelId: string
  reasoning: string
  tools: string[]
}) {
  log.error({
    message: input.chatError.message,
    why: input.chatError.why,
    fix: input.chatError.fix,
    status: input.chatError.status,
    requestId: input.chatError.requestId,
    providerId: input.chatError.providerId,
    providerRequestId: input.chatError.providerRequestId,
    errorCode: input.chatError.code,
    stage: input.stage,
    userId: input.userId,
    chatId: input.chatId,
    projectId: input.projectId,
    modelId: input.modelId,
    reasoning: input.reasoning,
    tools: input.tools,
    method: input.event.method,
    path: input.event.path,
  })
}

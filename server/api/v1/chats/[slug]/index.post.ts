import type {
  LanguageModel,
  UIMessage,
  InferUIMessageChunk,
  LanguageModelUsage,
  ProviderMetadata,
} from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { GatewayProvider } from '@ai-sdk/gateway'
import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import type {
  Model,
  ModelTool,
  Provider,
  SupportedProviderId,
} from '#shared/types/providers.d'
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import type { ImageGenerationAspectRatio } from '#shared/types/image-generation.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import {
  isGatewayReasoningSupported,
  isGatewayToolAllowed,
} from '#shared/utils/gateway-capabilities'
import { estimateGatewayMessageCost } from '#shared/utils/gateway-pricing'
import type { FormattedTools } from '~~/server/types/tools.d'
import { useLogger, createError, createRequestLogger, log } from 'evlog'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  smoothStream,
  convertToModelMessages,
  readUIMessageStream,
  toUIMessageStream,
} from 'ai'
import * as schema from '~~/server/db/schema'
import {
  buildMessageUsage,
  addImageGenerationCostToUsage,
} from '~~/server/utils/ai/message-usage'
import { getImageGenerationCost } from '~~/server/utils/ai/image-generation-cost'
import { getRequestId, normalizeChatError } from '~~/server/utils/chats/errors'
import { filterRecoverableUIMessageStreamErrors } from '~~/server/utils/chats/filter-ui-message-stream'
import { insertMessageWithPublicId } from '~~/server/utils/chats/insert-message'
import { persistUserMessage } from '~~/server/utils/chats/persist-user-message'
import {
  chatToolSchema,
  incomingUserMessageSchema,
} from '~~/server/utils/chats/request-schema'
import {
  getActiveShareForChat,
  syncChatShareFiles,
} from '~~/server/utils/chats/share'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import {
  normalizeAssistantMessagePartsForPersistence as normalizeAssistantParts,
  getGeneratedImageFileIds,
  isKnownImageGenerationModel,
  sanitizeMessagesForModelContext,
} from '~~/server/utils/files/assistant-files'
import { createImageGenerationTool } from '~~/server/utils/ai/image-generation'
import { resolveToolLoopOptions } from '~~/server/utils/ai/tool-loop'
import { buildProjectSystemPrompt } from '~~/server/utils/projects/instructions'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

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
    gateway: z.enum(['vercel', 'cloudflare', 'openrouter']).optional(),
    tools: z.array(chatToolSchema),
    reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
    messages: z.array(incomingUserMessageSchema).length(1),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const reasoningLevel: ReasoningLevel = body.data.gateway
    && !isGatewayReasoningSupported(body.data.gateway)
    ? 'off'
    : body.data.reasoning

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
        // Persistence order is load-bearing: previousMessages is the model
        // context AND the basis for detecting whether a re-sent user message
        // already has a persisted assistant reply (issue #263). id is the
        // autoincrement integer primary key, so ascending id is insertion
        // order — making the user/assistant adjacency deterministic instead of
        // relying on the implicit D1 rowid ordering.
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
    projectId: chat.projectId,
    reasoning: reasoningLevel,
    tools: body.data.tools,
  })

  const {
    messages: newMessages,
    model: userModel,
    gateway: gatewayId,
  } = body.data
  const newMessage = newMessages[0]

  if (!newMessage) {
    throw createError({
      message: 'No message provided',
      status: 400,
    })
  }

  const selectedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : body.data.tools

  if (gatewayId) {
    const unsupportedGatewayTool = selectedTools.find((selectedTool) => {
      return !isGatewayToolAllowed(gatewayId, selectedTool)
    })

    if (unsupportedGatewayTool) {
      throw createError({
        message: 'The selected tool is not supported for models routed through this gateway.',
        status: 400,
        why: `${gatewayId} does not support ${unsupportedGatewayTool} for gateway chat completions.`,
        fix: 'Turn off that tool, or choose a direct provider model.',
      })
    }
  }

  let provider: Provider | undefined
  let model: Model | undefined
  let requestedTools: ModelTool[] = []

  if (gatewayId) {
    requestedTools = selectedTools
    logger.set({ tools: requestedTools })
  } else {
    const resolved = useChatProvider(userModel)

    provider = resolved.provider
    model = resolved.model

    const hasImageAttachment = newMessage.parts.some((part) => {
      return part.type === 'file' && part.mediaType.startsWith('image/')
    })

    if (hasImageAttachment && !model.modalities.input.includes('image')) {
      throw createError({
        message: `${model.name} does not support image input.`,
        status: 400,
        why: 'The message includes an image attachment, but the selected model does not advertise image support.',
        fix: 'Remove the image attachment, or switch to a vision-capable model.',
      })
    }

    const requiredTools = getRequiredModelTools(model)
    const supportedTools = [...model.tools, ...requiredTools]
    const unsupportedTool = selectedTools.find((selectedTool) => {
      return !supportedTools.includes(selectedTool)
    })

    if (unsupportedTool) {
      throw createError({
        message: 'The selected model does not support the requested tool.',
        status: 400,
        why: `${model.name} does not advertise ${unsupportedTool}.`,
        fix: 'Choose a supported model or turn off that tool.',
      })
    }

    requestedTools = [...new Set([
      ...selectedTools,
      ...requiredTools,
    ])]

    logger.set({ tools: requestedTools })
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

  // Idempotent-retry guard for issue #263. When the client never receives a
  // finished stream (a mobile-Safari connection drop, a backgrounded tab, a
  // flaky last mile) it re-sends the same user message id. If that turn already
  // fully persisted server-side (user message + assistant reply), re-running
  // the model would recharge tokens and write a duplicate assistant row, and
  // re-inserting the user message would collide on messages.public_id (UNIQUE)
  // — the message-persist-failed reported in #263. Detect the assistant reply
  // already stored for this exact user message and replay it, so the user sees
  // the real response with no error and no extra cost.
  //
  // This is unambiguous in the current UI: a completed turn's user id is only
  // ever re-sent by a disconnect retry. The Regenerate button is gated on a
  // stopped/errored stream (canShowRegenerate -> displayRegenerate), and there
  // is no per-message regenerate that would legitimately expect a fresh
  // response for an already-answered message. Revisit this short-circuit if
  // such a feature is added.
  const persistedUserIndex = previousMessages.findIndex((message) => {
    return message.role === 'user' && message.id === newMessage.id
  })
  const followingPersistedMessage = persistedUserIndex >= 0
    ? previousMessages[persistedUserIndex + 1]
    : undefined
  const persistedAssistantMessage
    = followingPersistedMessage?.role === 'assistant'
      ? followingPersistedMessage
      : undefined

  if (newMessage.role === 'user' && persistedAssistantMessage) {
    logger.set({
      stage: 'replay-persisted-assistant',
      replayedAssistantPublicId: persistedAssistantMessage.id,
    })

    return createUIMessageStreamResponse({
      stream: createUIMessageStream({
        onError(error) {
          return JSON.stringify(normalizeChatError({
            error,
            event,
          }))
        },
        execute({ writer }) {
          const replayChunks = buildPersistedAssistantReplayChunks({
            publicId: persistedAssistantMessage.id,
            parts: persistedAssistantMessage.parts as UIMessage['parts'],
            sendReasoning: persistedAssistantMessage.reasoning !== 'off',
          })

          for (const chunk of replayChunks) {
            writer.write(chunk)
          }
        },
      }),
    })
  }

  // Issue #275: a client that auto-recovers after iOS suspends/backgrounds the
  // page (visibilitychange) can resend this same user message id while the
  // original Worker invocation is still mid-generation (generation runs
  // 2-3 min; the client can return in seconds). Without this guard that
  // resend would fall through to a second concurrent streamText() call —
  // double-billing the provider and racing the unique messages.public_id
  // constraint. The flag is set for the duration of generation (see
  // execute() below) so a retry within that window gets a lightweight
  // "still working" signal instead of starting a duplicate generation.
  if (newMessage.role === 'user' && persistedUserIndex >= 0) {
    const isGenerating = await useKV().get(
      generationInProgressKvKey(chat.id, newMessage.id),
    )

    if (isGenerating) {
      logger.set({ stage: 'generation-in-progress' })

      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute({ writer }) {
            // No messageId on start and no metadata on finish — either would
            // make the AI SDK write() a message-list entry keyed by a fresh
            // id unrelated to the real in-progress assistant message, which
            // pushes a genuine (if content-less and hidden) extra message
            // into chatSdk.messages and pollutes later
            // shouldSurfaceEmptyAssistantResponse checks. transient: true
            // routes the pending signal to onData only, the same way — never
            // becoming a message part. This response should be a complete
            // no-op against the message list; only onData should observe it.
            writer.write({ type: 'start' })
            writer.write({
              type: 'data-generation-pending',
              data: {},
              transient: true,
            })
            writer.write({ type: 'finish' })
          },
        }),
      })
    }
  }

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

  if (newMessage.role === 'user') {
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
        id: newMessage.id,
        parts: newMessage.parts as UIMessage['parts'],
      },
      tools: requestedTools,
      reasoning: reasoningLevel,
    })
  }

  if (model?.research) {
    throw createError({
      message: 'This model only runs deep research.',
      status: 400,
      why: 'Deep research models cannot serve normal streaming chat.',
      fix: 'Send this message through the deep research flow instead.',
    })
  }

  let modelId: string
  let telemetryProviderId: string
  let errorProviderId: SupportedProviderId | GatewayId | undefined

  if (gatewayId) {
    modelId = userModel
    telemetryProviderId = keyProviderIdForGateway(gatewayId)
    errorProviderId = gatewayId
  } else if (provider && model) {
    modelId = model.id
    telemetryProviderId = provider.id
    errorProviderId = toSupportedProviderId(provider.id)
  } else {
    throw createError({
      message: 'Current model is not supported by any provider. Please select a different model.',
      status: 400,
    })
  }

  const gatewayTelemetryAttributes = gatewayId
    ? {
      attributes: {
        chat: {
          gateway: gatewayId,
          gatewayProvider: modelId.split('/')[0],
          gatewayModel: modelId,
        },
      },
    }
    : {}

  // Nuxt/Nitro emits the parent request wide event the moment this handler
  // returns the streaming Response — BEFORE the AI stream finishes — so the
  // `ai.{tokens, cost, ...}` we capture in streamText's `onEnd` would land on
  // an already-sealed event and be dropped. We accumulate those metrics on a
  // dedicated `aiLogger` (linked to the parent via `_parentRequestId`) and
  // `emit()` it after the stream completes.
  //
  // Token usage + cost are captured natively from `onEnd` (see below): AI SDK
  // v7 dropped the `bindTelemetryIntegration` export that `evlog/ai`'s
  // `createAILogger`/`createEvlogIntegration` depend on, so the evlog/ai
  // middleware is not usable here until evlog ships a v7-compatible build.
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
    feature: 'chat',
    _parentRequestId: parentRequestId,
    chatId: chat.id,
    userId,
    modelId,
    providerId: telemetryProviderId,
    reasoning: reasoningLevel,
    tools: requestedTools,
    ...gatewayTelemetryAttributes,
  })

  // Mirror Cloudflare edge metadata (colo, country, ASN, etc.) onto the
  // ai-stream event so geo-grouped queries work for AI cost too. The parent
  // request logger gets this via the evlog-request-observability plugin;
  // standalone child loggers don't inherit so we attach explicitly.
  attachCloudflareMeta(aiLogger, event)

  logger.set({
    providerId: telemetryProviderId,
    modelId,
    ...gatewayTelemetryAttributes,
  })

  let instance: LanguageModel
  let parsedTools: FormattedTools = {}
  let reasoningEffort: 'low' | 'medium' | 'high' | undefined
  const providerOptions: SharedV2ProviderOptions = {}
  let generatedImage: {
    modelId: string
    aspectRatio: ImageGenerationAspectRatio
  } | undefined
  let vercelGatewayClient: GatewayProvider | undefined
  let gatewayMaxOutputTokens: number | undefined
  let gatewayPricing: GatewayModel['pricing'] | undefined

  try {
    if (gatewayId) {
      const gatewayResult = await useGateway(
        gatewayId,
        session.user.id,
        modelId,
        requestedTools,
        reasoningLevel,
        logger,
      )

      instance = gatewayResult.instance
      parsedTools = gatewayResult.tools
      reasoningEffort = gatewayResult.reasoning
      Object.assign(providerOptions, gatewayResult.providerOptions)
      gatewayMaxOutputTokens = gatewayResult.maxOutputTokens
      gatewayPricing = gatewayResult.pricing

      if (gatewayId === 'vercel') {
        vercelGatewayClient = gatewayResult.client
      }
    } else if (provider && model) {
      switch (provider.id) {
        case 'openai': {
          const {
            instance: openAiInstance,
            imageModel: openAiImageModel,
            imageModelId: openAiImageModelId,
            tools: openAiTools,
            providerOptions: openAiProviderOptions,
            reasoning: openAiReasoning,
          } = await useOpenAI(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = openAiInstance
          parsedTools = openAiTools
          reasoningEffort = openAiReasoning
          Object.assign(providerOptions, {
            openai: openAiProviderOptions,
          })

          if (requestedTools.includes('image_generation')) {
            if (!openAiImageModel) {
              throw createError({
                message: 'Image generation is unavailable for this provider.',
                status: 400,
              })
            }

            const imageGenerationTool = createImageGenerationTool({
              userId,
              provider: 'openai',
              model: openAiImageModelId,
              imageModel: openAiImageModel,
              logger: aiLogger,
              requestId: getRequestId(event),
              onGenerated: ({ aspectRatio }) => {
                generatedImage = { modelId: openAiImageModelId, aspectRatio }
              },
            })
            parsedTools = {
              tools: {
                generate_image: imageGenerationTool,
              },
              toolChoice: {
                type: 'tool',
                toolName: 'generate_image',
              },
            }
          }

          break
        }
        case 'anthropic': {
          const {
            instance: anthropicInstance,
            tools: anthropicTools,
            providerOptions: anthropicProviderOptions,
            reasoning: anthropicReasoning,
          } = await useAnthropic(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = anthropicInstance
          parsedTools = anthropicTools
          reasoningEffort = anthropicReasoning
          Object.assign(providerOptions, {
            anthropic: anthropicProviderOptions,
          })

          break
        }
        case 'google': {
          const {
            instance: googleInstance,
            imageModel: googleImageModel,
            imageModelId: googleImageModelId,
            tools: googleTools,
            providerOptions: googleProviderOptions,
            reasoning: googleReasoning,
          } = await useGoogle(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = googleInstance
          parsedTools = googleTools
          reasoningEffort = googleReasoning
          Object.assign(providerOptions, {
            google: googleProviderOptions,
          })

          if (requestedTools.includes('image_generation')) {
            if (!googleImageModel) {
              throw createError({
                message: 'Image generation is unavailable for this provider.',
                status: 400,
              })
            }

            const imageGenerationTool = createImageGenerationTool({
              userId,
              provider: 'google',
              model: googleImageModelId,
              imageModel: googleImageModel,
              logger: aiLogger,
              requestId: getRequestId(event),
              onGenerated: ({ aspectRatio }) => {
                generatedImage = { modelId: googleImageModelId, aspectRatio }
              },
            })
            parsedTools = {
              tools: {
                generate_image: imageGenerationTool,
              },
              toolChoice: {
                type: 'tool',
                toolName: 'generate_image',
              },
            }
          }

          break
        }
        case 'xai': {
          const {
            instance: xaiInstance,
            tools: xaiTools,
            providerOptions: xaiProviderOptions,
            reasoning: xaiReasoning,
          } = await useXai(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = xaiInstance
          parsedTools = xaiTools
          reasoningEffort = xaiReasoning
          Object.assign(providerOptions, {
            xai: xaiProviderOptions,
          })

          break
        }
        case 'deepseek': {
          const {
            instance: deepseekInstance,
            tools: deepseekTools,
            providerOptions: deepseekProviderOptions,
            reasoning: deepseekReasoning,
          } = await useDeepSeek(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = deepseekInstance
          parsedTools = deepseekTools
          reasoningEffort = deepseekReasoning
          Object.assign(providerOptions, {
            deepseek: deepseekProviderOptions,
          })

          break
        }
        case 'moonshotai': {
          const {
            instance: moonshotAiInstance,
            tools: moonshotAiTools,
            providerOptions: moonshotAiProviderOptions,
            reasoning: moonshotAiReasoning,
          } = await useMoonshotAi(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = moonshotAiInstance
          parsedTools = moonshotAiTools
          reasoningEffort = moonshotAiReasoning
          Object.assign(providerOptions, {
            moonshotai: moonshotAiProviderOptions,
          })

          break
        }
        case 'qwen': {
          const {
            instance: qwenInstance,
            tools: qwenTools,
            providerOptions: qwenProviderOptions,
            reasoning: qwenReasoning,
          } = await useQwen(
            session.user.id,
            model.id,
            requestedTools,
            reasoningLevel,
          )

          instance = qwenInstance
          parsedTools = qwenTools
          reasoningEffort = qwenReasoning
          Object.assign(providerOptions, {
            qwen: qwenProviderOptions,
          })

          break
        }
        default:
          throw createError({
            message: 'Unsupported provider',
            status: 400,
          })
      }
    } else {
      throw createError({
        message: 'Unsupported provider',
        status: 400,
      })
    }
  } catch (exception) {
    const chatError = normalizeChatError({
      error: exception,
      event,
      providerId: errorProviderId,
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
      modelId,
      reasoning: reasoningLevel,
      tools: requestedTools,
    })

    return new Response(JSON.stringify(chatError), {
      status: chatError.status || 500,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  const toolLoopOptions = resolveToolLoopOptions(parsedTools.tools)

  const stream = createUIMessageStream({
    onError(error) {
      return JSON.stringify(normalizeChatError({
        error,
        event,
        providerId: errorProviderId,
      }))
    },
    async execute({ writer }) {
      const messagePublicId = ulid()
      const kv = useKV()
      const generatingKey = generationInProgressKvKey(chat.id, newMessage.id)

      // Mirrors the guard above: hold this flag for the lifetime of the
      // generation so a client retry of the same user message id (issue
      // #275 auto-recovery on visibilitychange) sees "still working" instead
      // of triggering a second concurrent streamText() call. The ttl is a
      // safety bound, not the expected lifetime — a clean exit always
      // deletes it in the finally block below. Awaited: a client that
      // disconnects and reconnects fast enough could otherwise run the guard
      // check above before this put() landed in KV, see no flag, and start a
      // second concurrent generation — double-billing the provider for one
      // user turn (caught by Codex's automated review). Awaiting here
      // guarantees the flag is visible before any provider work begins.
      try {
        await kv.put(generatingKey, '1', { expirationTtl: 600 })
      } catch (exception) {
        logger.set({
          generationGuard: {
            operation: 'put',
          },
          attributes: {
            generationGuard: {
              error: exceptionMessage(exception),
            },
          },
        })
      }

      try {
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
          // No abortSignal here: the cloudflare_module preset (Nitro 2.13 /
          // h3 v1 + node-mock-http) surfaces no client-disconnect signal to
          // the handler, and fully draining on disconnect is intentional —
          // it lets a reconnect replay the already-persisted reply. Don't
          // wire one: on this stack it is a no-op, or would defeat that
          // replay by skipping persist. (Providers also bill and omit usage
          // on abort, so there is no cost to recover here either.)
          result = streamText({
            model: instance,
            instructions: buildChatInstructions(
              projectSystemPrompt,
              requestedTools,
            ),
            reasoning: reasoningEffort,
            messages: await convertToModelMessages(messagesForAI),
            experimental_transform: smoothStream(),
            // Only Vercel/Cloudflare populate gatewayMaxOutputTokens (from
            // the model's own catalog entry — see GatewayChatResult in
            // server/utils/gateways/index.ts). OpenRouter's builder leaves
            // this undefined on purpose: it already self-negotiates a safe
            // max_tokens per routed upstream, and OpenRouter's own
            // advertised max_completion_tokens can be LOWER than a model's
            // real capacity on some upstreams, so capping it here would risk
            // truncating outputs that work fine today. Direct-provider sends
            // never set this either, so they keep their existing uncapped
            // behavior unchanged.
            maxOutputTokens: gatewayMaxOutputTokens,
            onEnd({ usage, providerMetadata, steps }) {
              const textCost = gatewayId
                ? sumOpenRouterStepCosts(steps)
                ?? readOpenRouterCost(providerMetadata)
                : computeModelCost(modelId, telemetryProviderId, usage)
              const imageCost = generatedImage
                ? getImageGenerationCost(
                  generatedImage.modelId,
                  generatedImage.aspectRatio,
                )
                : undefined

              aiLogger.set({
                ai: {
                  tokens: {
                    input: usage.inputTokens ?? 0,
                    output: usage.outputTokens ?? 0,
                    reasoning: usage.outputTokenDetails?.reasoningTokens,
                    total: usage.totalTokens
                      ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
                  },
                  cost: textCost !== undefined || imageCost !== undefined
                    ? (textCost ?? 0) + (imageCost ?? 0)
                    : undefined,
                },
              })
            },
            ...parsedTools,
            ...(toolLoopOptions ?? {}),
            providerOptions,
          })
        } catch (exception) {
          const chatError = normalizeChatError({
            error: exception,
            event,
            providerId: errorProviderId,
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
            modelId,
            reasoning: reasoningLevel,
            tools: requestedTools,
          })

          throw chatError
        }

        let streamedGatewayCost: number | undefined

        const uiMessageStream = toUIMessageStream({
          stream: result.stream,
          originalMessages: messagesForAI,
          generateMessageId: () => messagePublicId,
          sendSources: true,
          sendReasoning: reasoningLevel !== 'off',
          messageMetadata({ part }) {
            if (part.type === 'finish-step') {
              const stepCost = readOpenRouterCost(part.providerMetadata)

              if (stepCost !== undefined) {
                streamedGatewayCost = (streamedGatewayCost ?? 0) + stepCost
              }

              return undefined
            }

            if (part.type !== 'finish') {
              return undefined
            }

            const gatewayCost = resolveLiveGatewayCost({
              gatewayId,
              openRouterCost: streamedGatewayCost,
              pricing: gatewayPricing,
              usage: part.totalUsage,
            })

            const baseUsage = buildMessageUsage(
              part.totalUsage,
              modelId,
              telemetryProviderId,
              gatewayCost?.totalCost,
            )
            const imageGenerationCost = generatedImage
              ? getImageGenerationCost(
                generatedImage.modelId,
                generatedImage.aspectRatio,
              )
              : undefined
            const usageWithImageCost = addImageGenerationCostToUsage(
              baseUsage,
              imageGenerationCost,
            )
            const usage = usageWithImageCost && gatewayCost?.costEstimated
              ? { ...usageWithImageCost, costEstimated: true }
              : usageWithImageCost

            return {
              createdAt: new Date().toISOString(),
              ...(usage ? { usage } : {}),
            }
          },
          onError(error) {
            const chatError = normalizeChatError({
              error,
              event,
              providerId: errorProviderId,
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
              modelId,
              reasoning: reasoningLevel,
              tools: requestedTools,
            })

            return JSON.stringify(chatError)
          },
        })
        const [clientStream, persistenceStream] = uiMessageStream.tee()

        writer.merge(filterRecoverableUIMessageStreamErrors(clientStream))

        const wasPersisted = await persistAssistantMessageFromStream({
          stream: persistenceStream,
          result,
          db,
          event,
          providerId: telemetryProviderId,
          supportedProviderId: errorProviderId,
          userId,
          chatId: chat.id,
          projectId: chat.projectId,
          modelId,
          reasoning: reasoningLevel,
          tools: requestedTools,
          publicId: messagePublicId,
          logger,
          gatewayId,
          gatewayPricing,
          vercelGatewayClient,
          scheduleBackgroundWork: cfCtx?.waitUntil?.bind(cfCtx),
        })

        // There is no reliable signal here for "is the client still
        // connected/looking at this" — iOS suspension makes any such check
        // unreliable anyway (see app/composables/wake-lock.ts) — so this
        // always sends if a subscription exists. The service worker's push
        // handler always shows the notification too, even if a window is
        // visible: subscribing with userVisibleOnly:true is a promise to the
        // browser that every push shows one, and suppressing it risks Chrome
        // showing its own generic notification instead or penalizing the
        // subscription. waitUntil keeps the Worker alive for this the same
        // way it already does for shipping the wide event below — sending a
        // push is one signed HTTPS POST, well inside the 30s waitUntil
        // budget.
        if (wasPersisted && cfCtx?.waitUntil) {
          const runtimeConfig = useRuntimeConfig()

          let targetOrigin: string | undefined

          try {
            targetOrigin = getRequestURL(event).origin
          } catch (exception) {
            void exception
            targetOrigin = undefined
          }

          cfCtx.waitUntil(sendPushNotificationToUser(
            db,
            userId,
            {
              title: 'Your response is ready',
              body: 'Open the chat to see what Besidka generated for you.',
              url: `/chats/${params.data.slug}`,
            },
            {
              subject: buildVapidSubject(runtimeConfig.vapidSubject),
              publicKey: runtimeConfig.public.vapidPublicKey || undefined,
              privateKey: runtimeConfig.vapidPrivateKey || undefined,
            },
            cfCtx.waitUntil.bind(cfCtx),
            targetOrigin,
          ))
        }

        // Emit the dedicated AI wide event AFTER the persistence stream is
        // fully consumed. By this point streamText's `onEnd` has fired and
        // written the `ai.{tokens, cost}` block to `aiLogger`. Emitting
        // earlier races with that write and triggers evlog's "set called
        // after emit" warning.
        //
        // Standalone `createRequestLogger().emit()` does NOT dispatch
        // through the Nitro hook system that our `evlog-drain.ts` plugin
        // registers — it goes through evlog's `globalDrain` /
        // `globalPluginRunner`, which the Nitro adapter doesn't populate.
        // So `emit()` builds the event + console.log's it (visible in CF
        // Observability) but never ships it to Axiom on its own. We manually
        // push the built wide event to the same Axiom drains used by the
        // Nitro hook, registered via waitUntil so the Worker stays alive
        // until the fetch resolves.
        const aiWideEvent = aiLogger.emit({
          message: 'AI stream completed',
          status: 200,
        })

        if (aiWideEvent && cfCtx?.waitUntil) {
          cfCtx.waitUntil(shipWideEventToAxiom(aiWideEvent))
        }
      } finally {
        try {
          await kv.delete(generatingKey)
        } catch (exception) {
          logger.set({
            generationGuard: {
              operation: 'delete',
            },
            attributes: {
              generationGuard: {
                error: exceptionMessage(exception),
              },
            },
          })
        }
      }
    },
  })

  return createUIMessageStreamResponse({
    stream,
  })
})

/**
 * Sums the per-step OpenRouter cost across every step of one send.
 *
 * Each AI SDK step is its own `doStream()` call — a separate OpenRouter
 * request with its own generation id and its own billed `usage.cost` — so a
 * multi-step send reports N independent costs that must be added, never
 * last-wins. For the single-step sends that are the only ones reachable
 * without a `withFollowUpTurn()` tool, the sum of one element is exactly the
 * value the previous `finalStep`-only read produced.
 *
 * Stays `undefined` (never 0) when no step reported a cost, so an unpriced
 * send omits `totalCost` instead of displaying a fabricated free generation.
 */
function sumOpenRouterStepCosts(
  steps: readonly { providerMetadata?: ProviderMetadata }[] | undefined,
): number | undefined {
  if (!steps) {
    return undefined
  }

  let total: number | undefined

  for (const step of steps) {
    const stepCost = readOpenRouterCost(step.providerMetadata)

    if (stepCost === undefined) {
      continue
    }

    total = (total ?? 0) + stepCost
  }

  return total
}

/**
 * Resolves the one gateway cost figure that's genuinely available at
 * generation-finish time, shared by the live streamed metadata
 * (`messageMetadata`'s finish branch) and the persisted DB write
 * (`persistAssistantMessageFromStream`) so both paths agree. `openRouterCost`
 * arrives already summed across steps by the caller — live from the
 * `finish-step` chunks, persisted from `result.steps`.
 *
 * OpenRouter reports its billed cost synchronously — never estimated.
 * Cloudflare has no per-request cost API, so its figure is a token-based
 * estimate from the catalog's per-token `pricing` (see
 * `estimateGatewayMessageCost`), flagged `costEstimated: true`. Vercel is
 * deliberately excluded: its real cost is only knowable via an async
 * follow-up call scheduled well after the stream finishes (see
 * `persistVercelGenerationCost` in `server/utils/gateways/vercel.ts`), so
 * there is nothing to read here yet. Direct-provider sends (`gatewayId`
 * undefined) also resolve to `undefined`, leaving their existing
 * `inputCost`/`outputCost` split untouched.
 */
function resolveLiveGatewayCost(input: {
  gatewayId: GatewayId | undefined
  openRouterCost: number | undefined
  pricing: GatewayModel['pricing'] | undefined
  usage: LanguageModelUsage
}): { totalCost: number, costEstimated: boolean } | undefined {
  if (input.gatewayId === 'openrouter') {
    const totalCost = input.openRouterCost

    return totalCost === undefined
      ? undefined
      : { totalCost, costEstimated: false }
  }

  if (input.gatewayId === 'cloudflare' && input.pricing) {
    const totalCost = estimateGatewayMessageCost(
      { pricing: input.pricing },
      {
        inputTokens: input.usage.inputTokens ?? 0,
        outputTokens: input.usage.outputTokens ?? 0,
      },
    )

    return totalCost === undefined
      ? undefined
      : { totalCost, costEstimated: true }
  }

  return undefined
}

// Dollars spent on a single generation, derived from the same per-1M-token
// pricing `buildMessageUsage()` uses for persisted/streamed usage. Returns
// undefined when the usage is incomplete or the model has no known price, so
// callers omit `ai.cost` rather than logging a misleading 0.
function computeModelCost(
  modelId: string,
  providerId: string,
  usage: LanguageModelUsage,
): number | undefined {
  const messageUsage = buildMessageUsage(usage, modelId, providerId)

  if (!messageUsage || messageUsage.inputCost === undefined) {
    return undefined
  }

  return messageUsage.inputCost + (messageUsage.outputCost ?? 0)
}

// Dollar cost of the image this turn's `generate_image` tool call actually
// produced, read from the persisted tool part: `output.model` is the exact
// image model used, `input.aspectRatio` is the size it was generated at.
// Returns undefined when no image was generated, the tool call failed, or
// the model has no known price — never fabricated as 0.
function getGeneratedImageCostFromParts(
  parts: UIMessage['parts'],
): number | undefined {
  for (const part of parts) {
    if (
      part.type !== 'tool-generate_image'
      || part.state !== 'output-available'
    ) {
      continue
    }

    const output = part.output

    if (
      typeof output !== 'object'
      || output === null
      || !('status' in output)
      || output.status !== 'ready'
      || !('provider' in output)
      || (output.provider !== 'openai' && output.provider !== 'google')
      || !('model' in output)
      || typeof output.model !== 'string'
      || !isKnownImageGenerationModel(output.model, output.provider)
    ) {
      continue
    }

    return getImageGenerationCost(
      output.model,
      getToolInputAspectRatio(part.input),
    )
  }

  return undefined
}

function getToolInputAspectRatio(input: unknown): string {
  const defaultAspectRatio = '1:1'

  if (
    typeof input !== 'object'
    || input === null
    || !('aspectRatio' in input)
    || typeof input.aspectRatio !== 'string'
  ) {
    return defaultAspectRatio
  }

  return input.aspectRatio
}

// Rebuild a UI message stream from an already-persisted assistant message so a
// disconnect retry (issue #263) replays the stored reply instead of erroring or
// re-calling the model. Emits the same chunk vocabulary that
// result.toUIMessageStream produces, so the client transport reconstructs a
// normal assistant message with no client changes. The persisted parts already
// passed through normalizeAssistantParts, so the part vocabulary is bounded; an
// unmapped part degrades to "reload to see it", never to data loss (the row is
// intact in D1).
function buildPersistedAssistantReplayChunks(input: {
  publicId: string
  parts: UIMessage['parts']
  sendReasoning: boolean
}): InferUIMessageChunk<UIMessage>[] {
  const chunks: InferUIMessageChunk<UIMessage>[] = [{
    type: 'start',
    messageId: input.publicId,
  }]

  for (const [index, part] of input.parts.entries()) {
    if (part.type === 'text') {
      const id = `replay-text-${index}`

      chunks.push(
        { type: 'text-start', id },
        { type: 'text-delta', id, delta: part.text },
        { type: 'text-end', id },
      )

      continue
    }

    if (part.type === 'reasoning') {
      if (!input.sendReasoning || !part.text) {
        continue
      }

      const id = `replay-reasoning-${index}`

      chunks.push(
        { type: 'reasoning-start', id },
        { type: 'reasoning-delta', id, delta: part.text },
        { type: 'reasoning-end', id },
      )

      continue
    }

    if (part.type === 'source-url') {
      chunks.push({
        type: 'source-url',
        sourceId: part.sourceId,
        url: part.url,
        title: part.title,
      })

      continue
    }

    if (part.type === 'source-document') {
      chunks.push({
        type: 'source-document',
        sourceId: part.sourceId,
        mediaType: part.mediaType,
        title: part.title,
        filename: part.filename,
      })

      continue
    }

    if (part.type === 'file') {
      chunks.push({
        type: 'file',
        url: part.url,
        mediaType: part.mediaType,
      })
    }
  }

  chunks.push({ type: 'finish' })

  return chunks
}

async function persistAssistantMessageFromStream(input: {
  stream: ReadableStream<any>
  result: ReturnType<typeof streamText>
  db: ReturnType<typeof useDb>
  event: H3Event
  providerId: string
  supportedProviderId: SupportedProviderId | GatewayId | undefined
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
  vercelGatewayClient?: GatewayProvider
  scheduleBackgroundWork?: (promise: Promise<unknown>) => void
  gatewayId?: GatewayId
  gatewayPricing?: GatewayModel['pricing']
}): Promise<boolean> {
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
    return false
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
    const generatedFileIds = getGeneratedImageFileIds(
      responseMessage.parts as UIMessage['parts'],
      input.providerId,
      normalizedParts,
    )
    const usedImageGeneration = responseMessage.parts.some((part) => {
      return part.type === 'tool-generate_image'
        && (
          part.state === 'output-available'
          || part.state === 'output-error'
        )
    })

    let usage: MessageUsage | undefined
    let vercelGenerationId: string | undefined

    try {
      const finalStep = await input.result.finalStep
      const steps = await input.result.steps
      const resolvedUsage = await input.result.usage

      vercelGenerationId = readVercelGenerationId(finalStep.providerMetadata)

      const gatewayCost = resolveLiveGatewayCost({
        gatewayId: input.gatewayId,
        openRouterCost: sumOpenRouterStepCosts(steps)
          ?? readOpenRouterCost(finalStep.providerMetadata),
        pricing: input.gatewayPricing,
        usage: resolvedUsage,
      })

      const baseUsage = buildMessageUsage(
        resolvedUsage,
        input.modelId,
        input.providerId,
        gatewayCost?.totalCost,
      )
      const imageGenerationCost = getGeneratedImageCostFromParts(
        responseMessage.parts as UIMessage['parts'],
      )
      const usageWithImageCost = addImageGenerationCostToUsage(
        baseUsage,
        imageGenerationCost,
      )

      usage = usageWithImageCost && gatewayCost?.costEstimated
        ? { ...usageWithImageCost, costEstimated: true }
        : usageWithImageCost
    } catch (exception) {
      input.logger.set({
        attributes: {
          usageCapture: {
            error: exceptionMessage(exception),
          },
        },
      })
    }

    const assistantMessage = await insertMessageWithPublicId({
      db: input.db,
      values: {
        chatId: input.chatId,
        role: 'assistant',
        parts: normalizedParts,
        tools: usedImageGeneration ? ['image_generation'] : [],
        reasoning: input.reasoning,
        usage: usage ?? null,
      },
      publicId: input.publicId,
    })

    if (
      assistantMessage
      && input.vercelGatewayClient
      && input.scheduleBackgroundWork
      && vercelGenerationId
    ) {
      input.scheduleBackgroundWork(persistVercelGenerationCost({
        db: input.db,
        client: input.vercelGatewayClient,
        generationId: vercelGenerationId,
        publicId: input.publicId,
        logger: input.logger,
      }))
    }

    if (assistantMessage && generatedFileIds.length > 0) {
      let filesLinked = false

      try {
        await input.db
          .update(schema.files)
          .set({
            originMessageId: sql`(
              select ${schema.messages.id}
              from ${schema.messages}
              where ${schema.messages.publicId} = ${input.publicId}
            )`,
          })
          .where(and(
            eq(schema.files.userId, input.userId),
            eq(schema.files.source, 'assistant'),
            eq(schema.files.originProvider, input.providerId),
            inArray(schema.files.id, generatedFileIds),
          ))

        filesLinked = true
      } catch {
        input.logger.set({
          assistantFiles: {
            action: 'origin-link-failed',
            count: generatedFileIds.length,
            chatId: input.chatId,
            userId: input.userId,
            errorCode: 'assistant-file-link-failed',
          },
        })
      }

      if (filesLinked) {
        try {
          const activeShare = await getActiveShareForChat(
            input.chatId,
            input.event,
          )

          if (activeShare?.showFiles) {
            await syncChatShareFiles(
              activeShare.id,
              input.chatId,
              input.userId,
              true,
              input.event,
            )
          }
        } catch {
          input.logger.set({
            assistantFiles: {
              action: 'share-sync-failed',
              count: generatedFileIds.length,
              chatId: input.chatId,
              userId: input.userId,
              errorCode: 'assistant-file-share-sync-failed',
            },
          })
        }
      }
    }

    return true
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

function generationInProgressKvKey(
  chatId: string,
  userMessageId: string,
): string {
  return `chat-generating:${chatId}:${userMessageId}`
}

function buildChatInstructions(
  projectSystemPrompt: string | null,
  requestedTools: ModelTool[],
): string | undefined {
  const instructions = [projectSystemPrompt]

  if (requestedTools.includes('image_generation')) {
    instructions.push([
      'Image generation mode is active. Call generate_image exactly once',
      'with a complete visual prompt based on the user request. Do not',
      'decline a valid image request or claim image generation is unavailable.',
      'The tool saves the result in the user private file library.',
    ].join(' '))
  }

  return instructions.filter(Boolean).join('\n\n') || undefined
}

const supportedProviderIds: SupportedProviderId[] = [
  'openai',
  'google',
  'anthropic',
  'xai',
  'deepseek',
  'moonshotai',
  'qwen',
]

function toSupportedProviderId(
  providerId: string,
): SupportedProviderId | undefined {
  return supportedProviderIds.find((id) => {
    return id === providerId
  })
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

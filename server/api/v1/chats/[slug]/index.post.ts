import type {
  LanguageModel,
  UIMessage,
  InferUIMessageChunk,
  LanguageModelUsage,
} from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { H3Event } from 'h3'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import type { Tools } from '#shared/types/chats.d'
import type { ResearchBriefData, ResearchDepth } from '#shared/types/research.d'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { getResearchBudget, isDeepResearchActive } from '#shared/utils/research'
import type { FormattedTools } from '~~/server/types/tools.d'
import { useLogger, createError, createRequestLogger, log } from 'evlog'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  smoothStream,
  stepCountIs,
  pruneMessages,
  convertToModelMessages,
  readUIMessageStream,
  toUIMessageStream,
} from 'ai'
import * as schema from '~~/server/db/schema'
import { buildMessageUsage } from '~~/server/utils/ai/message-usage'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import {
  buildInitialResearchPlanningMilestone,
  buildResearchStepInstructions,
  buildResearchSystemPrompt,
  createResearchMilestoneState,
  createResearchSourceRegistry,
  getUserMessageText,
  mapStepToResearchMilestones,
  registerResearchSourcesFromSteps,
  shouldForceResearchSearch,
  shouldStopResearch,
} from '~~/server/utils/chats/deep-research'
import { filterRecoverableUIMessageStreamErrors } from '~~/server/utils/chats/filter-ui-message-stream'
import { validateMessageFilePolicy } from '~~/server/utils/files/file-governance'
import {
  normalizeAssistantMessagePartsForPersistence as normalizeAssistantParts,
  sanitizeMessagesForModelContext,
} from '~~/server/utils/files/assistant-files'
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
    tools: z.array(z.enum(['web_search', 'deep_research'])),
    reasoning: z.enum(['off', 'low', 'medium', 'high']).default('off'),
    researchDepth: z
      .enum(['off', 'quick', 'standard', 'thorough'])
      .default('off'),
    researchAnswers: z.array(
      z.object({
        id: z.string(),
        question: z.string().max(500),
        answer: z.string().max(4000),
      }),
    ).max(20).optional(),
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
    reasoning: body.data.reasoning,
    tools: body.data.tools,
    researchDepth: body.data.researchDepth,
  })

  const { messages: newMessages, model: userModel } = body.data
  const newMessage = newMessages[0]

  if (!newMessage) {
    throw createError({
      message: 'No message provided',
      status: 400,
    })
  }

  const { provider, model } = useChatProvider(userModel)
  const supportsDeepResearch = model.tools.includes('deep_research')
  const requestedResearchDepth = body.data.researchDepth

  if (!supportsDeepResearch && requestedResearchDepth !== 'off') {
    logger.set({
      stage: 'research-capability-downgrade',
      modelId: model.id,
      requestedResearchDepth,
    })
  }

  const researchDepth = supportsDeepResearch
    ? requestedResearchDepth
    : 'off'
  const effectiveTools = supportsDeepResearch
    ? body.data.tools
    : body.data.tools.filter((tool) => {
      return tool !== 'deep_research'
    })
  const researchBudget = isDeepResearchActive(researchDepth)
    ? getResearchBudget(researchDepth)
    : null
  const isResearch = effectiveTools.includes('deep_research')
    && researchBudget !== null
  const persistedResearchDepth: ResearchDepth | null
    = isResearch && isDeepResearchActive(researchDepth)
      ? researchDepth
      : null
  const researchGenerationTtlSeconds = isResearch && researchBudget
    ? Math.max(900, researchBudget.maxSteps * 120)
    : 600

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

  const researchTopic = isResearch
    ? getUserMessageText(newMessage.parts as UIMessage['parts'])
    : ''
  const researchAnswers = body.data.researchAnswers ?? []
  const researchBrief: ResearchBriefData | null
    = isResearch && isDeepResearchActive(researchDepth)
      ? {
        topic: researchTopic,
        depth: researchDepth,
        answers: researchAnswers,
      }
      : null
  const researchSystemPrompt = researchBrief && researchBudget
    ? buildResearchSystemPrompt({
      topic: researchBrief.topic,
      answers: researchBrief.answers,
      budget: researchBudget,
    })
    : ''
  const streamInstructions = [projectSystemPrompt, researchSystemPrompt]
    .filter(Boolean)
    .join('\n\n') || undefined

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
          effectiveTools,
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
            tools: effectiveTools,
            reasoning: body.data.reasoning,
            researchDepth: persistedResearchDepth,
          },
          publicId: newMessage.id,
          ignoreConflict: true,
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
    _parentRequestId: parentRequestId,
    chatId: chat.id,
    userId,
    modelId: model.id,
    providerId: provider.id,
    reasoning: body.data.reasoning,
    tools: effectiveTools,
    researchDepth,
  })

  // Mirror Cloudflare edge metadata (colo, country, ASN, etc.) onto the
  // ai-stream event so geo-grouped queries work for AI cost too. The parent
  // request logger gets this via the evlog-request-observability plugin;
  // standalone child loggers don't inherit so we attach explicitly.
  attachCloudflareMeta(aiLogger, event)

  const requestedTools = chat.messages.length === 1
    ? chat.messages[0]?.tools || []
    : effectiveTools
  const providerId = toSupportedProviderId(provider.id)

  logger.set({
    providerId: provider.id,
    modelId: model.id,
  })

  let instance: LanguageModel
  let parsedTools: FormattedTools = {}
  let reasoningEffort: 'low' | 'medium' | 'high' | undefined
  const providerOptions: SharedV2ProviderOptions = {}

  try {
    switch (provider.id) {
      case 'openai': {
        const {
          instance: openAiInstance,
          tools: openAiTools,
          providerOptions: openAiProviderOptions,
          reasoning: openAiReasoning,
        } = await useOpenAI(
          session.user.id,
          model.id,
          requestedTools,
          body.data.reasoning,
          researchDepth,
        )

        instance = openAiInstance
        parsedTools = openAiTools
        reasoningEffort = openAiReasoning
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
          reasoning: googleReasoning,
        } = await useGoogle(
          session.user.id,
          model.id,
          requestedTools,
          body.data.reasoning,
          researchDepth,
        )

        instance = googleInstance
        parsedTools = googleTools
        reasoningEffort = googleReasoning
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
      tools: effectiveTools,
    })

    return new Response(JSON.stringify(chatError), {
      status: chatError.status || 500,
      headers: {
        'content-type': 'application/json',
      },
    })
  }

  // The provider modules expose the native web-search tool under a key whose
  // name contains "search" (OpenAI `web_search`, Google `web_search`). Deriving
  // it here keeps the loop-control code provider-agnostic: prepareStep pins
  // `toolChoice` to this tool to force another search step.
  const researchSearchToolName = isResearch
    ? Object.keys(parsedTools.tools ?? {}).find((name) => {
      return name.toLowerCase().includes('search')
    })
    : undefined

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
        await kv.put(generatingKey, '1', {
          expirationTtl: researchGenerationTtlSeconds,
        })
      } catch (exception) {
        logger.set({
          generationGuard: {
            operation: 'put',
            error: exception instanceof Error
              ? exception.message
              : String(exception),
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
        const researchMilestoneState = createResearchMilestoneState()
        const researchSourceRegistry = createResearchSourceRegistry()

        // Emit an immediate planning milestone before the first provider step
        // so the client starts its elapsed timer and shows progress right away
        // instead of waiting on the first `onStepFinish` (the run previously
        // looked stuck for the whole first provider round-trip).
        if (isResearch && researchBudget) {
          const planningMilestone = buildInitialResearchPlanningMilestone({
            state: researchMilestoneState,
            budget: researchBudget,
          })

          writer.write({
            type: 'data-research-step',
            id: `research-step-${planningMilestone.phase}`,
            data: planningMilestone,
          })
        }

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
            instructions: streamInstructions,
            reasoning: reasoningEffort,
            messages: await convertToModelMessages(messagesForAI),
            experimental_transform: smoothStream(),
            stopWhen: isResearch && researchBudget
              ? [
                stepCountIs(researchBudget.maxSteps),
                ({ steps }) => {
                  if (!researchBudget) {
                    return false
                  }

                  registerResearchSourcesFromSteps(
                    researchSourceRegistry,
                    steps,
                  )

                  const lastStep = steps[steps.length - 1]

                  return shouldStopResearch({
                    sourceCount: researchSourceRegistry.uniqueUrls.size,
                    targetSources: researchBudget.targetSources,
                    lastStepToolCallCount: lastStep?.toolCalls.length ?? 0,
                  })
                },
              ]
              : undefined,
            // The loop's core fix. Provider-native web search returns a
            // finished grounded answer in one step, so without forcing the
            // model stops after ~1 search. While below the source target and
            // not on the final step, pin `toolChoice` to the search tool so the
            // model MUST search again (finishReason 'tool-calls' keeps the loop
            // going); once the target is reached or the budget is nearly spent
            // release to 'auto' so it synthesizes. `pruneMessages` drops stale
            // reasoning/tool results between steps so many sources don't blow
            // the context window (SDK helper, verified against ai@7.0.14).
            prepareStep: isResearch
              ? ({ stepNumber, steps, messages }) => {
                if (!researchBudget) {
                  return undefined
                }

                registerResearchSourcesFromSteps(
                  researchSourceRegistry,
                  steps,
                )

                const sourceCount = researchSourceRegistry.uniqueUrls.size
                const forceSearch = shouldForceResearchSearch({
                  stepNumber,
                  maxSteps: researchBudget.maxSteps,
                  sourceCount,
                  targetSources: researchBudget.targetSources,
                })

                return {
                  messages: pruneMessages({
                    messages,
                    reasoning: 'before-last-message',
                    toolCalls: 'before-last-2-messages',
                  }),
                  instructions: buildResearchStepInstructions({
                    baseInstructions:
                      streamInstructions ?? researchSystemPrompt,
                    budget: researchBudget,
                    sourceCount,
                    forceSearch,
                  }),
                  toolChoice: forceSearch && researchSearchToolName
                    ? { type: 'tool', toolName: researchSearchToolName }
                    : 'auto',
                }
              }
              : undefined,
            onStepFinish: isResearch
              ? (step) => {
                if (!researchBudget) {
                  return
                }

                const milestones = mapStepToResearchMilestones({
                  step,
                  state: researchMilestoneState,
                  budget: researchBudget,
                  registry: researchSourceRegistry,
                })

                for (const data of milestones) {
                  writer.write({
                    type: 'data-research-step',
                    id: `research-step-${data.phase}`,
                    data,
                  })
                }
              }
              : undefined,
            onEnd({ usage }) {
              aiLogger.set({
                ai: {
                  tokens: {
                    input: usage.inputTokens ?? 0,
                    output: usage.outputTokens ?? 0,
                    reasoning: usage.outputTokenDetails?.reasoningTokens,
                    total: usage.totalTokens
                      ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
                  },
                  cost: computeModelCost(model.id, provider.id, usage),
                },
              })
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
            tools: effectiveTools,
          })

          throw chatError
        }

        if (researchBrief) {
          writer.write({
            type: 'data-research-brief',
            data: researchBrief,
          })
        }

        const uiMessageStream = toUIMessageStream({
          stream: result.stream,
          originalMessages: messagesForAI,
          generateMessageId: () => messagePublicId,
          sendSources: true,
          sendReasoning: body.data.reasoning !== 'off',
          messageMetadata({ part }) {
            if (part.type !== 'finish') {
              return undefined
            }

            const usage = buildMessageUsage(
              part.totalUsage,
              model.id,
              provider.id,
            )

            return {
              createdAt: new Date().toISOString(),
              ...(usage ? { usage } : {}),
            }
          },
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
              tools: effectiveTools,
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
          providerId: provider.id,
          supportedProviderId: providerId,
          userId,
          chatId: chat.id,
          projectId: chat.projectId,
          modelId: model.id,
          reasoning: body.data.reasoning,
          tools: effectiveTools,
          researchDepth: persistedResearchDepth,
          researchBrief,
          publicId: messagePublicId,
          logger,
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

          cfCtx.waitUntil(sendPushNotificationToUser(
            db,
            userId,
            isResearch
              ? {
                title: 'Your research is ready',
                body: 'Open the chat to view your research report.',
                url: `/chats/${params.data.slug}`,
                tag: 'besidka-research-ready',
              }
              : {
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
              error: exception instanceof Error
                ? exception.message
                : String(exception),
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

// Returns the inserted { id, publicId } row, OR `undefined` when
// `ignoreConflict` is set and the public_id already existed (ON CONFLICT DO
// NOTHING inserts no row, so `.get()` yields undefined). Callers that pass
// `ignoreConflict: true` must not assume a row came back.
async function insertMessageWithPublicId(input: {
  db: ReturnType<typeof useDb>
  values: typeof schema.messages.$inferInsert
  publicId: string
  ignoreConflict?: boolean
}) {
  const insert = input.db
    .insert(schema.messages)
    .values({
      ...input.values,
      publicId: input.publicId,
    })

  // Belt-and-suspenders idempotency for issue #263. The in-memory duplicate
  // scan reads a single chat snapshot, so two near-simultaneous retries of the
  // same user message (before either commits, and before any assistant reply
  // exists to replay) could both pass it. ON CONFLICT DO NOTHING keeps this a
  // single atomic statement (preserving the #205/#207 fix — no insert-then-
  // update) and guarantees a duplicate public_id can never again surface as a
  // message-persist-failed 500. It does NOT serialize the racing requests: the
  // losing one no-ops here and still streams its own assistant, so that rare
  // window can leave a second assistant row (no error, no data loss) rather
  // than a 500. Closing that fully would need a lock/transaction, which is not
  // worth it for D1 at this probability. Scoped to the public_id target so an
  // unrelated constraint still throws. Only the user-message insert opts in;
  // the assistant insert keeps strict behavior so a genuine DB failure still
  // surfaces loudly.
  const statement = input.ignoreConflict
    ? insert.onConflictDoNothing({ target: schema.messages.publicId })
    : insert

  return await statement
    .returning({
      id: schema.messages.id,
      publicId: schema.messages.publicId,
    })
    .get()
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

    if (part.type === 'data-research-brief') {
      chunks.push({
        type: 'data-research-brief',
        data: part.data,
      } as InferUIMessageChunk<UIMessage>)

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
  supportedProviderId: 'openai' | 'google' | undefined
  userId: number
  chatId: string
  projectId: string | null
  modelId: string
  reasoning: 'off' | 'low' | 'medium' | 'high'
  tools: string[]
  researchDepth?: ResearchDepth | null
  researchBrief?: ResearchBriefData | null
  publicId: string
  logger: {
    set: (fields: Record<string, unknown>) => void
  }
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
    const persistedParts = normalizedParts.filter((part) => {
      return part.type !== 'data-research-brief'
    })

    if (input.researchBrief) {
      persistedParts.push({
        type: 'data-research-brief',
        data: input.researchBrief,
      })
    }

    let usage: MessageUsage | undefined

    try {
      usage = buildMessageUsage(
        await input.result.usage,
        input.modelId,
        input.providerId,
      )
    } catch (exception) {
      input.logger.set({
        usageCapture: {
          error: exception instanceof Error
            ? exception.message
            : String(exception),
        },
      })
    }

    await insertMessageWithPublicId({
      db: input.db,
      values: {
        chatId: input.chatId,
        role: 'assistant',
        parts: persistedParts,
        tools: [],
        reasoning: input.reasoning,
        usage: usage ?? null,
        researchDepth: input.researchDepth ?? null,
      },
      publicId: input.publicId,
    })

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

function hasSameParts(
  leftParts: UIMessage['parts'],
  rightParts: UIMessage['parts'],
): boolean {
  return JSON.stringify(leftParts || []) === JSON.stringify(rightParts || [])
}

function hasSameTools(
  leftTools: Tools,
  rightTools: Tools,
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

import type { ArtifactBridgeCompletion } from '#shared/utils/artifacts'
import {
  ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
  ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS,
  ARTIFACT_BRIDGE_NO_KEY_CODE,
  ARTIFACT_BRIDGE_PROMPT_MAX,
  ARTIFACT_BRIDGE_SYSTEM_MAX,
  ARTIFACT_BRIDGE_TIMEOUT_MS,
  buildArtifactBridgeSystem,
} from '#shared/utils/artifacts'
import { getModel } from '#shared/utils/model'
import { generateText } from 'ai'
import { createError } from 'evlog'
import {
  defineEventHandler,
  getRequestHeader,
  readValidatedBody,
} from 'nuxt/server'
import { z } from 'zod'
import { buildMessageUsage } from '~~/server/utils/ai/message-usage'
import {
  instantiateDirectModel,
  isDirectModelProvider,
  readAvailableKeys,
} from '~~/server/utils/ai/resolve-cheapest-model'
import { resolveArtifactViewerAccess } from '~~/server/utils/artifacts/access'
import {
  consumeArtifactBridgeCall,
  findArtifactBridgeModel,
  readArtifactBridgeRemaining,
} from '~~/server/utils/artifacts/bridge'
import { ARTIFACT_SHARE_HEADER } from '~~/server/utils/artifacts/viewer-storage-request'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { requireFeature } from '~~/server/utils/features/guards'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import {
  assertLegalConsent,
  assertProviderTransferConsent,
  readLegalConsent,
} from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BRIDGE_ANALYTICS_EVENT = 'artifact_bridge_call'

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
})

const bodySchema = z.object({
  prompt: z.string().min(1).max(ARTIFACT_BRIDGE_PROMPT_MAX),
  system: z.string().max(ARTIFACT_BRIDGE_SYSTEM_MAX).optional(),
  modelId: z.string().min(1).max(200),
  maxOutputTokens: z.number().int().min(1)
    .max(ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS)
    .optional(),
})

function createNoKeyError() {
  return createError({
    message: 'This needs a direct provider key',
    status: 400,
    code: ARTIFACT_BRIDGE_NO_KEY_CODE,
    why: 'Artifacts can call a model only with your own key for that '
      + 'provider. Gateway keys are not used.',
    fix: 'Add a key in Profile → API keys, or choose another model.',
    data: { reason: ARTIFACT_BRIDGE_NO_KEY_CODE },
  })
}

function recordBridgeAnalytics(blobs: string[]) {
  try {
    useAnalytics()?.writeDataPoint({
      blobs: [BRIDGE_ANALYTICS_EVENT, ...blobs],
      indexes: [BRIDGE_ANALYTICS_EVENT],
    })
  } catch {
    return
  }
}

/**
 * Runs one capped, non-streaming completion for an artifact on the
 * viewer's own direct provider key, after the viewer confirmed it in the
 * parent. No tools, memory, chat history or web search; the system text is
 * the fixed Besidka prefix plus the artifact's own text, exactly as the
 * confirmation modal showed it. Legal and transfer consent are checked
 * before the key, the caps and the provider call. Prompts and answers are
 * never stored or logged; the wide event carries ids, tokens and cost only.
 */
export default defineEventHandler(async (
  event,
): Promise<ArtifactBridgeCompletion> => {
  await requireFeature(event, 'artifacts.llm-bridge')

  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const params = paramsSchema.safeParse(getDecodedRouterParams(event))

  if (!params.success) {
    throw createError({
      message: 'Invalid artifact',
      status: 400,
      why: params.error.message,
    })
  }

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (!body.success) {
    throw createError({
      message: 'Invalid AI request',
      status: 400,
      why: body.error.message,
    })
  }

  const viewerUserId = parseInt(session.user.id)
  const db = useDb()
  const startedAt = Date.now()
  const bridgeLog: Record<string, unknown> = {
    origin: 'artifact-bridge',
    artifactId: params.data.id,
    modelId: body.data.modelId,
  }

  logger.set({
    userId: viewerUserId,
    attributes: { artifactBridge: bridgeLog },
  })

  const access = await resolveArtifactViewerAccess({
    db,
    viewerUserId,
    artifactId: params.data.id,
    shareToken: getRequestHeader(event, ARTIFACT_SHARE_HEADER) ?? null,
  })

  bridgeLog.mode = access.mode
  logger.set({ attributes: { artifactBridge: bridgeLog } })

  if (!access.bridgeAllowed) {
    throw createError({
      message: 'AI requests are off for this artifact',
      status: 403,
      why: 'The share link does not allow AI requests',
    })
  }

  const legalConsent = await readLegalConsent(viewerUserId, db)

  assertLegalConsent(legalConsent)

  const { provider } = getModel(body.data.modelId)

  if (!provider || !isDirectModelProvider(provider.id)) {
    throw createNoKeyError()
  }

  bridgeLog.providerId = provider.id
  logger.set({ attributes: { artifactBridge: bridgeLog } })
  assertProviderTransferConsent(legalConsent, provider.id)

  const availableKeys = await readAvailableKeys(
    viewerUserId,
    db,
    legalConsent,
  )
  const bridgeModel = findArtifactBridgeModel(
    availableKeys,
    body.data.modelId,
  )

  if (!bridgeModel) {
    throw createNoKeyError()
  }

  const limitScope = {
    viewerUserId,
    artifactInternalId: access.artifactInternalId,
  }

  await consumeArtifactBridgeCall(event, limitScope)

  const maxOutputTokens = body.data.maxOutputTokens
    ?? ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS
  let result: Awaited<ReturnType<typeof generateText>>

  try {
    const instance = await instantiateDirectModel(
      bridgeModel.providerId,
      bridgeModel.id,
      viewerUserId,
    )

    result = await generateText({
      model: instance.model,
      system: buildArtifactBridgeSystem(body.data.system),
      prompt: body.data.prompt,
      maxOutputTokens,
      providerOptions: instance.providerOptions,
      abortSignal: AbortSignal.timeout(ARTIFACT_BRIDGE_TIMEOUT_MS),
    })
  } catch (exception) {
    const chatError = normalizeChatError({
      error: exception,
      providerId: provider.id,
    })

    bridgeLog.durationMs = Date.now() - startedAt
    bridgeLog.error = exception instanceof Error
      ? exception.name
      : 'unknown'
    logger.set({ attributes: { artifactBridge: bridgeLog } })
    recordBridgeAnalytics([provider.id, bridgeModel.id, 'error'])

    bridgeLog.providerStatus = chatError.status ?? null
    logger.set({ attributes: { artifactBridge: bridgeLog } })

    throw createError({
      message: 'The model request failed',
      status: 502,
      why: chatError.why || chatError.message,
      fix: chatError.fix,
    })
  }

  const usage = buildMessageUsage(result.usage, bridgeModel.id, provider.id)
  const costUsd = usage?.inputCost === undefined
    ? null
    : usage.inputCost + (usage.outputCost ?? 0)
  const inputTokens = usage?.inputTokens ?? null
  const outputTokens = usage?.outputTokens ?? null

  Object.assign(bridgeLog, {
    inputTokens,
    outputTokens,
    costUsd,
    durationMs: Date.now() - startedAt,
    finishReason: result.finishReason,
  })
  logger.set({ attributes: { artifactBridge: bridgeLog } })
  recordBridgeAnalytics([provider.id, bridgeModel.id, 'ok'])

  return {
    text: result.text,
    modelId: bridgeModel.id,
    usage: { inputTokens, outputTokens },
    costUsd,
    remaining: await readArtifactBridgeRemaining(limitScope),
  }
})

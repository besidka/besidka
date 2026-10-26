import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import type {
  MemoryModelSource,
  MemoryScope,
  ResolvedMemoryModelSelection,
} from '#shared/types/memory.d'
import type { SupportedProviderId } from '#shared/types/providers.d'
import { getModel } from '#shared/utils/model'
import { providerMeta } from '#shared/utils/provider-meta'
import { createError } from 'evlog'
import { providers } from '~~/providers'
import {
  keyProviderIdForGateway,
  useGateway,
} from '~~/server/utils/gateways/index'
import {
  getCachedCloudflareGatewayCatalog,
  getCachedGatewayCatalog,
} from '~~/server/utils/gateways/catalog'
import { getCloudflareGatewayCredentials } from '~~/server/utils/gateways/cloudflare'
import {
  isTextGatewayModel,
  isUsableMemoryCatalogModel,
} from '~~/server/utils/memory/catalog-usability'
import {
  assertProviderTransferConsent,
  readLegalConsent,
  withoutUnconsentedTransferProviders,
} from '~~/server/utils/legal/consent'
import { isTransferConsentProviderId } from '#shared/utils/legal-consent'

export const MEMORY_MODEL_PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'qwen',
  'deepseek',
  'google',
  'moonshotai',
  'xai',
] as const

const RECENT_ASSISTANT_MESSAGES_SCANNED = 10
const RECENT_PROJECT_CHATS_SCANNED = 5

type DbClient = ReturnType<typeof useDb>

type MemoryModelReasoning = 'low' | 'medium' | 'high' | undefined

type MemoryModelProviderOptions = Record<string, SharedV2ProviderOptions>

export interface MemoryModelInstance {
  model: LanguageModel
  reasoning: MemoryModelReasoning
  providerOptions: MemoryModelProviderOptions
}

export interface MemoryModelLogger {
  set: (fields: Record<string, unknown>) => void
}

export interface ResolveMemoryModelInput {
  userId: number
  scope: MemoryScope
  sourceChatId?: string | null
  projectId?: string | null
  db?: DbClient
  logger?: MemoryModelLogger
}

export type ResolvedMemoryModel = ResolvedMemoryModelSelection & {
  instantiate: () => Promise<MemoryModelInstance>
}

type MemoryModelCandidate = Omit<
  ResolvedMemoryModelSelection,
  'scope' | 'source'
>

function isMemoryModelProvider(
  providerId: string,
): providerId is SupportedProviderId {
  return (MEMORY_MODEL_PROVIDER_ORDER as readonly string[])
    .includes(providerId)
}

function buildGatewayIdByKeyProviderId(): Map<string, GatewayId> {
  const gatewayIdByKeyProviderId = new Map<string, GatewayId>()

  for (const meta of Object.values(providerMeta)) {
    if (meta.kind === 'gateway') {
      gatewayIdByKeyProviderId.set(meta.keyProviderId, meta.id as GatewayId)
    }
  }

  return gatewayIdByKeyProviderId
}

type MemoryModelResolutionStep = 'setting' | 'chat'

interface MemoryModelResolutionError {
  step: MemoryModelResolutionStep
  error: string
}

interface MemoryModelResolutionContext {
  input: ResolveMemoryModelInput
  db: DbClient
  availableKeys: Set<string>
  skipped: string[]
  errors: MemoryModelResolutionError[]
}

function resolutionErrorLabel(exception: unknown): string {
  if (!(exception instanceof Error)) {
    return 'unknown'
  }

  const { status, statusCode } = exception as {
    status?: unknown
    statusCode?: unknown
  }
  const httpStatus = [status, statusCode].find((value) => {
    return typeof value === 'number'
  })

  return httpStatus === undefined
    ? exception.name
    : `${exception.name}:${httpStatus}`
}

async function readAvailableKeys(
  userId: number,
  db: DbClient,
): Promise<Set<string>> {
  const savedKeys = await db.query.keys.findMany({
    where: { userId },
    columns: {
      provider: true,
    },
  })

  const providerIds = new Set<string>(savedKeys.map((key) => {
    return key.provider
  }))

  return withoutUnconsentedTransferProviders(
    providerIds,
    await readLegalConsent(userId, db),
  )
}

function resolveDirectCandidate(
  modelId: string,
  expectedProviderId: string | null,
  step: MemoryModelResolutionStep,
  context: MemoryModelResolutionContext,
): MemoryModelCandidate | null {
  const { model, provider } = getModel(modelId)

  if (!model || !provider || !isMemoryModelProvider(provider.id)) {
    context.skipped.push(`${step}:not-in-catalog`)

    return null
  }

  if (expectedProviderId && provider.id !== expectedProviderId) {
    context.skipped.push(`${step}:not-in-catalog`)

    return null
  }

  if (!isUsableMemoryCatalogModel(model)) {
    context.skipped.push(`${step}:unusable-model`)

    return null
  }

  if (!context.availableKeys.has(provider.id)) {
    context.skipped.push(`${step}:no-key`)

    return null
  }

  return {
    providerId: provider.id,
    gatewayId: null,
    modelId: model.id,
    modelName: model.name,
  }
}

function resolveGatewayCandidate(
  gatewayId: GatewayId,
  modelId: string,
  step: MemoryModelResolutionStep,
  context: MemoryModelResolutionContext,
): MemoryModelCandidate | null {
  if (!context.availableKeys.has(keyProviderIdForGateway(gatewayId))) {
    context.skipped.push(`${step}:no-key`)

    return null
  }

  return {
    providerId: null,
    gatewayId,
    modelId,
    modelName: modelId,
  }
}

async function loadChatGatewayCatalog(
  gatewayId: GatewayId,
  context: MemoryModelResolutionContext,
): Promise<GatewayModel[] | null> {
  const options = { logger: context.input.logger }

  if (gatewayId !== 'cloudflare') {
    return await getCachedGatewayCatalog(gatewayId, options)
  }

  const credentials = await getCloudflareGatewayCredentials(
    String(context.input.userId),
  )

  if (!credentials) {
    return null
  }

  return await getCachedCloudflareGatewayCatalog(credentials, options)
}

async function resolveChatGatewayCandidate(
  gatewayId: GatewayId,
  modelId: string,
  context: MemoryModelResolutionContext,
): Promise<MemoryModelCandidate | null> {
  const candidate = resolveGatewayCandidate(
    gatewayId,
    modelId,
    'chat',
    context,
  )

  if (!candidate) {
    return null
  }

  let catalog: GatewayModel[] | null

  try {
    catalog = await loadChatGatewayCatalog(gatewayId, context)
  } catch (exception) {
    context.skipped.push('chat:catalog-unavailable')
    context.errors.push({
      step: 'chat',
      error: resolutionErrorLabel(exception),
    })

    return null
  }

  if (!catalog) {
    context.skipped.push('chat:no-key')

    return null
  }

  const catalogModel = catalog.find((candidateModel) => {
    return candidateModel.id === modelId
  })

  if (!catalogModel) {
    context.skipped.push('chat:not-in-catalog')

    return null
  }

  if (!isTextGatewayModel(catalogModel)) {
    context.skipped.push('chat:unusable-model')

    return null
  }

  return candidate
}

async function resolveFromSetting(
  context: MemoryModelResolutionContext,
): Promise<MemoryModelCandidate | null> {
  const { input, db } = context
  const settings = await db.query.userSettings.findFirst({
    where: { userId: input.userId },
    columns: {
      profileMemoryModel: true,
      profileMemoryGateway: true,
      projectMemoryModel: true,
      projectMemoryGateway: true,
    },
  })
  const modelId = input.scope === 'profile'
    ? settings?.profileMemoryModel
    : settings?.projectMemoryModel
  const gatewayId = input.scope === 'profile'
    ? settings?.profileMemoryGateway
    : settings?.projectMemoryGateway

  if (!modelId) {
    return null
  }

  if (gatewayId) {
    return resolveGatewayCandidate(gatewayId, modelId, 'setting', context)
  }

  return resolveDirectCandidate(modelId, null, 'setting', context)
}

async function findLatestAssistantUsage(
  chatId: string,
  db: DbClient,
): Promise<MessageUsage | null> {
  const assistantMessages = await db.query.messages.findMany({
    where: { chatId, role: 'assistant' },
    columns: {
      usage: true,
    },
    orderBy: { createdAt: 'desc' },
    limit: RECENT_ASSISTANT_MESSAGES_SCANNED,
  })

  for (const message of assistantMessages) {
    if (message.usage?.model && message.usage.provider) {
      return message.usage
    }
  }

  return null
}

async function findSourceChatIds(
  context: MemoryModelResolutionContext,
): Promise<string[]> {
  const { input, db } = context

  if (input.sourceChatId) {
    const chat = await db.query.chats.findFirst({
      where: { id: input.sourceChatId, userId: input.userId },
      columns: {
        id: true,
      },
    })

    return chat ? [chat.id] : []
  }

  if (input.scope !== 'project' || !input.projectId) {
    return []
  }

  const recentChats = await db.query.chats.findMany({
    where: { userId: input.userId, projectId: input.projectId },
    columns: {
      id: true,
    },
    orderBy: { activityAt: 'desc' },
    limit: RECENT_PROJECT_CHATS_SCANNED,
  })

  return recentChats.map((chat) => {
    return chat.id
  })
}

async function resolveFromChat(
  context: MemoryModelResolutionContext,
): Promise<MemoryModelCandidate | null> {
  const { input, db } = context

  if (!input.sourceChatId && !(input.scope === 'project' && input.projectId)) {
    return null
  }

  const chatIds = await findSourceChatIds(context)
  let usage: MessageUsage | null = null

  for (const chatId of chatIds) {
    usage = await findLatestAssistantUsage(chatId, db)

    if (usage) {
      break
    }
  }

  if (!usage) {
    context.skipped.push('chat:no-usage')

    return null
  }

  const gatewayId = buildGatewayIdByKeyProviderId().get(usage.provider)

  if (gatewayId) {
    return await resolveChatGatewayCandidate(gatewayId, usage.model, context)
  }

  return resolveDirectCandidate(usage.model, usage.provider, 'chat', context)
}

function resolveFromFallback(
  context: MemoryModelResolutionContext,
): MemoryModelCandidate | null {
  for (const providerId of MEMORY_MODEL_PROVIDER_ORDER) {
    if (!context.availableKeys.has(providerId)) {
      continue
    }

    const provider = providers.find((candidate) => {
      return candidate.id === providerId
    })
    const memoryModel = provider?.models.find((model) => {
      return model.forProjectMemory && isUsableMemoryCatalogModel(model)
    })

    if (!memoryModel) {
      continue
    }

    return {
      providerId,
      gatewayId: null,
      modelId: memoryModel.id,
      modelName: memoryModel.name,
    }
  }

  context.skipped.push('fallback:no-key')

  return null
}

async function runResolutionStep(
  stepName: MemoryModelResolutionStep,
  context: MemoryModelResolutionContext,
  step: () => Promise<MemoryModelCandidate | null>,
): Promise<MemoryModelCandidate | null> {
  try {
    return await step()
  } catch (exception) {
    context.skipped.push(`${stepName}:error`)
    context.errors.push({
      step: stepName,
      error: resolutionErrorLabel(exception),
    })

    return null
  }
}

/**
 * Decides which model runs memory work, without building it: the user's
 * explicit per-scope setting, else the model of the source chat, else the
 * cheapest provider the user has a key for. A failing setting or chat step
 * falls through to the next; a failing saved-keys lookup propagates, because
 * "could not read the keys" must never be reported as "no key". `null` means
 * nothing resolved. `instantiate()` builds the model lazily so a caller can
 * record the choice before any credential is read.
 */
export async function resolveMemoryModel(
  input: ResolveMemoryModelInput,
): Promise<ResolvedMemoryModel | null> {
  const skipped: string[] = []
  const errors: MemoryModelResolutionError[] = []
  const db = input.db ?? useDb()
  const availableKeys = await readAvailableKeys(input.userId, db)
  const context: MemoryModelResolutionContext = {
    input,
    db,
    availableKeys,
    skipped,
    errors,
  }
  let source: MemoryModelSource = 'setting'
  let candidate = await runResolutionStep('setting', context, () => {
    return resolveFromSetting(context)
  })

  if (!candidate) {
    source = 'chat'
    candidate = await runResolutionStep('chat', context, () => {
      return resolveFromChat(context)
    })
  }

  if (!candidate) {
    source = 'fallback'
    candidate = resolveFromFallback(context)
  }

  input.logger?.set({
    attributes: {
      memoryModel: {
        scope: input.scope,
        source: candidate ? source : null,
        gatewayId: candidate?.gatewayId ?? null,
        providerId: candidate?.providerId ?? null,
        modelId: candidate?.modelId ?? null,
        skipped,
        errors,
      },
    },
  })

  if (!candidate) {
    return null
  }

  const selection: ResolvedMemoryModelSelection = {
    scope: input.scope,
    source,
    ...candidate,
  }

  return {
    ...selection,
    instantiate: () => {
      return instantiateMemoryModel(selection, input.userId, input.logger)
    },
  }
}

function toProviderOptions(
  providerId: SupportedProviderId,
  providerOptions: SharedV2ProviderOptions,
): MemoryModelProviderOptions {
  return { [providerId]: providerOptions }
}

export async function instantiateMemoryModel(
  selection: ResolvedMemoryModelSelection,
  userId: number,
  logger?: MemoryModelLogger,
): Promise<MemoryModelInstance> {
  const { gatewayId, providerId, modelId } = selection
  const userIdValue = userId.toString()

  if (isTransferConsentProviderId(providerId)) {
    assertProviderTransferConsent(await readLegalConsent(userId), providerId)
  }

  if (gatewayId) {
    const result = await useGateway(
      gatewayId,
      userIdValue,
      modelId,
      [],
      'off',
      logger,
    )

    return {
      model: result.instance,
      reasoning: result.reasoning,
      providerOptions: result.providerOptions as MemoryModelProviderOptions,
    }
  }

  if (providerId === 'google') {
    const { instance, reasoning, providerOptions } = await useGoogle(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'openai') {
    const { instance, reasoning, providerOptions } = await useOpenAI(
      userIdValue,
      modelId,
      [],
      'low',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'anthropic') {
    const { instance, reasoning, providerOptions } = await useAnthropic(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'xai') {
    const { instance, reasoning, providerOptions } = await useXai(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'deepseek') {
    const { instance, reasoning, providerOptions } = await useDeepSeek(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'moonshotai') {
    const { instance, reasoning, providerOptions } = await useMoonshotAi(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  if (providerId === 'qwen') {
    const { instance, reasoning, providerOptions } = await useQwen(
      userIdValue,
      modelId,
      [],
      'off',
    )

    return {
      model: instance,
      reasoning,
      providerOptions: toProviderOptions(providerId, providerOptions),
    }
  }

  throw createError({
    message: 'Unsupported memory provider',
    status: 400,
    why: `Provider ${providerId} is not supported for memory.`,
  })
}

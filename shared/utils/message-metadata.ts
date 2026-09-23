import type {
  ChatMessageMetadata,
  MessageUsage,
  SearchBillingUnit,
  SearchProvider,
} from '#shared/types/message-usage.d'
import type { ModelTool } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type { ProviderMeta } from '#shared/utils/provider-meta'

export type MessageMenuInfo = {
  role: 'user' | 'assistant'
  createdAt?: string | number | Date
  model?: string
  providerId?: string
  providerLabel?: string
  providerKind?: ProviderMeta['kind']
  usedTools?: Array<ModelTool | 'deep_research'>
  reasoning?: ReasoningLevel
  tokens?: number
  reasoningTokens?: number
  cost?: number
  costIsEstimated?: boolean
  costToMessage?: number
  costToMessageIsEstimated?: boolean
  chatTotalCost?: number
  chatTotalCostIsEstimated?: boolean
  searchCost?: number
  searchUnits?: number
  searchBillingUnit?: SearchBillingUnit
  searchProvider?: SearchProvider
}

type DisplayCost = {
  amount: number
  isEstimated: boolean
}

type MenuMessage = {
  id?: string
  role: string
  metadata?: unknown
  parts?: unknown
  tools?: unknown
  reasoning?: ReasoningLevel
  createdAt?: string | number | Date
}

const persistedModelTools: ModelTool[] = [
  'web_search',
  'web_search_brave',
  'web_search_exa',
  'image_generation',
]

export function isWebSearchTool(
  tool: unknown,
): tool is 'web_search' | 'web_search_brave' | 'web_search_exa' {
  return tool === 'web_search'
    || tool === 'web_search_brave'
    || tool === 'web_search_exa'
}

export function getMessageMetadata(
  message: { metadata?: unknown, createdAt?: string | number | Date },
): ChatMessageMetadata {
  const metadata = (message.metadata ?? {}) as ChatMessageMetadata

  return {
    usage: metadata.usage,
    createdAt: metadata.createdAt ?? message.createdAt,
  }
}

/**
 * Wraps a raw persisted message (DB row shape, with a flat `usage` column)
 * into the `metadata.usage`/`metadata.createdAt` shape the rest of this file
 * and ContextMenu.client.vue read from. Both the full chat hydration
 * (app/composables/chat.ts) and the live research-completion append path
 * (app/composables/chat-research.ts) must call this on every server-sourced
 * message — skipping it is what left research messages without a model,
 * token, or price row in the context menu until a full page reload.
 */
export function hydrateMessageUsage<
  T extends {
    usage?: MessageUsage | null
    createdAt?: string | number | Date | null
  },
>(message: T): T & { metadata: ChatMessageMetadata } {
  return {
    ...message,
    metadata: {
      usage: message.usage ?? undefined,
      createdAt: message.createdAt ?? undefined,
    },
  }
}

// A provider that omits the input/output split (observed post-deploy from
// Google's deep research API, which can return only a total token count)
// still flows through buildMessageUsage()'s `?? 0` defaulting, so the usage
// ends up with inputTokens=0 and outputTokens=0 alongside a positive
// totalTokens. A real, complete generation can't produce that combination —
// zero tokens on both sides while the total is nonzero only happens when the
// split was never reported — so it's a reliable signal to fall back to the
// total instead of displaying a misleading "0", and to treat any cost
// computed from that zeroed split as unknown rather than a real $0.00.
export function hasUnknownTokenSplit(usage: MessageUsage): boolean {
  return usage.inputTokens === 0
    && usage.outputTokens === 0
    && usage.totalTokens > 0
}

function resolveDisplayTokens(
  usage: MessageUsage | undefined,
  splitTokens: number | undefined,
): number | undefined {
  if (!usage) {
    return undefined
  }

  return hasUnknownTokenSplit(usage) ? usage.totalTokens : splitTokens
}

function resolveDisplayCost(
  usage: MessageUsage | undefined,
  cost: number | undefined,
): DisplayCost | undefined {
  if (cost === undefined) {
    return undefined
  }

  if (usage && hasUnknownTokenSplit(usage) && !usage.costEstimated) {
    return undefined
  }

  return { amount: cost, isEstimated: !!usage?.costEstimated }
}

export function getMessageUsedTools(
  message: { parts?: unknown, tools?: unknown },
): Array<ModelTool | 'deep_research'> {
  const parts = Array.isArray(message.parts)
    ? message.parts
    : []

  const hasResearchPart = parts.some((part) => {
    return (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && part.type === 'data-research'
    )
  })

  if (hasResearchPart) {
    return ['deep_research']
  }

  const storedTools = Array.isArray(message.tools)
    ? message.tools
    : []

  const hasWebSearchPart = parts.some((part) => {
    return (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && (part.type === 'source-url' || part.type === 'source-document')
    )
  })
  const hasImageGenerationPart = parts.some((part) => {
    return (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && part.type === 'tool-generate_image'
    )
  })

  // `message.tools` is only ever populated on the persisted *user* message
  // row, never on the assistant row this function is normally called with
  // (see persist-user-message.ts) — so `storedTools` is always `[]` in
  // practice here, and the two checks below can never rely on it alone.
  // Brave/Exa's own tool-call part type is a reliable, always-persisted
  // stand-in: unlike native search, it names the exact provider, so we
  // don't need to fall back to the generic `hasWebSearchPart` inference for
  // them the way plain `web_search` does.
  const usedExternalSearchTool = parts.find((part): part is {
    type: 'tool-web_search_brave' | 'tool-web_search_exa'
  } => {
    return (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && (part.type === 'tool-web_search_brave'
        || part.type === 'tool-web_search_exa')
    )
  })?.type

  return persistedModelTools.filter((tool) => {
    if (tool === 'web_search_brave' || tool === 'web_search_exa') {
      return storedTools.includes(tool)
        || usedExternalSearchTool === `tool-${tool}`
    }

    return storedTools.includes(tool)
      || (
        tool === 'web_search'
        && hasWebSearchPart
        && !usedExternalSearchTool
        && !storedTools.some(isWebSearchTool)
      )
      || (tool === 'image_generation' && hasImageGenerationPart)
  })
}

function getFollowingAssistantUsage(
  messages: MenuMessage[],
  messageIndex: number,
) {
  const nextMessage = messages
    .slice(messageIndex + 1)
    .find((candidate) => {
      return candidate.role === 'user' || candidate.role === 'assistant'
    })

  return nextMessage?.role === 'assistant'
    ? getMessageMetadata(nextMessage).usage
    : undefined
}

// Some already-persisted turns carry one blended `totalCost` instead of the
// `inputCost`/`outputCost` split every current send path produces. That total
// is shown in full on the assistant row, the one place `usage` is actually
// persisted; the paired user row contributes nothing so sumMessageCosts()
// below never double-counts it.
function getPerMessageCost(
  messages: MenuMessage[],
  messageIndex: number,
): DisplayCost | undefined {
  const message = messages[messageIndex]

  if (!message) {
    return undefined
  }

  if (message.role === 'assistant') {
    const usage = getMessageMetadata(message).usage

    if (usage?.totalCost !== undefined) {
      return resolveDisplayCost(usage, usage.totalCost)
    }

    return resolveDisplayCost(usage, usage?.outputCost)
  }

  if (message.role !== 'user') {
    return undefined
  }

  const usage = getFollowingAssistantUsage(messages, messageIndex)

  if (usage?.totalCost !== undefined) {
    return undefined
  }

  return resolveDisplayCost(usage, usage?.inputCost)
}

type ProviderDisplay = {
  providerId: string
  providerLabel: string
  providerKind: ProviderMeta['kind']
}

function resolveProviderDisplay(
  usage: MessageUsage | undefined,
): ProviderDisplay | undefined {
  if (!usage?.provider) {
    return undefined
  }

  const meta = resolveProviderMetaByKeyProviderId(usage.provider)

  if (!meta) {
    return undefined
  }

  return {
    providerId: meta.id,
    providerLabel: meta.label,
    providerKind: meta.kind,
  }
}

// searchCost (Google Search grounding, Anthropic web_search, or OpenAI
// web_search) is independent of hasUnknownTokenSplit/resolveDisplayCost: it
// is billed separately from tokens, so a message's search cost is always
// trustworthy even when its token split is unknown. This is why
// cumulative totals (costToMessage/chatTotalCost) can flip to estimated
// while a message's own `cost` (Current message, token/image cost only)
// stays unflagged.
function getPerMessageSearchCost(
  messages: MenuMessage[],
  messageIndex: number,
): DisplayCost | undefined {
  const message = messages[messageIndex]

  if (message?.role !== 'assistant') {
    return undefined
  }

  const searchCost = getMessageMetadata(message).usage?.searchCost

  if (searchCost === undefined) {
    return undefined
  }

  return { amount: searchCost, isEstimated: true }
}

// searchCost is independent of the token split (see getPerMessageSearchCost),
// so it is accumulated separately from getPerMessageCost rather than being
// gated by the same continue that skips messages with no token cost.
function sumMessageCosts(
  messages: MenuMessage[],
  endIndex: number,
): DisplayCost | undefined {
  let total = 0
  let hasCost = false
  let isEstimated = false

  for (let index = 0; index <= endIndex; index += 1) {
    const cost = getPerMessageCost(messages, index)
    const searchCost = getPerMessageSearchCost(messages, index)

    if (cost !== undefined) {
      hasCost = true
      total += cost.amount
      isEstimated = isEstimated || cost.isEstimated
    }

    if (searchCost !== undefined) {
      hasCost = true
      total += searchCost.amount
      isEstimated = isEstimated || searchCost.isEstimated
    }
  }

  return hasCost ? { amount: total, isEstimated } : undefined
}

export function resolveMessageMenuInfo(
  messages: MenuMessage[],
  selectedMessageId: string | null,
): MessageMenuInfo | null {
  if (!selectedMessageId) {
    return null
  }

  const messageIndex = messages.findIndex((message) => {
    return message.id === selectedMessageId
  })

  const message = messages[messageIndex]

  if (!message) {
    return null
  }

  const metadata = getMessageMetadata(message)
  const cost = getPerMessageCost(messages, messageIndex)
  const costToMessage = sumMessageCosts(messages, messageIndex)
  const chatTotalCost = sumMessageCosts(messages, messages.length - 1)

  if (message.role === 'assistant') {
    const usage = metadata.usage
    const providerDisplay = resolveProviderDisplay(usage)

    return {
      role: 'assistant',
      createdAt: metadata.createdAt,
      model: usage?.model,
      providerId: providerDisplay?.providerId,
      providerLabel: providerDisplay?.providerLabel,
      providerKind: providerDisplay?.providerKind,
      usedTools: getMessageUsedTools(message),
      reasoning: message.reasoning,
      tokens: resolveDisplayTokens(usage, usage?.outputTokens),
      reasoningTokens: usage?.reasoningTokens,
      cost: cost?.amount,
      costIsEstimated: cost?.isEstimated || undefined,
      costToMessage: costToMessage?.amount,
      costToMessageIsEstimated: costToMessage?.isEstimated || undefined,
      chatTotalCost: chatTotalCost?.amount,
      chatTotalCostIsEstimated: chatTotalCost?.isEstimated || undefined,
      searchCost: usage?.searchCost,
      searchUnits: usage?.searchUnits,
      searchBillingUnit: usage?.searchBillingUnit,
      searchProvider: usage?.searchProvider,
    }
  }

  const followingUsage = getFollowingAssistantUsage(messages, messageIndex)

  return {
    role: 'user',
    createdAt: metadata.createdAt,
    tokens: resolveDisplayTokens(followingUsage, followingUsage?.inputTokens),
    cost: cost?.amount,
    costIsEstimated: cost?.isEstimated || undefined,
    costToMessage: costToMessage?.amount,
    costToMessageIsEstimated: costToMessage?.isEstimated || undefined,
    chatTotalCost: chatTotalCost?.amount,
    chatTotalCostIsEstimated: chatTotalCost?.isEstimated || undefined,
  }
}

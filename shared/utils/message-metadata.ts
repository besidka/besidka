import type {
  ChatMessageMetadata,
  MessageUsage,
} from '#shared/types/message-usage.d'
import type { ModelTool } from '#shared/types/providers.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

export type MessageMenuInfo = {
  role: 'user' | 'assistant'
  createdAt?: string | number | Date
  model?: string
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
  'image_generation',
]

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

  return persistedModelTools.filter((tool) => {
    return storedTools.includes(tool)
      || (tool === 'web_search' && hasWebSearchPart)
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

    return resolveDisplayCost(usage, usage?.outputCost)
  }

  if (message.role !== 'user') {
    return undefined
  }

  const usage = getFollowingAssistantUsage(messages, messageIndex)

  return resolveDisplayCost(usage, usage?.inputCost)
}

function sumMessageCosts(
  messages: MenuMessage[],
  endIndex: number,
): DisplayCost | undefined {
  let total = 0
  let hasCost = false
  let isEstimated = false

  for (let index = 0; index <= endIndex; index += 1) {
    const cost = getPerMessageCost(messages, index)

    if (cost === undefined) {
      continue
    }

    hasCost = true
    total += cost.amount
    isEstimated = isEstimated || cost.isEstimated
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

    return {
      role: 'assistant',
      createdAt: metadata.createdAt,
      model: usage?.model,
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

import type { ChatMessageMetadata } from '#shared/types/message-usage.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

export type MessageMenuInfo = {
  role: 'user' | 'assistant'
  createdAt?: string | number | Date
  model?: string
  usedTools?: Array<'web_search' | 'deep_research'>
  reasoning?: ReasoningLevel
  tokens?: number
  reasoningTokens?: number
  cost?: number
  costToMessage?: number
  chatTotalCost?: number
}

type MenuMessage = {
  id?: string
  role: string
  metadata?: unknown
  parts?: unknown
  reasoning?: ReasoningLevel
  createdAt?: string | number | Date
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

export function getMessageUsedTools(
  message: { parts?: unknown },
): Array<'web_search' | 'deep_research'> {
  if (!Array.isArray(message.parts)) {
    return []
  }

  const hasResearchPart = message.parts.some((part) => {
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

  const hasWebSearchPart = message.parts.some((part) => {
    return (
      typeof part === 'object'
      && part !== null
      && 'type' in part
      && (part.type === 'source-url' || part.type === 'source-document')
    )
  })

  return hasWebSearchPart ? ['web_search'] : []
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
): number | undefined {
  const message = messages[messageIndex]

  if (!message) {
    return undefined
  }

  if (message.role === 'assistant') {
    return getMessageMetadata(message).usage?.outputCost
  }

  if (message.role !== 'user') {
    return undefined
  }

  return getFollowingAssistantUsage(messages, messageIndex)?.inputCost
}

function sumMessageCosts(
  messages: MenuMessage[],
  endIndex: number,
): number | undefined {
  let total = 0
  let hasCost = false

  for (let index = 0; index <= endIndex; index += 1) {
    const cost = getPerMessageCost(messages, index)

    if (cost === undefined) {
      continue
    }

    hasCost = true
    total += cost
  }

  return hasCost ? total : undefined
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
      tokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens,
      cost,
      costToMessage,
      chatTotalCost,
    }
  }

  const followingUsage = getFollowingAssistantUsage(messages, messageIndex)

  return {
    role: 'user',
    createdAt: metadata.createdAt,
    tokens: followingUsage?.inputTokens,
    cost,
    costToMessage,
    chatTotalCost,
  }
}

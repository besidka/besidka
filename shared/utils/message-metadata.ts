import type { ChatMessageMetadata } from '#shared/types/message-usage.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

export type MessageMenuInfo = {
  role: 'user' | 'assistant'
  createdAt?: string | number | Date
  model?: string
  usedTools?: Array<'web_search'>
  reasoning?: ReasoningLevel
  tokens?: number
  reasoningTokens?: number
  cost?: number
  turnTotalCost?: number
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
): Array<'web_search'> {
  if (!Array.isArray(message.parts)) {
    return []
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

  if (message.role === 'assistant') {
    const usage = metadata.usage
    const turnTotalCost
      = usage?.inputCost !== undefined && usage?.outputCost !== undefined
        ? usage.inputCost + usage.outputCost
        : undefined

    return {
      role: 'assistant',
      createdAt: metadata.createdAt,
      model: usage?.model,
      usedTools: getMessageUsedTools(message),
      reasoning: message.reasoning,
      tokens: usage?.outputTokens,
      reasoningTokens: usage?.reasoningTokens,
      cost: usage?.outputCost,
      turnTotalCost,
    }
  }

  const nextMessage = messages
    .slice(messageIndex + 1)
    .find((candidate) => {
      return candidate.role === 'user' || candidate.role === 'assistant'
    })

  const followingUsage = nextMessage?.role === 'assistant'
    ? getMessageMetadata(nextMessage).usage
    : undefined

  return {
    role: 'user',
    createdAt: metadata.createdAt,
    tokens: followingUsage?.inputTokens,
    cost: followingUsage?.inputCost,
  }
}

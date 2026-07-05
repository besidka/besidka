import type { ChatMessageMetadata } from '#shared/types/message-usage.d'

export type MessageMenuInfo = {
  role: 'user' | 'assistant'
  createdAt?: string | number | Date
  model?: string
  usedTools?: Array<'web_search'>
  tokens?: number
  reasoningTokens?: number
  cost?: number
  turnTotalCost?: number
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

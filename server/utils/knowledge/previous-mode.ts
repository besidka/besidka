import type { MessageUsage } from '#shared/types/message-usage.d'
import type { KnowledgeDecisionMode } from '#shared/types/project-knowledge.d'

/**
 * The knowledge mode the chat's previous send used, read from the usage
 * metadata of its newest assistant message that has any (a failed row
 * without usage never reached the provider, so it left the prompt cache
 * alone). The auto-mode hysteresis needs it and a chat has no column for
 * it. Messages stored before the mode was recorded, and sends that carried
 * no knowledge, give `null`, which keeps the plain 100% budget rule.
 */
export function readPreviousKnowledgeMode(
  messages: ReadonlyArray<{ role: string, usage: MessageUsage | null }>,
): KnowledgeDecisionMode | null {
  const previousIndex = messages.findLastIndex((message) => {
    return message.role === 'assistant' && message.usage !== null
  })

  return messages[previousIndex]?.usage?.knowledgeMode ?? null
}

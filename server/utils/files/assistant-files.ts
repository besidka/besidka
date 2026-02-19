import type { UIMessage } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'

export interface NormalizeAssistantMessagePartsInput {
  parts: UIMessage['parts']
  providerId: string
  chatId: string
  userId: number
  logger: LoggerLike
}

export function sanitizeMessagesForModelContext(
  messages: UIMessage[],
): UIMessage[] {
  const sanitizedMessages: UIMessage[] = []

  for (const message of messages) {
    if (!Array.isArray(message.parts) || message.role !== 'assistant') {
      sanitizedMessages.push(message)
      continue
    }

    const sanitizedParts = message.parts.filter((part) => {
      return part.type !== 'file'
    })

    if (sanitizedParts.length === 0) {
      continue
    }

    sanitizedMessages.push({
      ...message,
      parts: sanitizedParts,
    })
  }

  return sanitizedMessages
}

/**
 * @TODO Assistant file persistence implementation:
 * 1. Detect assistant file parts (`part.type === 'file'`).
 * 2. Resolve bytes from `data:` URLs or provider URLs with strict limits.
 * 3. Persist each valid file via `persistFile(...)` with:
 *    - `source: 'assistant'`
 *    - `originProvider: input.providerId`
 *    - `originMessageId` set after assistant message row exists
 * 4. Rewrite part URLs to `/files/<storageKey>`.
 * 5. Keep assistant text response successful on partial file failures:
 *    skip failed files, emit warning context/event, store valid rewrites.
 */
export async function normalizeAssistantMessagePartsForPersistence(
  input: NormalizeAssistantMessagePartsInput,
): Promise<UIMessage['parts']> {
  const parts = input.parts || []
  const assistantFileParts = parts.filter((part) => {
    return part.type === 'file'
  })

  if (assistantFileParts.length === 0) {
    return parts
  }

  const isPersistenceEnabled = useRuntimeConfig().enableAssistantFilePersistence
    === true

  input.logger.set({
    assistantFiles: {
      action: isPersistenceEnabled
        ? 'stub-not-implemented'
        : 'skipped-feature-disabled',
      count: assistantFileParts.length,
      chatId: input.chatId,
      providerId: input.providerId,
      userId: input.userId,
    },
  })

  return parts
}

import type { UIMessage } from 'ai'
import type { LoggerLike } from '~~/server/utils/files/logger'

export interface NormalizeAssistantMessagePartsInput {
  parts: UIMessage['parts']
  providerId: string
  chatId: string
  userId: number
  logger: LoggerLike
}

const omittedFilePrefix = 'Previously attached file omitted from model context'

export function sanitizeMessagesForModelContext(
  messages: UIMessage[],
): UIMessage[] {
  const sanitizedMessages: UIMessage[] = []
  const latestUserMessage = findLatestUserMessage(messages)

  for (const message of messages) {
    if (!Array.isArray(message.parts)) {
      sanitizedMessages.push(message)
      continue
    }

    const sanitizedParts = sanitizeMessageParts(
      message,
      message === latestUserMessage,
    )

    if (sanitizedParts.length === 0) {
      continue
    }

    sanitizedMessages.push({
      id: message.id,
      role: message.role,
      parts: sanitizedParts,
    })
  }

  return sanitizedMessages
}

function findLatestUserMessage(messages: UIMessage[]): UIMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.role === 'user') {
      return message
    }
  }

  return null
}

function sanitizeMessageParts(
  message: UIMessage,
  isLatestUserMessage: boolean,
): UIMessage['parts'] {
  const sanitizedParts: UIMessage['parts'] = []

  for (const part of message.parts) {
    if (part.type === 'text') {
      sanitizedParts.push({
        type: 'text',
        text: part.text,
      })
      continue
    }

    if (part.type !== 'file' || message.role !== 'user') {
      continue
    }

    if (isLatestUserMessage) {
      sanitizedParts.push({
        type: 'file',
        mediaType: part.mediaType,
        filename: part.filename,
        url: part.url,
      })
      continue
    }

    sanitizedParts.push({
      type: 'text',
      text: getOmittedFileText(part),
    })
  }

  return sanitizedParts
}

function getOmittedFileText(part: UIMessage['parts'][number]): string {
  if (part.type !== 'file') {
    return omittedFilePrefix
  }

  const filename = part.filename?.trim()

  if (!filename) {
    return `${omittedFilePrefix}.`
  }

  return `${omittedFilePrefix}: ${filename}.`
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

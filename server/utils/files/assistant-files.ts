import type { UIMessage } from 'ai'
import type { ImageGenerationReady } from '#shared/types/image-generation.d'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  extractLocalFileStorageKey,
  isSafeFileStorageKey,
  markUrlAsGeneratedFile,
} from '#shared/utils/files'
import {
  getPersistedImageGenerationFailureText,
} from '~~/server/utils/ai/image-generation-errors'

export interface NormalizeAssistantMessagePartsInput {
  parts: UIMessage['parts']
  providerId: string
  chatId: string
  userId: number
  logger: LoggerLike
}

const omittedFilePrefix = 'Previously attached file omitted from model context'
const generatedFilePrefix = 'Generated file saved in the user file library'
const maxGeneratedImageBytes = 10 * 1024 * 1024
const maxGeneratedImageFileNameLength = 120
const safeGeneratedImageFileIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const generatedImageMediaTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

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

    if (part.type === 'file' && message.role === 'assistant') {
      sanitizedParts.push({
        type: 'text',
        text: getGeneratedFileText(part),
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

function getGeneratedFileText(part: UIMessage['parts'][number]): string {
  if (part.type !== 'file') {
    return `${generatedFilePrefix}.`
  }

  const filename = part.filename?.trim()

  if (!filename) {
    return `${generatedFilePrefix} (${part.mediaType}).`
  }

  return `${generatedFilePrefix}: ${filename} (${part.mediaType}).`
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
  const normalizedParts = await normalizeGeneratedImageToolParts(input)
  const assistantFileParts = normalizedParts.filter((part) => {
    return part.type === 'file' && !part.url.startsWith('/files/')
  })

  if (assistantFileParts.length === 0) {
    return normalizedParts
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
      userId: input.userId,
    },
    attributes: {
      assistantFiles: {
        providerId: input.providerId,
      },
    },
  })

  return normalizedParts
}

export function getGeneratedImageFileIds(
  parts: UIMessage['parts'],
  providerId?: string,
  normalizedParts?: UIMessage['parts'],
): string[] {
  const fileIds = new Set<string>()

  for (const part of parts) {
    if (
      part.type !== 'tool-generate_image'
      || part.state !== 'output-available'
      || !isImageGenerationReady(part.output, providerId)
    ) {
      continue
    }

    if (
      normalizedParts
      && !hasMatchingNormalizedFilePart(part.output, normalizedParts)
    ) {
      continue
    }

    fileIds.add(part.output.file.id)
  }

  return [...fileIds]
}

async function normalizeGeneratedImageToolParts(
  input: NormalizeAssistantMessagePartsInput,
): Promise<UIMessage['parts']> {
  const normalizedParts: UIMessage['parts'] = []
  const parts = input.parts || []
  // Some models call generate_image more than once in one turn despite the
  // tool being forced to a single choice - the redundant call fails instantly
  // with generation-busy while the real call keeps running. When the same
  // message also has a ready result, a failed part is that redundant-call
  // artifact, not a real failure worth persisting.
  const hasReadyGenerateImagePart = parts.some((candidate) => {
    return candidate.type === 'tool-generate_image'
      && candidate.state === 'output-available'
      && isImageGenerationReady(candidate.output, input.providerId)
  })

  for (const part of parts) {
    if (part.type !== 'tool-generate_image') {
      normalizedParts.push(part)
      continue
    }

    if (
      part.state === 'output-available'
      && isImageGenerationReady(part.output, input.providerId)
    ) {
      const file = await getOwnedGeneratedImageFile(
        part.output,
        input.userId,
      )

      if (!file) {
        continue
      }

      normalizedParts.push({
        type: 'file',
        mediaType: file.type,
        filename: file.name,
        url: markUrlAsGeneratedFile(`/files/${file.storageKey}`),
      })
      continue
    }

    if (part.state === 'output-error' && !hasReadyGenerateImagePart) {
      normalizedParts.push({
        type: 'text',
        text: getPersistedImageGenerationFailureText(part.errorText),
      })
    }
  }

  return normalizedParts
}

export function isKnownImageGenerationModel(
  modelId: string,
  providerId: string,
): boolean {
  const { model: modelData, provider: modelProvider } = getModel(modelId)

  return isImageGenerationModel(modelData) && modelProvider?.id === providerId
}

function isImageGenerationReady(
  output: unknown,
  providerId?: string,
): output is ImageGenerationReady {
  if (typeof output !== 'object' || output === null) {
    return false
  }

  if (!('status' in output) || output.status !== 'ready') {
    return false
  }

  if (
    !('provider' in output)
    || (output.provider !== 'openai' && output.provider !== 'google')
    || (providerId !== undefined && output.provider !== providerId)
    || !('model' in output)
    || typeof output.model !== 'string'
    || !isKnownImageGenerationModel(output.model, output.provider)
    || !('file' in output)
    || typeof output.file !== 'object'
  ) {
    return false
  }

  const file = output.file

  return file !== null
    && 'id' in file
    && typeof file.id === 'string'
    && safeGeneratedImageFileIdPattern.test(file.id)
    && 'storageKey' in file
    && isSafeFileStorageKey(file.storageKey)
    && 'name' in file
    && isSafeGeneratedImageFileName(file.name)
    && 'size' in file
    && typeof file.size === 'number'
    && Number.isSafeInteger(file.size)
    && file.size > 0
    && file.size <= maxGeneratedImageBytes
    && 'type' in file
    && typeof file.type === 'string'
    && generatedImageMediaTypes.has(file.type)
    && 'source' in file
    && file.source === 'assistant'
}

async function getOwnedGeneratedImageFile(
  output: ImageGenerationReady,
  userId: number,
) {
  const file = await useDb().query.files.findFirst({
    where: {
      id: output.file.id,
      userId,
    },
    columns: {
      id: true,
      storageKey: true,
      name: true,
      size: true,
      type: true,
      source: true,
      originProvider: true,
    },
  })

  if (
    !file
    || file.storageKey !== output.file.storageKey
    || file.name !== output.file.name
    || file.size !== output.file.size
    || file.type !== output.file.type
    || file.source !== 'assistant'
    || file.originProvider !== output.provider
  ) {
    return null
  }

  return file
}

function hasMatchingNormalizedFilePart(
  output: ImageGenerationReady,
  normalizedParts: UIMessage['parts'],
): boolean {
  return normalizedParts.some((part) => {
    return part.type === 'file'
      && part.mediaType === output.file.type
      && part.filename === output.file.name
      && extractLocalFileStorageKey(part.url) === output.file.storageKey
  })
}

function isSafeGeneratedImageFileName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxGeneratedImageFileNameLength
    && value.trim() === value
    && !value.includes('/')
    && !value.includes('\\')
    && !hasControlCharacters(value)
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const characterCode = character.charCodeAt(0)

    return characterCode <= 31 || characterCode === 127
  })
}

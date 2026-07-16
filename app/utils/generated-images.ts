import type { UIMessage } from 'ai'
import type { ChatErrorCode } from '#shared/types/chat-errors.d'
import type {
  GeneratedImageFile,
  ImageGenerationToolOutput,
} from '#shared/types/image-generation.d'
import { isHiddenFilePart } from '#shared/utils/files'
import {
  getFileDownloadUrl,
  getFileUrl,
} from '~/utils/files'

const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_GENERATION_ERROR_LENGTH = 4096
const MAX_FILE_NAME_LENGTH = 120
const MAX_MODEL_NAME_LENGTH = 128
const safeFileIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const safeStorageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const acceptedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const genericImageGenerationFailureText = [
  'The image provider could not generate this image.',
  'Revise the prompt or try a different provider.',
].join(' ')
const imageGenerationFailureTextByCode = new Map<ChatErrorCode, string>([
  [
    'generation-busy',
    [
      'An image is already being generated.',
      'Wait for the current image to finish, then try again.',
    ].join(' '),
  ],
  [
    'storage-quota',
    [
      'Not enough storage space to generate an image.',
      'Delete files in the file manager, then try again.',
    ].join(' '),
  ],
  [
    'provider-safety',
    [
      'The provider could not generate this image.',
      'Revise the prompt and try again.',
    ].join(' '),
  ],
  [
    'invalid-provider-output',
    [
      'The generated image could not be saved.',
      'Try the request again or use a different provider.',
    ].join(' '),
  ],
  [
    'image-save-failed',
    [
      'The generated image could not be saved.',
      'Try again. If it keeps failing, contact support.',
    ].join(' '),
  ],
  [
    'provider-rate-limit',
    [
      'Image generation is temporarily rate limited.',
      'Wait a moment, then try again.',
    ].join(' '),
  ],
  [
    'provider-quota-exceeded',
    [
      'The image provider quota has been exceeded.',
      'Check provider billing or use another saved provider key.',
    ].join(' '),
  ],
  [
    'provider-auth',
    [
      'The image provider rejected the saved API key.',
      'Update the provider key in settings, then try again.',
    ].join(' '),
  ],
  [
    'provider-unavailable',
    [
      'The image provider is temporarily unavailable.',
      'Try again later or use a different provider.',
    ].join(' '),
  ],
])

export interface GenerateImageToolPart {
  type: 'tool-generate_image'
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export function getGenerateImageToolPart(
  part: unknown,
): GenerateImageToolPart | null {
  if (!part || typeof part !== 'object') {
    return null
  }

  const candidate = part as Partial<GenerateImageToolPart>

  if (candidate.type !== 'tool-generate_image') {
    return null
  }

  return candidate as GenerateImageToolPart
}

export function getGenerateImageOutput(
  part: unknown,
): ImageGenerationToolOutput | null {
  const toolPart = getGenerateImageToolPart(part)
  const value = toolPart?.output

  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.status === 'generating' || candidate.status === 'saving') {
    return { status: candidate.status }
  }

  if (candidate.status !== 'ready') {
    return null
  }

  if (candidate.provider !== 'openai' && candidate.provider !== 'google') {
    return null
  }

  if (!isSafeModelName(candidate.model)) {
    return null
  }

  const file = getValidatedGeneratedImageFile(candidate.file)

  if (!file) {
    return null
  }

  return {
    status: 'ready',
    provider: candidate.provider,
    model: candidate.model,
    file,
  }
}

export function getImageGenerationFailureText(errorText: unknown): string {
  if (
    typeof errorText !== 'string'
    || errorText.length > MAX_IMAGE_GENERATION_ERROR_LENGTH
  ) {
    return genericImageGenerationFailureText
  }

  try {
    const parsedError = JSON.parse(errorText) as unknown

    if (
      !parsedError
      || typeof parsedError !== 'object'
      || Array.isArray(parsedError)
    ) {
      return genericImageGenerationFailureText
    }

    const code = (parsedError as Record<string, unknown>).code

    if (typeof code !== 'string') {
      return genericImageGenerationFailureText
    }

    return imageGenerationFailureTextByCode.get(code as ChatErrorCode)
      || genericImageGenerationFailureText
  } catch {
    return genericImageGenerationFailureText
  }
}

export function isVisibleGenerateImageToolPart(part: unknown): boolean {
  const toolPart = getGenerateImageToolPart(part)

  if (!toolPart) {
    return false
  }

  if (toolPart.state === 'output-error') {
    return true
  }

  if (
    toolPart.state === 'input-streaming'
    || toolPart.state === 'input-available'
  ) {
    return true
  }

  return getGenerateImageOutput(toolPart) !== null
}

export function shouldRenderGenerateImageToolPart(
  message: UIMessage,
  part: unknown,
): boolean {
  if (
    message.role !== 'assistant'
    || !isVisibleGenerateImageToolPart(part)
  ) {
    return false
  }

  const output = getGenerateImageOutput(part)
  const generatedFile = output?.status === 'ready' ? output.file : null

  if (!generatedFile) {
    return true
  }

  const storageUrl = getFileUrl(generatedFile.storageKey)

  return !message.parts.some((candidate) => {
    if (candidate.type !== 'file') {
      return false
    }

    const [candidateUrl] = candidate.url.split('?')

    return candidateUrl === storageUrl
  })
}

export function shouldFitMessageBubble(
  message: Pick<UIMessage, 'role' | 'parts'>,
): boolean {
  if (message.role !== 'assistant') {
    return false
  }

  let hasImageContent = false

  for (const part of message.parts) {
    if (part.type === 'text') {
      if (part.text.trim()) {
        return false
      }

      continue
    }

    if (part.type === 'reasoning') {
      if (part.text.trim()) {
        return false
      }

      continue
    }

    if (part.type === 'step-start') {
      continue
    }

    if (part.type === 'file') {
      if (!part.mediaType.startsWith('image/') && !isHiddenFilePart(part)) {
        return false
      }

      hasImageContent = true

      continue
    }

    return false
  }

  return hasImageContent
}

function getValidatedGeneratedImageFile(
  value: unknown,
): GeneratedImageFile | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    !isSafeFileId(candidate.id)
    || !isSafeStorageKey(candidate.storageKey)
    || !isSafeFileName(candidate.name)
    || !isSafeFileSize(candidate.size)
    || !isAcceptedImageType(candidate.type)
    || candidate.source !== 'assistant'
  ) {
    return null
  }

  return {
    id: candidate.id,
    storageKey: candidate.storageKey,
    name: candidate.name,
    size: candidate.size,
    type: candidate.type,
    source: candidate.source,
    url: getFileUrl(candidate.storageKey),
    downloadUrl: getFileDownloadUrl(candidate.storageKey),
  }
}

function isSafeFileId(value: unknown): value is string {
  return typeof value === 'string' && safeFileIdPattern.test(value)
}

function isSafeStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && value !== '.'
    && value !== '..'
    && safeStorageKeyPattern.test(value)
}

function isSafeFileName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_FILE_NAME_LENGTH
    && value.trim() === value
    && !value.includes('/')
    && !value.includes('\\')
    && !hasControlCharacters(value)
}

function isSafeFileSize(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_GENERATED_IMAGE_BYTES
}

function isAcceptedImageType(value: unknown): value is string {
  return typeof value === 'string' && acceptedImageTypes.has(value)
}

function isSafeModelName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_MODEL_NAME_LENGTH
    && value.trim() === value
    && !hasControlCharacters(value)
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const characterCode = character.charCodeAt(0)

    return characterCode <= 31 || characterCode === 127
  })
}

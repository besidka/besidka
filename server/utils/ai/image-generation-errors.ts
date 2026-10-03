import type { ChatErrorCode } from '#shared/types/chat-errors.d'
import type {
  ImageGenerationProvider,
} from '#shared/types/image-generation.d'
import {
  IMAGE_GENERATION_FAILURE_TEXT,
  isPersistedImageFailureText,
} from '#shared/utils/chat-failure-text'
import { normalizeChatError } from '~~/server/utils/chats/errors'

interface ImageGenerationErrorDefinition {
  code: ChatErrorCode
  message: string
  why: string
  fix: string
  status: number
  persistenceText: string
}

export interface SafeImageGenerationError
  extends Omit<ImageGenerationErrorDefinition, 'persistenceText'> {
  providerStatus?: number
  providerRequestId?: string
}

const imageGenerationErrors = {
  generationBusy: {
    code: 'generation-busy',
    message: 'Please wait a few seconds before generating another image.',
    why: 'The account-wide image generation lock is still cooling down '
      + 'from the last request.',
    fix: 'Only one image generates at a time per account, with a short '
      + 'cooldown between images.',
    status: 429,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.generationBusy,
  },
  storageQuota: {
    code: 'storage-quota',
    message: 'Not enough storage space to generate an image.',
    why: 'Image generation requires at least 10 MB of available file storage.',
    fix: 'Delete files in the file manager, then try again.',
    status: 400,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.storageQuota,
  },
  providerSafety: {
    code: 'provider-safety',
    message: 'The provider could not generate this image.',
    why: 'The request did not pass the provider safety checks.',
    fix: 'Revise the prompt and try again.',
    status: 400,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerSafety,
  },
  invalidProviderOutput: {
    code: 'invalid-provider-output',
    message: 'The generated image could not be saved.',
    why: 'The provider returned an invalid or unsupported image.',
    fix: 'Try the request again or use a different provider.',
    status: 502,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.invalidProviderOutput,
  },
  imageSaveFailed: {
    code: 'image-save-failed',
    message: 'The generated image could not be saved.',
    why: 'Besidka could not save the generated file.',
    fix: 'Try again. If it keeps failing, contact support.',
    status: 500,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.imageSaveFailed,
  },
  providerRateLimit: {
    code: 'provider-rate-limit',
    message: 'Image generation is temporarily rate limited.',
    why: 'The image provider is throttling requests right now.',
    fix: 'Wait a moment, then try again.',
    status: 429,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerRateLimit,
  },
  providerQuotaExceeded: {
    code: 'provider-quota-exceeded',
    message: 'The image provider quota has been exceeded.',
    why: 'The saved provider key has no available image generation quota.',
    fix: 'Check provider billing or use another saved provider key.',
    status: 429,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerQuotaExceeded,
  },
  providerAuth: {
    code: 'provider-auth',
    message: 'The image provider rejected the saved API key.',
    why: 'The key is invalid or does not allow this image model.',
    fix: 'Update the provider key in settings, then try again.',
    status: 401,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerAuth,
  },
  providerModelRestricted: {
    code: 'provider-model-restricted',
    message: 'Your gateway account can\'t use this model.',
    why: 'The saved gateway account is not entitled to this image model.',
    fix: 'Add paid credits to your gateway account, or choose a different'
      + ' model.',
    status: 403,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerModelRestricted,
  },
  providerUnavailable: {
    code: 'provider-unavailable',
    message: 'The image provider is temporarily unavailable.',
    why: 'The provider could not complete the image request.',
    fix: 'Try again later or use a different provider.',
    status: 503,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.providerUnavailable,
  },
  generic: {
    code: 'unknown',
    message: 'The image provider could not generate this image.',
    why: 'The provider rejected the image request or returned no image.',
    fix: 'Revise the prompt or try a different provider.',
    status: 502,
    persistenceText: IMAGE_GENERATION_FAILURE_TEXT.generic,
  },
} as const satisfies Record<string, ImageGenerationErrorDefinition>

const persistedErrorsByCode = new Map<string, string>(
  Object.values(imageGenerationErrors).map((definition) => {
    return [definition.code, definition.persistenceText]
  }),
)

/**
 * A previously persisted image-generation failure notice must never be fed
 * back to the model as if it were real assistant content on a later turn
 * (it would otherwise get echoed verbatim, `(ref: ...)` and all). Delegates
 * to the shared `isPersistedImageFailureText`, the single set also used by
 * `parsePersistedChatFailureNotice`, so a message sanitized for model
 * context (this function's callers) and one rendered as an error card
 * always agree on what counts as a failure notice — including the
 * gateway-image-save failure text, which is not one of this module's own
 * per-code `persistenceText` values.
 */
export function isPersistedImageGenerationFailureText(
  text: string,
): boolean {
  return isPersistedImageFailureText(text)
}

export function getSafeImageGenerationError(
  exception: unknown,
  provider: ImageGenerationProvider,
): SafeImageGenerationError {
  const message = getExceptionMessage(exception)
  const normalizedMessage = message.toLowerCase()
  const chatError = normalizeChatError({
    error: exception,
    providerId: provider,
  })
  const providerContext = {
    providerStatus: chatError.status,
    providerRequestId: chatError.providerRequestId,
  }
  let definition: ImageGenerationErrorDefinition

  if (
    normalizedMessage.includes('already being generated')
    || normalizedMessage.includes('already been started')
  ) {
    definition = imageGenerationErrors.generationBusy
  } else if (
    normalizedMessage.includes('storage')
    || normalizedMessage.includes('10 mb')
  ) {
    definition = imageGenerationErrors.storageQuota
  } else if (
    normalizedMessage.includes('safety')
    || normalizedMessage.includes('content policy')
    || normalizedMessage.includes('moderation')
    || normalizedMessage.includes('prohibited')
  ) {
    definition = imageGenerationErrors.providerSafety
  } else if (
    normalizedMessage.includes('unsupported or malformed')
    || normalizedMessage.includes('empty image')
    || normalizedMessage.includes('larger than 10 mb')
  ) {
    definition = imageGenerationErrors.invalidProviderOutput
  } else if (normalizedMessage.includes('failed to upload file')) {
    definition = imageGenerationErrors.imageSaveFailed
  } else if (chatError.code === 'provider-rate-limit') {
    definition = imageGenerationErrors.providerRateLimit
  } else if (chatError.code === 'provider-quota-exceeded') {
    definition = imageGenerationErrors.providerQuotaExceeded
  } else if (chatError.code === 'provider-auth') {
    definition = imageGenerationErrors.providerAuth
  } else if (chatError.code === 'provider-model-restricted') {
    definition = imageGenerationErrors.providerModelRestricted
  } else if (chatError.code === 'provider-unavailable') {
    definition = imageGenerationErrors.providerUnavailable
  } else {
    definition = imageGenerationErrors.generic
  }

  return {
    code: definition.code,
    message: definition.message,
    why: definition.why,
    fix: definition.fix,
    status: definition.status,
    ...providerContext,
  }
}

export function getPersistedImageGenerationFailureText(
  errorText: unknown,
): string {
  const parsedError = parseStreamError(errorText)

  if (!parsedError) {
    return imageGenerationErrors.generic.persistenceText
  }

  const reference = getFailureReference(parsedError)

  if (parsedError.code) {
    const persistedText = persistedErrorsByCode.get(parsedError.code)

    if (persistedText) {
      return withFailureReference(persistedText, reference)
    }
  }

  const matchedDefinition = Object.values(imageGenerationErrors)
    .find((definition) => {
      return definition.message === parsedError.message
    })

  if (matchedDefinition) {
    return withFailureReference(matchedDefinition.persistenceText, reference)
  }

  return withFailureReference(
    imageGenerationErrors.generic.persistenceText,
    reference,
  )
}

const safeFailureReferencePattern = /^[A-Za-z0-9_.:-]{1,128}$/

function getFailureReference(
  parsedError: { requestId?: string, providerRequestId?: string },
): string | undefined {
  const reference = parsedError.providerRequestId || parsedError.requestId

  return reference && safeFailureReferencePattern.test(reference)
    ? reference
    : undefined
}

function withFailureReference(
  text: string,
  reference: string | undefined,
): string {
  return reference ? `${text} (ref: ${reference})` : text
}

function parseStreamError(
  errorText: unknown,
): {
  code?: string
  message?: string
  requestId?: string
  providerRequestId?: string
} | undefined {
  if (typeof errorText !== 'string' || !errorText.trim().startsWith('{')) {
    return undefined
  }

  try {
    const parsed = JSON.parse(errorText) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }

    const record = parsed as Record<string, unknown>

    return {
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string'
        ? record.message
        : undefined,
      requestId: typeof record.requestId === 'string'
        ? record.requestId
        : undefined,
      providerRequestId: typeof record.providerRequestId === 'string'
        ? record.providerRequestId
        : undefined,
    }
  } catch {
    return undefined
  }
}

function getExceptionMessage(exception: unknown): string {
  if (exception instanceof Error) {
    return exception.message
  }

  if (
    typeof exception === 'object'
    && exception !== null
    && 'statusMessage' in exception
    && typeof exception.statusMessage === 'string'
  ) {
    return exception.statusMessage
  }

  return String(exception)
}

const EMPTY_ANSWER_FAILURE_TEXT = 'The model finished searching but didn\'t'
  + ' write an answer. Try again or pick another model.'

/**
 * Canonical `persistenceText` values for every image-generation error code
 * defined in `server/utils/ai/image-generation-errors.ts`. That server
 * module imports this object directly rather than redeclaring the strings,
 * so the two can never drift.
 */
export const IMAGE_GENERATION_FAILURE_TEXT = {
  generationBusy: [
    'Please wait a few seconds before generating another image.',
    'Only one image generates at a time per account, with a short',
    'cooldown between images.',
  ].join(' '),
  storageQuota: [
    'Not enough storage space to generate an image.',
    'Delete files in the file manager, then try again.',
  ].join(' '),
  providerSafety: [
    'The provider could not generate this image because the request did',
    'not pass its safety checks. Revise the prompt and try again.',
  ].join(' '),
  invalidProviderOutput: [
    'The generated image could not be saved.',
    'Try the request again or use a different provider.',
  ].join(' '),
  imageSaveFailed: [
    'The generated image could not be saved.',
    'Try again. If it keeps failing, contact support.',
  ].join(' '),
  providerRateLimit: [
    'Image generation is temporarily rate limited.',
    'Wait a moment, then try again.',
  ].join(' '),
  providerQuotaExceeded: [
    'The image provider quota has been exceeded.',
    'Check provider billing or use another saved provider key.',
  ].join(' '),
  providerAuth: [
    'The image provider rejected the saved API key.',
    'Update the provider key in settings, then try again.',
  ].join(' '),
  providerModelRestricted: [
    'Your gateway account can\'t use this model.',
    'Add paid credits to your gateway account, or choose a different',
    'model.',
  ].join(' '),
  providerUnavailable: [
    'The image provider is temporarily unavailable.',
    'Try again later or use a different provider.',
  ].join(' '),
  generic: [
    'Image generation failed.',
    'Revise the prompt or try a different provider.',
  ].join(' '),
} as const

const GATEWAY_GENERATED_IMAGE_FAILURE_TEXT
  = 'An image was generated but could not be saved.'

export function getGatewayGeneratedImageFailureText(): string {
  return GATEWAY_GENERATED_IMAGE_FAILURE_TEXT
}

const imageFailureTextSet = new Set<string>([
  ...Object.values(IMAGE_GENERATION_FAILURE_TEXT),
  GATEWAY_GENERATED_IMAGE_FAILURE_TEXT,
])
const failureReferenceSuffixPattern
  = / \(ref: ([A-Za-z0-9_.:-]{1,128})\)$/

export interface ChatFailureNotice {
  message: string
  requestId?: string
}

/**
 * The fixed notice persisted when a turn ran a follow-up-turn tool (Brave,
 * Exa, or Moonshot's Formula-API web search) but the model never produced
 * any visible text afterward — see `resolveToolLoopOptions` in
 * `server/utils/ai/tool-loop.ts` for why Anthropic in particular can still
 * end a turn this way even with the step budget exhausted. Kept as a fixed
 * string, mirroring `image-generation-errors.ts`'s `persistenceText`
 * pattern, so `isPersistedEmptyAnswerFailureText` can recognize it by exact
 * content and strip it from model context on a later turn — it must never
 * be echoed back as if it were real assistant content.
 */
export function getPersistedEmptyAnswerFailureText(): string {
  return EMPTY_ANSWER_FAILURE_TEXT
}

export function isPersistedEmptyAnswerFailureText(text: string): boolean {
  return text === EMPTY_ANSWER_FAILURE_TEXT
}

const OVERSIZED_RESPONSE_FAILURE_TEXT = 'The response was too large to save.'
  + ' Try again or pick another model.'

/**
 * The fixed notice `stripUndeliveredInlineDataParts`
 * (`server/utils/files/assistant-files.ts`) persists when an assistant
 * response's parts are still too large for a single D1 row/string/BLOB
 * (2,000,000 bytes — see https://developers.cloudflare.com/d1/platform/limits/)
 * even after every known inline `data:` URL part has already been replaced.
 * Kept here rather than server-side so `parsePersistedChatFailureNotice`
 * below can recognize it too, mirroring `getPersistedEmptyAnswerFailureText`'s
 * pattern.
 */
export function getPersistedOversizedResponseFailureText(): string {
  return OVERSIZED_RESPONSE_FAILURE_TEXT
}

export function isPersistedOversizedResponseFailureText(
  text: string,
): boolean {
  return text === OVERSIZED_RESPONSE_FAILURE_TEXT
}

/**
 * Recognizes both the direct-provider image-generation `persistenceText`
 * values (`IMAGE_GENERATION_FAILURE_TEXT`) and the gateway-image-save
 * failure text `persistGatewayGeneratedImageParts`/
 * `stripUndeliveredInlineDataParts` (`server/utils/files/assistant-files.ts`)
 * persist for a gateway-routed model, optionally followed by a
 * `(ref: <id>)` suffix. This is the single set both
 * `parsePersistedChatFailureNotice` below and the server-side
 * `isPersistedImageGenerationFailureText`
 * (`server/utils/ai/image-generation-errors.ts`) check against, so a chat
 * message sanitized for model context and one rendered as an error card
 * always agree on what counts as a failure notice.
 */
export function isPersistedImageFailureText(text: string): boolean {
  const referenceMatch = text.match(failureReferenceSuffixPattern)
  const textWithoutReference = referenceMatch
    ? text.slice(0, referenceMatch.index)
    : text

  return imageFailureTextSet.has(textWithoutReference)
}

/**
 * Parses a persisted assistant text part into a structured failure notice
 * when it exactly matches one of the fixed notices above (empty-answer,
 * oversized-response) or one of the image-related failure texts recognized
 * by `isPersistedImageFailureText`, optionally followed by a
 * `(ref: <id>)` suffix. Returns `null` for any other text, including real
 * assistant content that happens to start the same way.
 */
export function parsePersistedChatFailureNotice(
  text: string,
): ChatFailureNotice | null {
  if (
    isPersistedEmptyAnswerFailureText(text)
    || isPersistedOversizedResponseFailureText(text)
  ) {
    return { message: text }
  }

  if (!isPersistedImageFailureText(text)) {
    return null
  }

  const referenceMatch = text.match(failureReferenceSuffixPattern)
  const textWithoutReference = referenceMatch
    ? text.slice(0, referenceMatch.index)
    : text

  return {
    message: textWithoutReference,
    requestId: referenceMatch?.[1],
  }
}

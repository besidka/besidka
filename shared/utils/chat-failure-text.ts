const EMPTY_ANSWER_FAILURE_TEXT = 'The model finished searching but didn\'t'
  + ' write an answer. Try again or pick another model.'

/**
 * Verbatim copies of `persistenceText` from
 * `server/utils/ai/image-generation-errors.ts`. Shared code can't import
 * that server-only module, so the fixed strings are mirrored here instead —
 * keep both lists in sync if a `persistenceText` value ever changes.
 */
const IMAGE_GENERATION_FAILURE_TEXTS = [
  [
    'Please wait a few seconds before generating another image.',
    'Only one image generates at a time per account, with a short',
    'cooldown between images.',
  ].join(' '),
  [
    'Not enough storage space to generate an image.',
    'Delete files in the file manager, then try again.',
  ].join(' '),
  [
    'The provider could not generate this image because the request did',
    'not pass its safety checks. Revise the prompt and try again.',
  ].join(' '),
  [
    'The generated image could not be saved.',
    'Try the request again or use a different provider.',
  ].join(' '),
  [
    'The generated image could not be saved.',
    'Try again. If it keeps failing, contact support.',
  ].join(' '),
  [
    'Image generation is temporarily rate limited.',
    'Wait a moment, then try again.',
  ].join(' '),
  [
    'The image provider quota has been exceeded.',
    'Check provider billing or use another saved provider key.',
  ].join(' '),
  [
    'The image provider rejected the saved API key.',
    'Update the provider key in settings, then try again.',
  ].join(' '),
  [
    'Your gateway account can\'t use this model.',
    'Add paid credits to your gateway account, or choose a different',
    'model.',
  ].join(' '),
  [
    'The image provider is temporarily unavailable.',
    'Try again later or use a different provider.',
  ].join(' '),
  [
    'Image generation failed.',
    'Revise the prompt or try a different provider.',
  ].join(' '),
]

const imageGenerationFailureTextSet = new Set<string>(
  IMAGE_GENERATION_FAILURE_TEXTS,
)
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
 * Parses a persisted assistant text part into a structured failure notice
 * when it exactly matches one of the fixed notices above (empty-answer,
 * oversized-response) or one of the image-generation `persistenceText`
 * values mirrored in `IMAGE_GENERATION_FAILURE_TEXTS`, optionally followed
 * by a `(ref: <id>)` suffix. Returns `null` for any other text, including
 * real assistant content that happens to start the same way.
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

  const referenceMatch = text.match(failureReferenceSuffixPattern)
  const textWithoutReference = referenceMatch
    ? text.slice(0, referenceMatch.index)
    : text

  if (!imageGenerationFailureTextSet.has(textWithoutReference)) {
    return null
  }

  return {
    message: textWithoutReference,
    requestId: referenceMatch?.[1],
  }
}

export const CONNECTOR_CALL_ERROR_CATEGORIES = [
  'auth',
  'timeout',
  'unreachable',
  'server-error',
  'rate-limited',
  'protocol',
  'tool-changed',
  'unknown',
] as const

export type ConnectorCallErrorCategory
  = typeof CONNECTOR_CALL_ERROR_CATEGORIES[number]

export const CONNECTOR_CALL_ERROR_REASONS: Readonly<
  Record<ConnectorCallErrorCategory, string>
> = {
  'auth': 'the service rejected the credentials',
  'timeout': 'the service did not answer in time',
  'unreachable': 'the service could not be reached',
  'server-error': 'the service reported a server error',
  'rate-limited': 'the service is limiting requests, so try again later',
  'protocol': 'the service sent an answer that could not be used',
  'tool-changed': 'the tool changed since it was reviewed',
  'unknown': 'the reason is not known',
}

export const CONNECTOR_CALL_FAILURE_PREFIX = 'The connector tool call failed'
export const CONNECTOR_CALL_ERROR_LOG_MAX = 10
export const CONNECTOR_CALL_LOG_MAX = 20

const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const REFERENCE_GROUP_LENGTH = 4
const REFERENCE_LENGTH = REFERENCE_GROUP_LENGTH * 2
const REFERENCE_BITS_PER_CHARACTER = 5
const REFERENCE_CHARACTERS_PER_WORD = 6
const FNV_OFFSET = 0x811C9DC5
const FNV_PRIME = 0x01000193
const SECOND_HASH_SEED = 0x9E3779B9
const IDENTIFIER_MAX_LENGTH = 64
const REFERENCE_PATTERN = '[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}'
const FAILURE_TEXT_PATTERN = new RegExp(
  `^${CONNECTOR_CALL_FAILURE_PREFIX}: [a-z ',]{3,80} `
  + `\\((${CONNECTOR_CALL_ERROR_CATEGORIES.join('|')})\\)\\. `
  + `Reference: (${REFERENCE_PATTERN})\\.$`,
)

export interface ParsedConnectorCallError {
  category: ConnectorCallErrorCategory
  reference: string
  reason: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hashText(text: string, seed: number): number {
  let hash = seed

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }

  return hash >>> 0
}

function randomWord(): number {
  const words = new Uint32Array(1)

  crypto.getRandomValues(words)

  return words[0]!
}

function encodeReference(firstWord: number, secondWord: number): string {
  let reference = ''

  for (let index = 0; index < REFERENCE_LENGTH; index++) {
    const isFirstWord = index < REFERENCE_CHARACTERS_PER_WORD
    const word = isFirstWord ? firstWord : secondWord
    const shift = (isFirstWord ? index : index - REFERENCE_CHARACTERS_PER_WORD)
      * REFERENCE_BITS_PER_CHARACTER

    reference += REFERENCE_ALPHABET[(word >>> shift) & 31]

    if (index === REFERENCE_GROUP_LENGTH - 1) {
      reference += '-'
    }
  }

  return reference
}

function cleanIdentifier(value: string | undefined): string {
  return (value ?? '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, IDENTIFIER_MAX_LENGTH)
}

/**
 * A short support reference for one failed connector call, written as two
 * groups of four characters (`7KQ2-M9XD`) so it can be read aloud. It is a
 * hash of the send's request id and the tool call id, so a call is
 * identifiable in the logs through the same two values; when neither id is
 * known it is random.
 */
export function buildConnectorCallReference(input: {
  requestId?: string
  toolCallId?: string
}): string {
  const requestId = cleanIdentifier(input.requestId)
  const toolCallId = cleanIdentifier(input.toolCallId)

  if (!requestId && !toolCallId) {
    return encodeReference(randomWord(), randomWord())
  }

  const seedText = `${requestId}:${toolCallId || randomWord()}`

  return encodeReference(
    hashText(seedText, FNV_OFFSET),
    hashText(seedText, SECOND_HASH_SEED),
  )
}

export function isConnectorCallErrorCategory(
  value: unknown,
): value is ConnectorCallErrorCategory {
  return typeof value === 'string'
    && (CONNECTOR_CALL_ERROR_CATEGORIES as readonly string[]).includes(value)
}

/**
 * The only text a failed connector call shows to the model, the user and the
 * database: a sentence Besidka wrote from a category and a reference. Text a
 * remote server wrote never takes part in it.
 */
export function buildConnectorCallErrorText(
  category: ConnectorCallErrorCategory,
  reference: string,
): string {
  return `${CONNECTOR_CALL_FAILURE_PREFIX}: `
    + `${CONNECTOR_CALL_ERROR_REASONS[category]} (${category}). `
    + `Reference: ${reference}.`
}

function unwrapErrorMessage(errorText: string): string {
  const trimmed = errorText.trim()

  if (!trimmed.startsWith('{')) {
    return trimmed
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)

    if (isRecord(parsed) && typeof parsed.message === 'string') {
      return parsed.message.trim()
    }
  } catch {
    return trimmed
  }

  return trimmed
}

/**
 * Reads the category and reference back from an error text, either the plain
 * sentence or the JSON the stream wraps it in. Returns null for the legacy
 * fixed text and for anything else, so no other text is ever trusted.
 */
export function parseConnectorCallErrorText(
  errorText: unknown,
): ParsedConnectorCallError | null {
  if (typeof errorText !== 'string' || errorText.length > 2000) {
    return null
  }

  const match = FAILURE_TEXT_PATTERN.exec(unwrapErrorMessage(errorText))

  if (!match || !isConnectorCallErrorCategory(match[1]) || !match[2]) {
    return null
  }

  return {
    category: match[1],
    reference: match[2],
    reason: CONNECTOR_CALL_ERROR_REASONS[match[1]],
  }
}

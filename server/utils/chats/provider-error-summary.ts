import type { GatewayId } from '#shared/types/gateways.d'
import type { SupportedProviderId } from '#shared/types/providers.d'

const SUMMARY_MAX_LENGTH = 160
const SERVER_ERROR_MIN_STATUS = 500
const SERVER_ERROR_MAX_STATUS = 599
const QUOTA_STATUS = 402
const RATE_LIMIT_STATUS = 429
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi
const TOKEN_PATTERN = /\b(?:sk-|AIza|xai-|key-)[\w-]{8,}|\b[\w-]{32,}\b/g
const KEY_ASSIGNMENT_PATTERN
  = /\b(?:api[_ -]?key|token|secret|authorization|bearer)\b\s*[:=]?\s*\S+/gi
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/g
const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,48}$/

const PROVIDER_NAMES: Record<SupportedProviderId | GatewayId, string> = {
  openai: 'OpenAI',
  google: 'Google',
  anthropic: 'Anthropic',
  xai: 'xAI',
  deepseek: 'DeepSeek',
  moonshotai: 'Moonshot AI',
  qwen: 'Qwen',
  vercel: 'Vercel AI Gateway',
  cloudflare: 'Cloudflare AI Gateway',
  openrouter: 'OpenRouter',
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value
    : undefined
}

function parseBody(error: Record<string, unknown>): Record<string, unknown> {
  const body = readText(error.responseBody)

  if (body) {
    try {
      const parsed = asRecord(JSON.parse(body))

      if (parsed) {
        return parsed
      }
    } catch {
      return {}
    }
  }

  return asRecord(error.data) ?? {}
}

function readStatus(error: Record<string, unknown>): number | undefined {
  const nested = asRecord(error.cause ?? error.error)

  for (const candidate of [
    error.statusCode,
    error.status,
    nested?.statusCode,
    nested?.status,
  ]) {
    if (typeof candidate === 'number') {
      return candidate
    }
  }

  return undefined
}

function isSummarisedStatus(status: number): boolean {
  return status === QUOTA_STATUS
    || status === RATE_LIMIT_STATUS
    || (status >= SERVER_ERROR_MIN_STATUS && status <= SERVER_ERROR_MAX_STATUS)
}

function sanitise(text: string): string {
  return text
    .replace(CONTROL_CHARACTER_PATTERN, ' ')
    .replace(URL_PATTERN, '')
    .replace(KEY_ASSIGNMENT_PATTERN, '')
    .replace(TOKEN_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text: string): string {
  return text.length <= SUMMARY_MAX_LENGTH
    ? text
    : `${text.slice(0, SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
}

/**
 * Google puts the status name (`RESOURCE_EXHAUSTED`) in `error.status`;
 * Anthropic and OpenAI put theirs in `error.type` or a string `error.code`.
 * Only a short identifier is kept, so a free-text field can never pass as a
 * code.
 */
function readErrorCode(
  providerError: Record<string, unknown> | undefined,
): string | undefined {
  for (const candidate of [
    providerError?.status,
    providerError?.type,
    providerError?.code,
  ]) {
    if (typeof candidate === 'string' && CODE_PATTERN.test(candidate)) {
      return candidate
    }
  }

  return undefined
}

/**
 * A short, safe line about what the provider said, for the `why` of a chat
 * error: "Google returned 429 RESOURCE_EXHAUSTED: Quota exceeded for...". It
 * is built only for a quota, rate-limit or server-side failure (402, 429,
 * 5xx), where the provider's text is about its own state and not about the
 * request, so it cannot echo the user's content (a 400 can: "Invalid value:
 * '<your text>'"). URLs, key-shaped tokens and `key=`-style assignments are
 * removed, control characters and runs of spaces collapse, and the line stops
 * at 160 characters. With no status there is no summary, so the caller keeps
 * its generic copy; a status with no body gives "Google returned 500".
 */
export function summarizeProviderError(
  error: unknown,
  providerId?: SupportedProviderId | GatewayId,
): string | undefined {
  const record = asRecord(error)

  if (!record) {
    return undefined
  }

  const status = readStatus(record)

  if (status === undefined || !isSummarisedStatus(status)) {
    return undefined
  }

  const body = parseBody(record)
  const providerError = asRecord(body.error) ?? body
  const code = readErrorCode(providerError)
  const message = sanitise(
    readText(providerError.message) ?? readText(record.message) ?? '',
  )
  const name = providerId ? PROVIDER_NAMES[providerId] : 'The provider'
  const head = `${name} returned ${status}${code ? ` ${code}` : ''}`

  return truncate(message ? `${head}: ${message}` : head)
}

import type { ChatErrorCode, ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'

interface NormalizeChatErrorInput {
  error: unknown
  event?: H3Event
  providerId?: 'openai' | 'google'
  code?: ChatErrorCode
  message?: string
  why?: string
  fix?: string
  status?: number
}

export function normalizeChatError(
  input: NormalizeChatErrorInput,
): ChatErrorPayload {
  const providerStatus = getErrorStatus(input.error)
  const providerRequestId = getProviderRequestId(input.error)
  const requestId = input.event
    ? getRequestId(input.event)
    : undefined
  const errorMessage = getErrorMessage(input.error)
  const status = input.status ?? providerStatus ?? 500
  const code = input.code || resolveChatErrorCode(
    errorMessage,
    providerStatus,
  )

  return {
    code,
    message: input.message
      || getPreferredChatMessage({
        code,
        errorMessage,
        status,
      })
      || getDefaultChatMessage(code),
    why: input.why || getDefaultChatWhy(code, errorMessage),
    fix: input.fix || getDefaultChatFix(code),
    status,
    requestId,
    providerId: input.providerId,
    providerRequestId,
  }
}

function getPreferredChatMessage(input: {
  code: ChatErrorCode
  errorMessage: string | undefined
  status: number
}): string | undefined {
  if (!input.errorMessage) {
    return undefined
  }

  if (
    input.code === 'chat-request-invalid'
    || input.code === 'provider-auth'
    || input.code === 'unknown'
  ) {
    return input.errorMessage
  }

  if (
    input.status >= 400
    && input.status < 500
    && input.status !== 429
  ) {
    return input.errorMessage
  }

  return undefined
}

export function serializeChatError(
  input: NormalizeChatErrorInput,
): string {
  return JSON.stringify(normalizeChatError(input))
}

function resolveChatErrorCode(
  errorMessage: string | undefined,
  status: number | undefined,
): ChatErrorCode {
  const normalizedMessage = errorMessage?.toLowerCase() || ''

  if (
    normalizedMessage.includes('quota')
    || normalizedMessage.includes('insufficient_quota')
  ) {
    return 'provider-quota-exceeded'
  }

  if (
    status === 429
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('too many requests')
  ) {
    return 'provider-rate-limit'
  }

  if (status === 401 || status === 403) {
    return 'provider-auth'
  }

  if (
    status !== undefined
    && status >= 500
    && status < 600
  ) {
    return 'provider-unavailable'
  }

  if (
    normalizedMessage.includes('temporarily unavailable')
    || normalizedMessage.includes('server had an error')
    || normalizedMessage.includes('failed after 3 attempts')
  ) {
    return 'provider-unavailable'
  }

  return 'unknown'
}

function getDefaultChatMessage(code: ChatErrorCode): string {
  switch (code) {
    case 'provider-rate-limit':
      return 'The provider is rate limiting requests right now.'
    case 'provider-quota-exceeded':
      return 'The provider quota has been exceeded.'
    case 'provider-unavailable':
      return 'The provider failed to process this request.'
    case 'provider-auth':
      return 'The provider rejected the API credentials.'
    case 'message-persist-failed':
      return 'The message could not be saved.'
    case 'chat-request-invalid':
      return 'The chat request is invalid.'
    default:
      return 'The chat request failed.'
  }
}

function getDefaultChatWhy(
  code: ChatErrorCode,
  errorMessage: string | undefined,
): string | undefined {
  switch (code) {
    case 'provider-rate-limit':
      return 'The upstream model provider is temporarily throttling requests.'
    case 'provider-quota-exceeded':
      return 'The saved API key does not have enough remaining quota.'
    case 'provider-unavailable':
      return 'The upstream model provider returned an internal error.'
    case 'provider-auth':
      return 'The saved API key is missing, invalid, or does not allow this model.'
    case 'message-persist-failed':
      return 'The response could not be stored in the database.'
    case 'chat-request-invalid':
      return errorMessage
    default:
      return errorMessage
  }
}

function getDefaultChatFix(code: ChatErrorCode): string | undefined {
  switch (code) {
    case 'provider-rate-limit':
      return 'Wait a moment and retry the message.'
    case 'provider-quota-exceeded':
      return 'Check your provider billing or switch to a different saved key.'
    case 'provider-unavailable':
      return 'Retry the message. If it keeps failing, try another model or provider.'
    case 'provider-auth':
      return 'Update the provider API key in settings and try again.'
    case 'message-persist-failed':
      return 'Retry the message. If it keeps failing, contact support with the request ID.'
    default:
      return 'Retry the message.'
  }
}

function getRequestId(event: H3Event): string | undefined {
  if (!('req' in event) || !event.req) {
    return undefined
  }

  return getRequestHeader(event, 'cf-ray')
    || getRequestHeader(event, 'x-request-id')
    || undefined
}

function getProviderRequestId(error: unknown): string | undefined {
  const record = asRecord(error)
  const headers = asRecord(record?.responseHeaders || record?.headers)
  const nestedError = asRecord(record?.cause || record?.error)

  return getHeaderValue(headers, 'x-request-id')
    || getHeaderValue(headers, 'request-id')
    || getHeaderValue(headers, 'openai-request-id')
    || getStringValue(nestedError?.requestId)
    || getStringValue(record?.requestId)
    || extractProviderRequestIdFromText(getErrorMessage(error))
}

function getHeaderValue(
  headers: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!headers) {
    return undefined
  }

  const matchedKey = Object.keys(headers).find((headerKey) => {
    return headerKey.toLowerCase() === key
  })

  if (!matchedKey) {
    return undefined
  }

  return getStringValue(headers[matchedKey])
}

function extractProviderRequestIdFromText(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined
  }

  const match = value.match(/request ID ([\w-]+)/i)

  return match?.[1]
}

function getErrorStatus(error: unknown): number | undefined {
  const record = asRecord(error)
  const nestedError = asRecord(record?.cause || record?.error)

  const candidates = [
    record?.statusCode,
    record?.status,
    nestedError?.statusCode,
    nestedError?.status,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return candidate
    }
  }

  return undefined
}

function getErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  const record = asRecord(error)

  return getStringValue(record?.message)
    || getStringValue(asRecord(record?.error)?.message)
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

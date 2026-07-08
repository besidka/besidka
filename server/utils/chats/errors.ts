import type { ChatErrorCode, ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { ResearchProviderId } from '#shared/types/research.d'
import type { H3Event } from 'h3'
import { getRequestHeader } from 'h3'
import { ResearchAdapterError } from '~~/server/utils/research/adapter-error'

const chatErrorCodes: ChatErrorCode[] = [
  'provider-rate-limit',
  'provider-quota-exceeded',
  'provider-unavailable',
  'provider-auth',
  'message-persist-failed',
  'chat-request-invalid',
  'research-tier-required',
  'research-verification-required',
  'research-paid-tier-required',
  'research-timeout',
  'research-cancelled',
  'research-start-failed',
  'clarification-failed',
  'unknown',
]

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
  const structuredError = getStructuredChatError(input.error)

  if (structuredError) {
    return {
      code: input.code || structuredError.code,
      message: input.message || structuredError.message,
      why: input.why || structuredError.why,
      fix: input.fix || structuredError.fix,
      status: input.status ?? structuredError.status ?? 500,
      requestId: structuredError.requestId
        || (input.event ? getRequestId(input.event) : undefined),
      providerId: input.providerId || structuredError.providerId,
      providerRequestId: structuredError.providerRequestId,
    }
  }

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
  if (!input.errorMessage || input.code === 'provider-auth') {
    return undefined
  }

  if (
    input.code === 'chat-request-invalid'
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

interface MapResearchProviderErrorInput {
  error: unknown
  providerId: ResearchProviderId
  event?: H3Event
  code?: ChatErrorCode
  message?: string
}

export function mapResearchProviderError(
  input: MapResearchProviderErrorInput,
): ChatErrorPayload {
  const classifiedCode = resolveResearchErrorCode(
    input.providerId,
    getResearchAdapterErrorStatus(input.error),
    getResearchAdapterErrorText(input.error),
  )

  return normalizeChatError({
    error: input.error,
    event: input.event,
    providerId: input.providerId,
    code: classifiedCode || input.code,
    message: classifiedCode ? undefined : input.message,
  })
}

function resolveResearchErrorCode(
  providerId: ResearchProviderId,
  status: number | undefined,
  bodyText: string,
): ChatErrorCode | undefined {
  const normalizedText = bodyText.toLowerCase()

  if (providerId === 'openai') {
    if (status === 403 && normalizedText.includes('verif')) {
      return 'research-verification-required'
    }

    if (
      status === 403
      || normalizedText.includes('model_not_found')
      || normalizedText.includes('tier')
      || normalizedText.includes('free tier')
    ) {
      return 'research-tier-required'
    }
  }

  if (
    providerId === 'google'
    && status === 403
    && normalizedText.includes('permission')
  ) {
    return 'research-paid-tier-required'
  }

  if (status === 401) {
    return 'provider-auth'
  }

  return undefined
}

function getResearchAdapterErrorStatus(error: unknown): number | undefined {
  return error instanceof ResearchAdapterError ? error.status : undefined
}

function getResearchAdapterErrorText(error: unknown): string {
  return error instanceof ResearchAdapterError ? error.message : ''
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
    case 'research-tier-required':
      return 'Deep research requires a paid tier on your OpenAI account.'
    case 'research-verification-required':
      return 'Your OpenAI organization needs verification for deep research.'
    case 'research-paid-tier-required':
      return 'Deep research requires a paid Google AI Studio tier.'
    case 'research-timeout':
      return 'The research run timed out.'
    case 'research-cancelled':
      return 'The research run was cancelled.'
    case 'research-start-failed':
      return 'Could not start the research job.'
    case 'clarification-failed':
      return 'Could not prepare research questions.'
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
    case 'research-tier-required':
      return 'OpenAI rejected deep research access for this API key.'
    case 'research-verification-required':
      return 'OpenAI requires organization verification before granting'
        + ' deep research agent access.'
    case 'research-paid-tier-required':
      return 'Google rejected deep research access for this API key.'
    case 'research-timeout':
      return 'The research run exceeded the maximum allowed time.'
    case 'research-cancelled':
      return 'The research job was cancelled before it finished.'
    case 'research-start-failed':
      return errorMessage
    case 'clarification-failed':
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
    case 'research-tier-required':
      return 'Add billing to your OpenAI account (Tier 1+ required) and try again.'
    case 'research-verification-required':
      return 'Verify your organization at platform.openai.com/settings/organization/general, then retry.'
    case 'research-paid-tier-required':
      return 'Enable billing on your Google AI Studio key to use Deep Research.'
    case 'research-timeout':
      return 'Try a narrower topic or the Quick level.'
    case 'research-cancelled':
      return 'Start a new research run if you still need this report.'
    case 'research-start-failed':
      return 'Retry the request, or try a different research level.'
    case 'clarification-failed':
      return 'Retry the request.'
    default:
      return 'Retry the message.'
  }
}

function getRequestId(event: H3Event): string | undefined {
  try {
    return getRequestHeader(event, 'cf-ray')
      || getRequestHeader(event, 'x-request-id')
      || undefined
  } catch (exception) {
    void exception

    return undefined
  }
}

function getProviderRequestId(error: unknown): string | undefined {
  const record = asRecord(error)
  const headers = asRecord(record?.responseHeaders || record?.headers)
  const nestedError = asRecord(record?.cause || record?.error)

  if (isChatErrorPayload(record)) {
    return record.providerRequestId
  }

  return getHeaderValue(headers, 'x-request-id')
    || getHeaderValue(headers, 'request-id')
    || getHeaderValue(headers, 'openai-request-id')
    || getStringValue(nestedError?.requestId)
    || getStringValue(record?.providerRequestId)
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

function getStructuredChatError(
  error: unknown,
): ChatErrorPayload | undefined {
  if (isChatErrorPayload(error)) {
    return error
  }

  if (typeof error === 'string') {
    return parseStructuredChatError(error)
  }

  if (error instanceof Error) {
    return parseStructuredChatError(error.message)
  }

  const record = asRecord(error)

  if (!record) {
    return undefined
  }

  const nestedError = record.error

  if (isChatErrorPayload(nestedError)) {
    return nestedError
  }

  return parseStructuredChatError(getStringValue(record.message))
}

function parseStructuredChatError(
  value: string | undefined,
): ChatErrorPayload | undefined {
  if (!value?.trim().startsWith('{')) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as unknown

    if (!isChatErrorPayload(parsed)) {
      return undefined
    }

    return parsed
  } catch (exception) {
    void exception

    return undefined
  }
}

function isChatErrorPayload(value: unknown): value is ChatErrorPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>

  return isChatErrorCode(record.code)
    && typeof record.message === 'string'
}

function isChatErrorCode(value: unknown): value is ChatErrorCode {
  return typeof value === 'string'
    && chatErrorCodes.includes(value as ChatErrorCode)
}

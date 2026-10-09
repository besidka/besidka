import type {
  ChatErrorCode,
  ChatErrorPayload,
  ChatToolCallErrorKind,
} from '#shared/types/chat-errors.d'
import type { GatewayId } from '#shared/types/gateways.d'
import type { SupportedProviderId } from '#shared/types/providers.d'
import type { ResearchProviderId } from '#shared/types/research.d'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'
import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { ResearchAdapterError } from '~~/server/utils/research/adapter-error'

const chatErrorCodes: ChatErrorCode[] = [
  'provider-rate-limit',
  'provider-quota-exceeded',
  'provider-unavailable',
  'provider-auth',
  'provider-model-restricted',
  'generation-busy',
  'storage-quota',
  'provider-safety',
  'invalid-provider-output',
  'image-save-failed',
  'message-persist-failed',
  'chat-request-invalid',
  'research-tier-required',
  'research-verification-required',
  'research-paid-tier-required',
  'research-timeout',
  'research-cancelled',
  'research-start-failed',
  'clarification-failed',
  'assistant-empty-answer',
  'unknown',
]

interface NormalizeChatErrorInput {
  error: unknown
  event?: RequestEvent
  providerId?: SupportedProviderId | GatewayId
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
    const structuredMessage = input.message || structuredError.message

    return {
      code: input.code || structuredError.code,
      message: structuredMessage,
      why: dedupeChatErrorWhy(
        structuredMessage,
        input.why || structuredError.why,
      ),
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
  const message = input.message
    || getPreferredChatMessage({
      code,
      errorMessage,
      status,
    })
    || getDefaultChatMessage(code)

  return {
    code,
    message,
    why: dedupeChatErrorWhy(
      message,
      input.why || getDefaultChatWhy(code, errorMessage),
    ),
    fix: input.fix || getDefaultChatFix(code, errorMessage),
    status,
    requestId,
    providerId: input.providerId,
    providerRequestId,
  }
}

export const MODEL_TOOL_CALL_ERROR_STATUS = 422
export const MODEL_TOOL_CALL_ERROR_CODE: ChatErrorCode
  = 'invalid-provider-output'
export const UNAVAILABLE_TOOL_ERROR_KIND: ChatToolCallErrorKind
  = 'unavailable-tool'
export const INVALID_TOOL_INPUT_ERROR_KIND: ChatToolCallErrorKind
  = 'invalid-tool-input'

const INVALID_TOOL_INPUT_MESSAGE_PATTERN
  = /^(?:AI_InvalidToolInputError: )?Invalid input for tool ([^:\s]+):/
const UNAVAILABLE_TOOL_MESSAGE_PATTERN
  = /^(?:AI_NoSuchToolError: )?Model tried to call unavailable tool '([^']+)'/

interface ModelToolCallErrorDetails {
  kind: ChatToolCallErrorKind
  toolName: string
}

/**
 * The SDK hands `onError` the error object for a `tool-input-error` chunk but
 * only that error's string form (`AI_<Name>: <message>`) for the
 * `tool-output-error` that follows it, so both shapes are recognized; the
 * patterns are the SDK's own `InvalidToolInputError` and `NoSuchToolError`
 * message formats.
 */
function readModelToolCallError(
  error: unknown,
): ModelToolCallErrorDetails | undefined {
  if (InvalidToolInputError.isInstance(error)) {
    return { kind: INVALID_TOOL_INPUT_ERROR_KIND, toolName: error.toolName }
  }

  if (NoSuchToolError.isInstance(error)) {
    return { kind: UNAVAILABLE_TOOL_ERROR_KIND, toolName: error.toolName }
  }

  if (typeof error !== 'string') {
    return undefined
  }

  const invalidInputMatch = INVALID_TOOL_INPUT_MESSAGE_PATTERN.exec(error)

  if (invalidInputMatch?.[1]) {
    return {
      kind: INVALID_TOOL_INPUT_ERROR_KIND,
      toolName: invalidInputMatch[1],
    }
  }

  const unavailableToolMatch = UNAVAILABLE_TOOL_MESSAGE_PATTERN.exec(error)

  if (unavailableToolMatch?.[1]) {
    return {
      kind: UNAVAILABLE_TOOL_ERROR_KIND,
      toolName: unavailableToolMatch[1],
    }
  }

  return undefined
}

/**
 * `toUIMessageStream()` passes every tool part's error through the same
 * `onError` as a real stream failure, so a tool call the model itself got
 * wrong would otherwise become an `unknown` 500 attributed to the provider.
 * `gpt-oss` calls a declared search tool with its built-in browser's
 * `{ cursor, id }` arguments and calls undeclared tools such as `open_file`;
 * neither is a provider failure. The payload carries a stable `kind`, which
 * `withSearchAnswerGuarantee()` matches to drop the expected rejection of a
 * call on the forced step. Returns `undefined`
 * for any other error so the caller keeps its normal handling.
 */
export function normalizeModelToolCallError(input: {
  error: unknown
  event?: RequestEvent
  providerId?: SupportedProviderId | GatewayId
}): ChatErrorPayload | undefined {
  const details = readModelToolCallError(input.error)

  if (!details) {
    return undefined
  }

  const chatError = normalizeChatError({
    error: input.error,
    event: input.event,
    providerId: input.providerId,
    code: MODEL_TOOL_CALL_ERROR_CODE,
    status: MODEL_TOOL_CALL_ERROR_STATUS,
    message: 'The model sent an invalid tool call.',
    why: details.kind === INVALID_TOOL_INPUT_ERROR_KIND
      ? `The model called ${details.toolName} with input that does not `
      + 'match its schema.'
      : `The model called an unavailable tool: ${details.toolName}.`,
    fix: 'Retry the message, or pick another model.',
  })

  return { ...chatError, kind: details.kind }
}

/**
 * A raw upstream message with no dedicated classification (an `unknown`
 * code, or a structured error whose `why` was never set independently) ends
 * up assigned to both `message` and `why` — see the "no endpoints available"
 * OpenRouter case that surfaced this: the toast showed the identical
 * sentence twice. `why` exists to add detail beyond the headline message, so
 * an identical `why` carries no information and is dropped.
 */
function dedupeChatErrorWhy(
  message: string,
  why: string | undefined,
): string | undefined {
  return why && why !== message ? why : undefined
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/
const HEADER_VALUE_ERROR_PATTERN
  = /invalid header|not a legal header|illegal header/i

/**
 * A malformed credential (for example a pasted API token or Cloudflare
 * account/gateway id with a trailing control character) can make the Fetch
 * API's `Headers` constructor throw a `TypeError` whose message embeds the
 * raw invalid value verbatim — e.g. Node/undici's
 * `Headers.append: "<value>" is an invalid header value.`. An error message
 * that contains a raw control character, or that reads like one of these
 * header-construction errors, is treated as a potential credential leak
 * rather than surfaced to the client or logs.
 */
function looksLikeHeaderValueLeak(message: string): boolean {
  return CONTROL_CHARACTER_PATTERN.test(message)
    || HEADER_VALUE_ERROR_PATTERN.test(message)
}

const IMAGE_INPUT_UNSUPPORTED_PATTERN = /image input|does not support image/i
const NO_ENDPOINTS_AVAILABLE_PATTERN = /no endpoints (found|available)/i
const IMAGE_TERM_PATTERN = /image/i
const IMAGE_INPUT_REJECTION_MESSAGE = 'This model does not support image'
  + ' input. Remove the attached image or switch to a vision-capable model.'

/**
 * Some gateways/providers reject an image attachment at request time with a
 * raw, unhelpful upstream message instead of a normal 400 the client-side
 * vision gate would have already caught before sending (see
 * `docs/providers/gateways.md` — Cloudflare's catalog exposes no modality
 * data at all, so the client-side gate fails open for it specifically;
 * OpenRouter has also been observed returning this for some routed
 * models). Detected by
 * content rather than status code or provider, since the same wording can
 * come from either gateway.
 */
function looksLikeImageInputRejection(message: string): boolean {
  if (IMAGE_INPUT_UNSUPPORTED_PATTERN.test(message)) {
    return true
  }

  return NO_ENDPOINTS_AVAILABLE_PATTERN.test(message)
    && IMAGE_TERM_PATTERN.test(message)
}

/**
 * A gateway reporting no routable upstream for the selected model (observed
 * from OpenRouter's auto-router: "No endpoints available for any resolved
 * ... models: <model>") is a deterministic routing failure, not a transient
 * one — retrying the identical request hits the identical routing decision.
 * "Retry the message" is actively wrong advice here.
 */
function looksLikeNoAvailableEndpointsError(message: string): boolean {
  return NO_ENDPOINTS_AVAILABLE_PATTERN.test(message)
}

function getPreferredChatMessage(input: {
  code: ChatErrorCode
  errorMessage: string | undefined
  status: number
}): string | undefined {
  if (
    !input.errorMessage
    || input.code === 'provider-auth'
    || input.code === 'provider-model-restricted'
  ) {
    return undefined
  }

  if (looksLikeImageInputRejection(input.errorMessage)) {
    return IMAGE_INPUT_REJECTION_MESSAGE
  }

  if (input.code === 'chat-request-invalid') {
    return input.errorMessage
  }

  /**
   * Unlike `chat-request-invalid` (always a caller-controlled, safe-to-show
   * validation message), an `unknown` error can originate from any
   * unclassified exception thrown anywhere in the request — including a
   * `Headers` construction failure that embeds a raw credential or header
   * value (see `looksLikeHeaderValueLeak`). Redacting only that narrow,
   * detectable case — rather than every `unknown` message outright —
   * preserves legitimate, non-sensitive `unknown`-coded messages (for
   * example client-side setup validation like "Please select a model to
   * continue.") while still closing the credential-leak path.
   */
  if (input.code === 'unknown') {
    return looksLikeHeaderValueLeak(input.errorMessage)
      ? undefined
      : input.errorMessage
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
  event?: RequestEvent
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

/**
 * Matches only Vercel AI Gateway's free-tier "RestrictedModelsError" wording
 * (see `docs/providers/gateways.md`). This is deliberately narrow — it is
 * not a general classifier for every 403, which must keep mapping to
 * `provider-auth`.
 */
const MODEL_ACCESS_RESTRICTED_PATTERN
  = /do not have access to this model|upgrade to paid credits/i

function resolveChatErrorCode(
  errorMessage: string | undefined,
  status: number | undefined,
): ChatErrorCode {
  const normalizedMessage = errorMessage?.toLowerCase() || ''

  if (
    status === 402
    || normalizedMessage.includes('quota')
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

  if (
    status === 403
    && MODEL_ACCESS_RESTRICTED_PATTERN.test(normalizedMessage)
  ) {
    return 'provider-model-restricted'
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
    case 'provider-model-restricted':
      return 'Your gateway account can\'t use this model.'
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
    case 'assistant-empty-answer':
      return 'The model finished searching but didn\'t write an answer.'
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
    case 'provider-model-restricted':
      return errorMessage && !looksLikeHeaderValueLeak(errorMessage)
        ? errorMessage
        : undefined
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
    case 'assistant-empty-answer':
      return 'The model completed its tool calls without producing a'
        + ' final response.'
    case 'unknown':
      return errorMessage && !looksLikeHeaderValueLeak(errorMessage)
        ? errorMessage
        : undefined
    default:
      return errorMessage
  }
}

function getDefaultChatFix(
  code: ChatErrorCode,
  errorMessage: string | undefined,
): string | undefined {
  switch (code) {
    case 'provider-rate-limit':
      return 'Wait a moment and retry the message.'
    case 'provider-quota-exceeded':
      return 'Check your provider billing or switch to a different saved key.'
    case 'provider-unavailable':
      return 'Retry the message. If it keeps failing, try another model or provider.'
    case 'provider-auth':
      return 'Update the provider API key in settings and try again.'
    case 'provider-model-restricted':
      return 'Add paid credits to your gateway account, or choose a'
        + ' different model.'
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
    case 'assistant-empty-answer':
      return 'Try again or pick another model.'
    default:
      return errorMessage && looksLikeNoAvailableEndpointsError(errorMessage)
        ? 'Try a different model or provider.'
        : 'Retry the message.'
  }
}

export function getRequestId(event: RequestEvent): string | undefined {
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

export function memoryExtractionErrorSummary(exception: unknown): {
  errorName: string
  status?: number
} {
  if (!(exception instanceof Error)) {
    return { errorName: 'unknown' }
  }

  const { status, statusCode } = exception as {
    status?: unknown
    statusCode?: unknown
  }
  const httpStatus = [status, statusCode].find((value) => {
    return typeof value === 'number'
  }) as number | undefined

  return httpStatus === undefined
    ? { errorName: exception.name }
    : { errorName: exception.name, status: httpStatus }
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429])
const OWN_DEADLINE_ERROR_NAMES = new Set(['TimeoutError', 'AbortError'])
const NETWORK_FAILURE_PATTERN
  = /fetch failed|network connection(?: lost)?|socket hang up|econnreset/i
const QUOTA_EXHAUSTED_PATTERN
  = /insufficient_quota|billing_hard_limit|credit balance|exceeded your current quota|plans and billing/i
const RATE_LIMIT_STATUS = 429
const MAX_ERROR_CHAIN_DEPTH = 6

function nextLinkedError(exception: Error): unknown {
  const { lastError } = exception as { lastError?: unknown }

  return lastError ?? exception.cause
}

function readHttpStatus(exception: Error): number | undefined {
  const { status, statusCode } = exception as {
    status?: unknown
    statusCode?: unknown
  }

  return [status, statusCode].find((value) => {
    return typeof value === 'number'
  }) as number | undefined
}

function stringifyErrorPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload
  }

  try {
    return JSON.stringify(payload) ?? ''
  } catch {
    return ''
  }
}

function isQuotaExhausted(exception: Error): boolean {
  const { responseBody, data } = exception as {
    responseBody?: unknown
    data?: unknown
  }

  return QUOTA_EXHAUSTED_PATTERN.test(
    `${stringifyErrorPayload(responseBody)} ${stringifyErrorPayload(data)}`,
  )
}

function isTransientLink(exception: Error): boolean | null {
  const httpStatus = readHttpStatus(exception)

  if (httpStatus === RATE_LIMIT_STATUS && isQuotaExhausted(exception)) {
    return false
  }

  if (httpStatus !== undefined) {
    return httpStatus >= 500 || TRANSIENT_HTTP_STATUSES.has(httpStatus)
  }

  if (OWN_DEADLINE_ERROR_NAMES.has(exception.name)) {
    return false
  }

  if ((exception as { isRetryable?: unknown }).isRetryable === true) {
    return true
  }

  if (exception instanceof TypeError) {
    return NETWORK_FAILURE_PATTERN.test(exception.message)
  }

  return null
}

/**
 * Tells a provider failure that a later attempt can fix (rate limit, 5xx,
 * overload, provider 408/504, dropped connection) from one it cannot (bad key,
 * missing model, refusal, malformed output, exhausted quota or billing). A
 * `TimeoutError` or `AbortError` is the deadline this pass set itself, so the
 * chat is too slow and a retry would spend the user's key again: permanent.
 * Walks the `lastError` and `cause` chain, because the AI SDK wraps retried
 * failures in a `RetryError`; the first link that carries a verdict decides.
 */
export function isTransientMemoryExtractionError(exception: unknown): boolean {
  let current: unknown = exception

  for (
    let depth = 0;
    depth < MAX_ERROR_CHAIN_DEPTH && current instanceof Error;
    depth++
  ) {
    const verdict = isTransientLink(current)

    if (verdict !== null) {
      return verdict
    }

    current = nextLinkedError(current)
  }

  return false
}

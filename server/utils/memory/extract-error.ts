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
const TRANSIENT_ERROR_NAMES = new Set(['TimeoutError', 'AbortError'])
const NETWORK_FAILURE_PATTERN
  = /fetch failed|network|socket|econnreset|connection (?:reset|closed)/i
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

function isTransientLink(exception: Error): boolean | null {
  const httpStatus = readHttpStatus(exception)

  if (httpStatus !== undefined) {
    return httpStatus >= 500 || TRANSIENT_HTTP_STATUSES.has(httpStatus)
  }

  if (TRANSIENT_ERROR_NAMES.has(exception.name)) {
    return true
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
 * overload, timeout, dropped connection) from one it cannot (bad key, missing
 * model, refusal, malformed output). Walks the `lastError` and `cause` chain,
 * because the AI SDK wraps retried failures in a `RetryError`; the first link
 * that carries a verdict decides.
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

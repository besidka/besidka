export interface SearchProviderErrorDetails {
  message: string
  status: number
  why: string
  fix: string
}

/**
 * Maps a search provider's non-2xx HTTP status to a specific, actionable
 * error instead of the blanket "temporarily unavailable" every BYOK search
 * tool previously threw for any failure. A revoked key, an exhausted
 * balance, and a transient upstream 5xx need different advice — and since
 * this throws inside a tool `execute()`, the model reads `message` as
 * `tool-error` text too, so it stays one short, concrete sentence.
 */
export function buildSearchProviderStatusError(input: {
  providerLabel: string
  status: number
}): SearchProviderErrorDetails {
  const { providerLabel, status } = input

  if (status === 401 || status === 403) {
    return {
      message: `${providerLabel} rejected the saved API key.`,
      status,
      why: `${providerLabel} responded with HTTP ${status}.`,
      fix: 'Update the key in Profile > Keys, then try again.',
    }
  }

  if (status === 402 || status === 429) {
    return {
      message: `${providerLabel} is rate limited or out of quota.`,
      status,
      why: `${providerLabel} responded with HTTP ${status}.`,
      fix: 'Check your provider billing, or wait a moment and try again.',
    }
  }

  return {
    message: `${providerLabel} is temporarily unavailable.`,
    status,
    why: `${providerLabel} responded with HTTP ${status}.`,
    fix: 'Try again shortly, or send the message without web search.',
  }
}

/**
 * `AbortSignal.timeout()` rejects the fetch itself (a `TimeoutError`
 * `DOMException`) before `response.ok` is ever reached, so a search request
 * that simply took too long previously surfaced as an unhandled rejection
 * rather than a readable tool error. A genuine caller-triggered abort (the
 * request's own `abortSignal`) must still propagate untouched — see
 * `isUserAbortError` — since that is a real cancellation, not a failure to
 * report to the model.
 */
export function buildSearchProviderNetworkError(input: {
  providerLabel: string
  exception: unknown
}): SearchProviderErrorDetails {
  const { providerLabel, exception } = input
  const isTimeout = exception instanceof DOMException
    && exception.name === 'TimeoutError'

  return {
    message: `${providerLabel} is temporarily unavailable.`,
    status: 504,
    why: isTimeout
      ? `${providerLabel}'s search request timed out.`
      : `${providerLabel}'s search request failed before a response`
        + ' arrived.',
    fix: 'Try again shortly, or send the message without web search.',
  }
}

export function isUserAbortError(exception: unknown): boolean {
  return exception instanceof DOMException && exception.name === 'AbortError'
}

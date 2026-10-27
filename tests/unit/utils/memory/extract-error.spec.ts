import { describe, expect, it } from 'vitest'
import { isTransientMemoryExtractionError } from '~~/server/utils/memory/extract-error'

function httpError(statusCode: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`http ${statusCode}`), {
    name: 'APICallError',
    statusCode,
    ...extra,
  })
}

function retryError(lastError: unknown) {
  return Object.assign(new Error('Failed after 3 attempts'), {
    name: 'RetryError',
    lastError,
  })
}

describe('isTransientMemoryExtractionError', () => {
  it.each([408, 425, 429, 500, 502, 503, 504, 529])(
    'treats HTTP %i as transient',
    (statusCode) => {
      expect(isTransientMemoryExtractionError(httpError(statusCode)))
        .toBe(true)
    },
  )

  it.each([400, 401, 402, 403, 404, 413, 422])(
    'treats HTTP %i as permanent',
    (statusCode) => {
      expect(isTransientMemoryExtractionError(httpError(statusCode)))
        .toBe(false)
    },
  )

  it('reads the status from the last error of a RetryError', () => {
    expect(isTransientMemoryExtractionError(retryError(httpError(429))))
      .toBe(true)
    expect(isTransientMemoryExtractionError(retryError(httpError(401))))
      .toBe(false)
  })

  it('treats the deadline this pass set itself as permanent', () => {
    const timeout = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    })
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const wrapped = new Error('generation failed', { cause: timeout })

    expect(isTransientMemoryExtractionError(timeout)).toBe(false)
    expect(isTransientMemoryExtractionError(abort)).toBe(false)
    expect(isTransientMemoryExtractionError(wrapped)).toBe(false)
  })

  it('treats a provider side 504 or 408 as transient', () => {
    expect(isTransientMemoryExtractionError(httpError(504))).toBe(true)
    expect(isTransientMemoryExtractionError(httpError(408))).toBe(true)
    expect(isTransientMemoryExtractionError(retryError(httpError(504))))
      .toBe(true)
  })

  it('lets the status win over isRetryable', () => {
    expect(
      isTransientMemoryExtractionError(httpError(400, { isRetryable: true })),
    ).toBe(false)
  })

  it('follows a cause chain to its verdict', () => {
    const wrapped = new Error('outer', {
      cause: new Error('middle', { cause: httpError(401) }),
    })
    const wrappedRateLimit = new Error('outer', { cause: httpError(429) })

    expect(isTransientMemoryExtractionError(wrapped)).toBe(false)
    expect(isTransientMemoryExtractionError(wrappedRateLimit)).toBe(true)
  })

  it.each([
    ['OpenAI', '{"error":{"code":"insufficient_quota","type":"insufficient_quota"}}'],
    ['Google', '{"error":{"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota, please check your plan and billing details."}}'],
    ['Anthropic', '{"error":{"message":"Your credit balance is too low"}}'],
  ])('treats a %s 429 for exhausted quota as permanent', (_provider, body) => {
    expect(
      isTransientMemoryExtractionError(httpError(429, { responseBody: body })),
    ).toBe(false)
    expect(
      isTransientMemoryExtractionError(
        retryError(httpError(429, { responseBody: body })),
      ),
    ).toBe(false)
  })

  it('reads a quota code from the parsed data too', () => {
    expect(
      isTransientMemoryExtractionError(
        httpError(429, { data: { error: { code: 'insufficient_quota' } } }),
      ),
    ).toBe(false)
  })

  it('keeps a plain or unreadable 429 transient', () => {
    expect(
      isTransientMemoryExtractionError(
        httpError(429, { responseBody: '{"error":{"code":"rate_limit_exceeded"}}' }),
      ),
    ).toBe(true)
    expect(
      isTransientMemoryExtractionError(httpError(429, { responseBody: '<html>' })),
    ).toBe(true)
  })

  it('treats a retryable call error without a status as transient', () => {
    const connection = Object.assign(new Error('Cannot connect to API'), {
      name: 'APICallError',
      isRetryable: true,
    })

    expect(isTransientMemoryExtractionError(connection)).toBe(true)
  })

  it.each([
    'fetch failed',
    'Network connection lost.',
    'socket hang up',
    'read ECONNRESET',
  ])('treats the TypeError "%s" as transient', (message) => {
    expect(isTransientMemoryExtractionError(new TypeError(message))).toBe(true)
  })

  it.each([
    'Cannot read properties of undefined',
    'networkSettings is not a function',
    'socketId is undefined',
  ])('does not treat the TypeError "%s" as a network failure', (message) => {
    expect(isTransientMemoryExtractionError(new TypeError(message))).toBe(false)
  })

  it('treats refusals, malformed output and unknown values as permanent', () => {
    const refusal = Object.assign(new Error('No object generated'), {
      name: 'AI_NoObjectGeneratedError',
    })

    expect(isTransientMemoryExtractionError(refusal)).toBe(false)
    expect(isTransientMemoryExtractionError(new Error('no-model'))).toBe(false)
    expect(isTransientMemoryExtractionError('boom')).toBe(false)
    expect(isTransientMemoryExtractionError(null)).toBe(false)
  })
})

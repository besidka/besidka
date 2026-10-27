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

  it('treats a timeout or abort anywhere in the cause chain as transient',
    () => {
      const timeout = Object.assign(new Error('timed out'), {
        name: 'TimeoutError',
      })
      const wrapped = new Error('generation failed', { cause: timeout })

      expect(isTransientMemoryExtractionError(timeout)).toBe(true)
      expect(isTransientMemoryExtractionError(wrapped)).toBe(true)
    })

  it('treats a retryable call error without a status as transient', () => {
    const connection = Object.assign(new Error('Cannot connect to API'), {
      name: 'APICallError',
      isRetryable: true,
    })

    expect(isTransientMemoryExtractionError(connection)).toBe(true)
  })

  it('treats a network TypeError as transient but not a code bug', () => {
    expect(isTransientMemoryExtractionError(new TypeError('fetch failed')))
      .toBe(true)
    expect(
      isTransientMemoryExtractionError(
        new TypeError('Cannot read properties of undefined'),
      ),
    ).toBe(false)
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

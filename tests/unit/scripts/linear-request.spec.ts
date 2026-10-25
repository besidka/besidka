import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ATTEMPTS,
  RATE_LIMIT_STEP_MS,
  SERVER_ERROR_BACKOFF_MS,
  getRetryDelay,
  isRateLimited,
  isTransientServerError,
  linearRequest,
} from '../../../scripts/linear-request.mjs'

const fetchMock = vi.fn()
const sleepMock = vi.fn()

function createResponse(status: number, body: Record<string, unknown> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }
}

function request() {
  return linearRequest({
    apiUrl: 'https://linear.test/graphql',
    apiKey: 'lin_api_test',
    query: 'mutation { documentUpdate { success } }',
    variables: {},
    sleep: sleepMock,
  })
}

describe('classification', () => {
  it('detects rate limits by status and by extension code', () => {
    expect(isRateLimited({ status: 429 }, {})).toBe(true)
    expect(isRateLimited({ status: 200 }, {
      errors: [{ extensions: { code: 'RATELIMITED' } }],
    })).toBe(true)
    expect(isRateLimited({ status: 500 }, {})).toBe(false)
  })

  it('detects transient server errors by status', () => {
    expect(isTransientServerError({ status: 500 }, {})).toBe(true)
    expect(isTransientServerError({ status: 503 }, {})).toBe(true)
    expect(isTransientServerError({ status: 400 }, {})).toBe(false)
    expect(isTransientServerError({ status: 401 }, {})).toBe(false)
  })

  it('detects transient server errors by code, type and message', () => {
    expect(isTransientServerError({ status: 200 }, {
      errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
    })).toBe(true)
    expect(isTransientServerError({ status: 200 }, {
      errors: [{ extensions: { type: 'internal server error' } }],
    })).toBe(true)
    expect(isTransientServerError({ status: 200 }, {
      errors: [{ extensions: { type: 'internal error' } }],
    })).toBe(true)
    expect(isTransientServerError({ status: 200 }, {
      errors: [{ message: 'Internal server error' }],
    })).toBe(true)
  })

  it('does not treat validation errors as transient', () => {
    expect(isTransientServerError({ status: 400 }, {
      errors: [{
        message: 'Argument Validation Error',
        extensions: { code: 'INVALID_INPUT', type: 'invalid input' },
      }],
    })).toBe(false)
  })

  it('uses the rate limit step and the shorter server error backoff', () => {
    expect(getRetryDelay({ status: 429 }, {}, 2)).toBe(2 * RATE_LIMIT_STEP_MS)
    expect(getRetryDelay({ status: 500 }, {}, 1))
      .toBe(SERVER_ERROR_BACKOFF_MS[0])
    expect(getRetryDelay({ status: 500 }, {}, 3))
      .toBe(SERVER_ERROR_BACKOFF_MS[2])
    expect(getRetryDelay({ status: 400 }, {}, 1)).toBeNull()
  })
})

describe('linearRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    sleepMock.mockReset()
  })

  it('returns data without retrying on success', async () => {
    fetchMock.mockResolvedValueOnce(createResponse(200, {
      data: { documentUpdate: { success: true } },
    }))

    await expect(request()).resolves.toEqual({
      documentUpdate: { success: true },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('retries an HTTP 500 and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse(500))
      .mockResolvedValueOnce(createResponse(200, { data: { ok: true } }))

    await expect(request()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledExactlyOnceWith(
      SERVER_ERROR_BACKOFF_MS[0],
    )
  })

  it('retries a GraphQL INTERNAL_SERVER_ERROR and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse(200, {
        errors: [{
          message: 'Internal server error',
          extensions: { code: 'INTERNAL_SERVER_ERROR' },
        }],
      }))
      .mockResolvedValueOnce(createResponse(200, { data: { ok: true } }))

    await expect(request()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleepMock).toHaveBeenCalledExactlyOnceWith(
      SERVER_ERROR_BACKOFF_MS[0],
    )
  })

  it('keeps the 15 second step for rate limits', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse(429))
      .mockResolvedValueOnce(createResponse(200, { data: { ok: true } }))

    await expect(request()).resolves.toEqual({ ok: true })
    expect(sleepMock).toHaveBeenCalledExactlyOnceWith(RATE_LIMIT_STEP_MS)
  })

  it('does not retry a 400 validation error', async () => {
    fetchMock.mockResolvedValueOnce(createResponse(400, {
      errors: [{
        message: 'Argument Validation Error',
        extensions: { code: 'INVALID_INPUT' },
      }],
    }))

    await expect(request()).rejects.toThrow('Argument Validation Error')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).not.toHaveBeenCalled()
  })

  it('throws once the retries are exhausted', async () => {
    fetchMock.mockResolvedValue(createResponse(500))

    await expect(request()).rejects.toThrow('HTTP 500')
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    expect(sleepMock.mock.calls.map(([delay]) => delay))
      .toEqual(SERVER_ERROR_BACKOFF_MS)
  })
})

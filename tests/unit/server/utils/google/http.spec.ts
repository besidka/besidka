import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertGoogleUrl,
  GOOGLE_RESPONSE_MAX_BYTES,
  googleFetchJson,
} from '~~/server/utils/google/http'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe('googleFetchJson', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    'http://oauth2.googleapis.com/token',
    'https://evil.example.com/token',
    'https://oauth2.googleapis.com.evil.example/token',
    'https://user:pass@oauth2.googleapis.com/token',
    'https://oauth2.googleapis.com:8443/token',
    'https://accounts.google.com/o/oauth2/v2/auth',
    'https://www.googleapis.com/drive/v3/files',
    'not a url',
  ])('refuses %s before any request', async (url) => {
    const fetchImpl = vi.fn()
    const failure = await failureOf(
      googleFetchJson(url, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(500)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts only the exact allowed host over https', () => {
    expect(assertGoogleUrl(TOKEN_URL).hostname).toBe('oauth2.googleapis.com')
  })

  it('posts a form body with manual redirects and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: 'a' }))
    const result = await googleFetchJson(
      TOKEN_URL,
      { method: 'POST', form: { grant_type: 'refresh_token', token: 't' } },
      { fetchImpl },
    )
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]

    expect(url).toBe(TOKEN_URL)
    expect(init.redirect).toBe('manual')
    expect(init.body).toBe('grant_type=refresh_token&token=t')
    expect((init.headers as Record<string, string>)['content-type'])
      .toBe('application/x-www-form-urlencoded')
    expect(result).toEqual({
      status: 200,
      ok: true,
      body: { access_token: 'a' },
    })
  })

  it('never follows a redirect', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.com/' },
      })
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'POST' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
    expect(failure.message).toBe('Google answered with a redirect')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns Google error bodies without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      return jsonResponse({ error: 'invalid_grant' }, 400)
    })
    const result = await googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl },
    )

    expect(result).toEqual({
      status: 400,
      ok: false,
      body: { error: 'invalid_grant' },
    })
  })

  it('times out a request that never answers', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const failure = await failureOf(googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl, timeoutMs: 20 },
    ))

    expect(failure.status).toBe(504)
  })

  it('times out a body that never finishes', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const stream = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () => {
            controller.error(new Error('aborted'))
          })
        },
      })

      return new Response(stream, { status: 200 })
    })
    const failure = await failureOf(googleFetchJson(
      TOKEN_URL,
      { method: 'POST' },
      { fetchImpl, timeoutMs: 20 },
    ))

    expect(failure.status).toBe(504)
  })

  it('maps a network failure to 502', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network down')
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
  })

  it('refuses an answer over the size cap', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('x'.repeat(GOOGLE_RESPONSE_MAX_BYTES + 1))
    })
    const failure = await failureOf(
      googleFetchJson(TOKEN_URL, { method: 'GET' }, { fetchImpl }),
    )

    expect(failure.status).toBe(502)
  })
})

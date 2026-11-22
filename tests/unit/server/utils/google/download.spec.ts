import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_DOWNLOAD_TOO_LARGE_CODE,
  googleFetchBytes,
} from '~~/server/utils/google/download'

const FILE_URL = 'https://www.googleapis.com/drive/v3/files/abc?alt=media'
const CONTENT_URL = 'https://doc-0g-1k-docs.googleusercontent.com/export/abc'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

function bytesOf(text: string) {
  return new TextEncoder().encode(text)
}

function redirectTo(location: string, status = 302) {
  return new Response(null, { status, headers: { location } })
}

describe('googleFetchBytes', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    'http://www.googleapis.com/drive/v3/files/abc?alt=media',
    'https://evil.example.com/drive/v3/files/abc',
    'https://www.googleapis.com.evil.example/drive/v3/files/abc',
    'https://user:pass@www.googleapis.com/drive/v3/files/abc',
    'https://doc-0g.googleusercontent.com/export/abc',
  ])('refuses %s before any request', async (url) => {
    const fetchImpl = vi.fn()
    const failure = await failureOf(
      googleFetchBytes(url, {}, { maxBytes: 1024, fetchImpl }),
    )

    expect(failure.status).toBe(500)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads the bytes with manual redirects and the bearer token', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(bytesOf('hello'), {
        headers: { 'content-type': 'text/plain' },
      })
    })
    const result = await googleFetchBytes(
      FILE_URL,
      { headers: { authorization: 'Bearer token-1' } },
      { maxBytes: 1024, fetchImpl },
    )
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]

    expect(result).toMatchObject({ ok: true, contentType: 'text/plain' })
    expect(result.ok && new TextDecoder().decode(result.bytes)).toBe('hello')
    expect(url).toBe(FILE_URL)
    expect(init.redirect).toBe('manual')
    expect(init.headers).toMatchObject({ authorization: 'Bearer token-1' })
  })

  it('follows one redirect to googleusercontent and drops the token',
    async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(redirectTo(CONTENT_URL))
        .mockResolvedValueOnce(new Response(bytesOf('body')))
      const result = await googleFetchBytes(
        FILE_URL,
        { headers: { Authorization: 'Bearer token-1', accept: '*/*' } },
        { maxBytes: 1024, fetchImpl },
      )
      const [secondUrl, secondInit] = fetchImpl.mock.calls[1] as unknown as [
        string,
        RequestInit,
      ]

      expect(result.ok).toBe(true)
      expect(secondUrl).toBe(CONTENT_URL)
      expect(secondInit.redirect).toBe('manual')
      expect(JSON.stringify(secondInit.headers)).not.toContain('token-1')
      expect(secondInit.headers).toMatchObject({ accept: '*/*' })
    })

  it('keeps the token on a redirect to another Google API host', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirectTo(
        'https://www.googleapis.com/download/drive/v3/files/abc',
        307,
      ))
      .mockResolvedValueOnce(new Response(bytesOf('body')))

    await googleFetchBytes(
      FILE_URL,
      { headers: { authorization: 'Bearer token-1' } },
      { maxBytes: 1024, fetchImpl },
    )

    const [, secondInit] = fetchImpl.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ]

    expect(secondInit.headers).toMatchObject({
      authorization: 'Bearer token-1',
    })
  })

  it.each([
    'https://evil.example.com/export/abc',
    'https://doc.googleusercontent.com.evil.example/export/abc',
    'http://doc-0g.googleusercontent.com/export/abc',
    'https://user:pass@doc-0g.googleusercontent.com/export/abc',
    'https://doc-0g.googleusercontent.com:8443/export/abc',
    'https://googleusercontent.com/export/abc',
  ])('refuses a redirect to %s', async (target) => {
    const fetchImpl = vi.fn(async () => redirectTo(target))
    const failure = await failureOf(googleFetchBytes(
      FILE_URL,
      { headers: { authorization: 'Bearer token-1' } },
      { maxBytes: 1024, fetchImpl },
    ))

    expect(failure.status).toBe(502)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('refuses a second redirect and a redirect without a location',
    async () => {
      const chained = vi.fn(async () => redirectTo(CONTENT_URL))
      const empty = vi.fn(async () => {
        return new Response(null, { status: 302 })
      })

      expect((await failureOf(googleFetchBytes(
        FILE_URL,
        {},
        { maxBytes: 1024, fetchImpl: chained },
      ))).status).toBe(502)
      expect(chained).toHaveBeenCalledTimes(2)
      expect((await failureOf(googleFetchBytes(
        FILE_URL,
        {},
        { maxBytes: 1024, fetchImpl: empty },
      ))).status).toBe(502)
    })

  it('stops a body that grows past the cap while it streams', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(400))
      },
      cancel,
    })
    const fetchImpl = vi.fn(async () => new Response(stream))
    const failure = await failureOf(googleFetchBytes(
      FILE_URL,
      {},
      { maxBytes: 1000, fetchImpl },
    ))

    expect(failure).toMatchObject({
      status: 413,
      code: GOOGLE_DOWNLOAD_TOO_LARGE_CODE,
    })
    expect(cancel).toHaveBeenCalled()
  })

  it('refuses a declared length over the cap without reading the body',
    async () => {
      const fetchImpl = vi.fn(async () => {
        return new Response(bytesOf('x'), {
          headers: { 'content-length': '5000' },
        })
      })
      const failure = await failureOf(googleFetchBytes(
        FILE_URL,
        {},
        { maxBytes: 1000, fetchImpl },
      ))

      expect(failure.code).toBe(GOOGLE_DOWNLOAD_TOO_LARGE_CODE)
    })

  it('returns Google\'s error reason as a value', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({
        error: { errors: [{ reason: 'exportSizeLimitExceeded' }] },
      }), { status: 403 })
    })
    const result = await googleFetchBytes(
      FILE_URL,
      {},
      { maxBytes: 1000, fetchImpl },
    )

    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: 'exportSizeLimitExceeded',
    })
  })

  it('times out a download that never finishes', async () => {
    vi.useFakeTimers()

    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    })
    const pending = failureOf(googleFetchBytes(
      FILE_URL,
      {},
      { maxBytes: 1000, fetchImpl, timeoutMs: 5000 },
    ))

    await vi.advanceTimersByTimeAsync(5001)

    expect((await pending).status).toBe(504)
  })

  it('answers 502 when Google cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network')
    })

    expect((await failureOf(googleFetchBytes(
      FILE_URL,
      {},
      { maxBytes: 1000, fetchImpl },
    ))).status).toBe(502)
  })
})

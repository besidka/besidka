import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTOR_REJECTED_HEADER_NAMES } from '#shared/utils/connectors-policy'
import {
  SAFE_FETCH_PURPOSE_POLICY,
  SAFE_FETCH_PURPOSES,
  createSafeFetch,
  safeFetch,
} from '~~/server/utils/net/safe-fetch'

type FetchCall = [string, RequestInit]

const fetchMock = vi.fn()

function calls(): FetchCall[] {
  return fetchMock.mock.calls as FetchCall[]
}

function headersOf(call: FetchCall): Headers {
  return new Headers(call[1].headers)
}

function redirect(status: number, location: string) {
  return new Response(null, { status, headers: { location } })
}

function ok(body = 'ok', headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers })
}

function streamOf(chunks: Uint8Array[]) {
  let index = 0
  const state = { pulled: 0, canceled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()

        return
      }

      state.pulled += 1
      controller.enqueue(chunks[index++]!)
    },
    cancel() {
      state.canceled = true
    },
  })

  return { stream, state }
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as Error & { code?: string, status?: number }
  }

  throw new Error('Expected a rejection')
}

describe('safeFetch', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('validation', () => {
    it.each([
      'http://example.com/mcp',
      'https://127.0.0.1/mcp',
      'https://[::1]/mcp',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/mcp',
      'https://user:pass@example.com/mcp',
      'https://example.com:22/mcp',
    ])('rejects %s without a request', async (input) => {
      const exception = await errorOf(safeFetch(input, { purpose: 'oauth' }))

      expect(exception.message).toBe('This address is not allowed')
      expect(exception.status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('accepts a Request and a URL object as input', async () => {
      fetchMock.mockImplementation(async () => ok())

      await safeFetch(new URL('https://example.com/a'), { purpose: 'oauth' })
      await safeFetch(
        new Request('https://example.com/b', { headers: { 'x-one': '1' } }),
        { purpose: 'oauth' },
      )

      expect(calls().map(call => call[0])).toEqual([
        'https://example.com/a',
        'https://example.com/b',
      ])
      expect(headersOf(calls()[1]!).get('x-one')).toBe('1')
    })

    it('validates the URL of a Request too', async () => {
      const exception = await errorOf(safeFetch(
        new Request('https://127.0.0.1/'),
        { purpose: 'oauth' },
      ))

      expect(exception.message).toBe('This address is not allowed')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('requests the normalized URL without the fragment', async () => {
      fetchMock.mockImplementation(async () => ok())

      await safeFetch('https://EXAMPLE.com./path#frag', { purpose: 'oauth' })

      expect(calls()[0]![0]).toBe('https://example.com/path')
    })

    it('always asks for redirect: manual and a purpose user agent', async () => {
      fetchMock.mockImplementation(async () => ok())

      await safeFetch('https://example.com', {
        purpose: 'skills-url',
        headers: { 'user-agent': 'custom' },
      })

      expect(calls()[0]![1].redirect).toBe('manual')
      expect(headersOf(calls()[0]!).get('user-agent'))
        .toBe('Besidka-Skills/1.0')
    })

    it.each(['oauth', 'registry', 'skills-url', 'skills-github'] as const)(
      'strips every rejected header name for purpose %s',
      async (purpose) => {
        fetchMock.mockImplementation(async () => ok())

        await safeFetch('https://example.com/x', {
          purpose,
          headers: {
            'Host': 'evil.test',
            'Cookie': 'a=b',
            'Content-Length': '999',
            'Transfer-Encoding': 'chunked',
            'Connection': 'upgrade',
            'Mcp-Session-Id': 'session',
            'Mcp-Protocol-Version': '2025-06-18',
            'X-Api-Key': 'kept',
          },
        })

        const headers = headersOf(calls()[0]!)

        for (const name of CONNECTOR_REJECTED_HEADER_NAMES) {
          expect(headers.get(name), name).toBeNull()
        }

        expect(headers.get('x-api-key')).toBe('kept')
      },
    )

    it('keeps the two MCP protocol headers for purpose mcp only', async () => {
      fetchMock.mockImplementation(async () => ok())

      await safeFetch('https://example.com/mcp', {
        purpose: 'mcp',
        method: 'POST',
        body: '{}',
        headers: {
          'Host': 'evil.test',
          'Cookie': 'a=b',
          'Content-Length': '999',
          'Transfer-Encoding': 'chunked',
          'Connection': 'upgrade',
          'Mcp-Session-Id': 'session',
          'Mcp-Protocol-Version': '2025-06-18',
        },
      })

      const headers = headersOf(calls()[0]!)

      expect(headers.get('mcp-session-id')).toBe('session')
      expect(headers.get('mcp-protocol-version')).toBe('2025-06-18')

      for (const name of [
        'host',
        'cookie',
        'content-length',
        'transfer-encoding',
        'connection',
      ]) {
        expect(headers.get(name), name).toBeNull()
      }
    })

    it('strips rejected headers on a redirect hop as well', async () => {
      fetchMock
        .mockImplementationOnce(async () => redirect(302, '/next'))
        .mockImplementationOnce(async () => ok())

      await safeFetch('https://example.com/x', {
        purpose: 'oauth',
        headers: { Connection: 'upgrade', Cookie: 'a=b' },
      })

      expect(headersOf(calls()[1]!).get('connection')).toBeNull()
      expect(headersOf(calls()[1]!).get('cookie')).toBeNull()
    })

    it('refuses Besidka\'s own host, first hop and redirect hop', async () => {
      const first = await errorOf(safeFetch('https://besidka.com/api/v1/x', {
        purpose: 'oauth',
      }))

      expect(first.message).toBe('This address is not allowed')
      expect(fetchMock).not.toHaveBeenCalled()

      fetchMock.mockImplementationOnce(async () => {
        return redirect(302, 'https://pr-1-besidka.chernenko.workers.dev/x')
      })

      const hop = await errorOf(safeFetch('https://example.com/start', {
        purpose: 'oauth',
      }))

      expect(hop.message).toBe('This address is not allowed')
      expect(hop.code).toBe('safe-fetch-own-host')
    })

    it('never forwards cookies or a host header', async () => {
      fetchMock.mockImplementation(async () => ok())

      await safeFetch('https://example.com', {
        purpose: 'mcp',
        headers: {
          cookie: 'session=1',
          host: 'evil.test',
          authorization: 'Bearer token',
        },
      })

      const headers = headersOf(calls()[0]!)

      expect(headers.get('cookie')).toBeNull()
      expect(headers.get('host')).toBeNull()
      expect(headers.get('authorization')).toBe('Bearer token')
    })
  })

  describe('redirects', () => {
    it('refuses a redirect to the metadata address', async () => {
      fetchMock.mockImplementationOnce(async () => {
        return redirect(302, 'https://169.254.169.254/latest/meta-data')
      })

      const exception = await errorOf(
        safeFetch('https://example.com/start', { purpose: 'oauth' }),
      )

      expect(exception.message).toBe('This address is not allowed')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it.each([
      'http://example.com/next',
      'https://[::ffff:7f00:1]/',
      'https://localhost/',
      'https://2130706433/',
      'https://example.com:8080/',
      'file:///etc/passwd',
    ])('refuses a redirect to %s', async (location) => {
      fetchMock.mockImplementationOnce(async () => redirect(302, location))

      const exception = await errorOf(
        safeFetch('https://example.com/start', { purpose: 'oauth' }),
      )

      expect(exception.message).toBe('This address is not allowed')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('resolves a relative Location against the current URL', async () => {
      fetchMock
        .mockImplementationOnce(async () => redirect(302, '/moved?x=1'))
        .mockImplementationOnce(async () => ok('final'))

      const response = await safeFetch('https://example.com/a/b', {
        purpose: 'oauth',
      })

      expect(calls()[1]![0]).toBe('https://example.com/moved?x=1')
      expect(await response.text()).toBe('final')
      expect(response.url).toBe('https://example.com/moved?x=1')
    })

    it('follows three hops and refuses the fourth', async () => {
      fetchMock.mockImplementation(async () => redirect(302, '/again'))

      const exception = await errorOf(
        safeFetch('https://example.com/start', { purpose: 'oauth' }),
      )

      expect(exception.status).toBe(502)
      expect(exception.message).toBe('The server redirected too many times')
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('honors a lower maxRedirects', async () => {
      fetchMock.mockImplementation(async () => redirect(302, '/again'))

      await errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
        maxRedirects: 1,
      }))

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not follow a redirect without a Location header', async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(null, { status: 302 })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect(response.status).toBe(302)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not follow a 304', async () => {
      fetchMock.mockImplementationOnce(async () => {
        return new Response(null, {
          status: 304,
          headers: { location: 'https://127.0.0.1/' },
        })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect(response.status).toBe(304)
    })

    describe('across origins', () => {
      it('drops Authorization and every other credential header', async () => {
        fetchMock
          .mockImplementationOnce(async () => {
            return redirect(302, 'https://other.example.org/landing')
          })
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/start', {
          purpose: 'oauth',
          headers: {
            'authorization': 'Bearer secret',
            'x-api-key': 'secret-key',
            'proxy-authorization': 'Basic abc',
            'cookie': 'a=b',
            'accept': 'application/json',
          },
        })

        const first = headersOf(calls()[0]!)
        const second = headersOf(calls()[1]!)

        expect(first.get('authorization')).toBe('Bearer secret')
        expect(first.get('x-api-key')).toBe('secret-key')
        expect(second.get('authorization')).toBeNull()
        expect(second.get('x-api-key')).toBeNull()
        expect(second.get('proxy-authorization')).toBeNull()
        expect(second.get('cookie')).toBeNull()
        expect(second.get('accept')).toBe('application/json')
        expect(second.get('user-agent')).toBe('Besidka-Connectors/1.0')
      })

      it('drops the body and turns the request into a GET', async () => {
        fetchMock
          .mockImplementationOnce(async () => {
            return redirect(307, 'https://other.example.org/token')
          })
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/token', {
          purpose: 'oauth',
          method: 'POST',
          body: 'grant_type=refresh_token&refresh_token=secret',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        })

        expect(calls()[1]![1].method).toBe('GET')
        expect(calls()[1]![1].body).toBeUndefined()
        expect(headersOf(calls()[1]!).get('content-type')).toBeNull()
      })

      it('keeps the credentials away after a later same-origin hop', async () => {
        fetchMock
          .mockImplementationOnce(async () => {
            return redirect(302, 'https://other.example.org/a')
          })
          .mockImplementationOnce(async () => redirect(302, '/b'))
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/start', {
          purpose: 'oauth',
          headers: { authorization: 'Bearer secret' },
        })

        expect(headersOf(calls()[2]!).get('authorization')).toBeNull()
      })

      it('validates the target of the cross-origin hop', async () => {
        fetchMock.mockImplementationOnce(async () => {
          return redirect(302, 'https://10.0.0.1/')
        })

        const exception = await errorOf(safeFetch('https://example.com', {
          purpose: 'oauth',
        }))

        expect(exception.message).toBe('This address is not allowed')
      })
    })

    describe('same origin', () => {
      it('keeps Authorization and custom headers', async () => {
        fetchMock
          .mockImplementationOnce(async () => redirect(302, '/moved'))
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/start', {
          purpose: 'oauth',
          headers: { 'authorization': 'Bearer t', 'x-api-key': 'k' },
        })

        const headers = headersOf(calls()[1]!)

        expect(headers.get('authorization')).toBe('Bearer t')
        expect(headers.get('x-api-key')).toBe('k')
      })

      it('turns a 303 into a GET without the body', async () => {
        fetchMock
          .mockImplementationOnce(async () => redirect(303, '/result'))
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/submit', {
          purpose: 'oauth',
          method: 'POST',
          body: '{"a":1}',
          headers: { 'content-type': 'application/json' },
        })

        expect(calls()[1]![1].method).toBe('GET')
        expect(calls()[1]![1].body).toBeUndefined()
        expect(headersOf(calls()[1]!).get('content-type')).toBeNull()
      })

      it('turns a 302 POST into a GET and keeps a 307 POST', async () => {
        fetchMock
          .mockImplementationOnce(async () => redirect(302, '/a'))
          .mockImplementationOnce(async () => ok())
          .mockImplementationOnce(async () => redirect(307, '/b'))
          .mockImplementationOnce(async () => ok())

        await safeFetch('https://example.com/x', {
          purpose: 'oauth',
          method: 'POST',
          body: 'one',
        })
        await safeFetch('https://example.com/x', {
          purpose: 'oauth',
          method: 'POST',
          body: 'two',
        })

        expect(calls()[1]![1].method).toBe('GET')
        expect(calls()[3]![1].method).toBe('POST')
        expect(calls()[3]![1].body).toBe('two')
      })

      it('refuses to repeat a streamed body on a 307', async () => {
        fetchMock.mockImplementationOnce(async () => redirect(307, '/again'))

        const exception = await errorOf(safeFetch('https://example.com/x', {
          purpose: 'oauth',
          method: 'POST',
          body: new ReadableStream(),
        }))

        expect(exception.code).toBe('safe-fetch-unrepeatable')
      })
    })

    describe('purpose skills-github', () => {
      it('never follows a redirect', async () => {
        fetchMock.mockImplementationOnce(async () => {
          return redirect(302, 'https://codeload.github.com/o/r/zip/abc')
        })

        const exception = await errorOf(safeFetch(
          'https://github.com/o/r.git/info/refs?service=git-upload-pack',
          { purpose: 'skills-github' },
        ))

        expect(exception.code).toBe('safe-fetch-redirect-refused')
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('has the none policy and the skills user agent', () => {
        expect(SAFE_FETCH_PURPOSE_POLICY['skills-github'].redirects)
          .toBe('none')
        expect(SAFE_FETCH_PURPOSE_POLICY['skills-github'].userAgent)
          .toBe('Besidka-Skills/1.0')
      })
    })

    describe('purpose mcp', () => {
      it('follows a same-origin redirect', async () => {
        fetchMock
          .mockImplementationOnce(async () => redirect(308, '/mcp/v2'))
          .mockImplementationOnce(async () => ok())

        const response = await safeFetch('https://example.com/mcp', {
          purpose: 'mcp',
          method: 'POST',
          body: '{}',
        })

        expect(response.status).toBe(200)
        expect(calls()[1]![0]).toBe('https://example.com/mcp/v2')
        expect(calls()[1]![1].method).toBe('POST')
      })

      it('stops at a redirect to another origin', async () => {
        fetchMock.mockImplementationOnce(async () => {
          return redirect(302, 'https://other.example.org/mcp')
        })

        const exception = await errorOf(safeFetch('https://example.com/mcp', {
          purpose: 'mcp',
        }))

        expect(exception.code).toBe('CONNECTOR_ORIGIN_CHANGED')
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      it('treats another port or scheme host as another origin', async () => {
        fetchMock.mockImplementationOnce(async () => {
          return redirect(302, 'https://example.com:8443/mcp')
        })

        const exception = await errorOf(safeFetch('https://example.com/mcp', {
          purpose: 'mcp',
        }))

        expect(exception.code).toBe('CONNECTOR_ORIGIN_CHANGED')
      })

      it('treats a subdomain as another origin', async () => {
        fetchMock.mockImplementationOnce(async () => {
          return redirect(302, 'https://evil.example.com/mcp')
        })

        const exception = await errorOf(safeFetch('https://example.com/mcp', {
          purpose: 'mcp',
        }))

        expect(exception.code).toBe('CONNECTOR_ORIGIN_CHANGED')
      })
    })
  })

  describe('byte cap', () => {
    it('aborts a stream above the cap without reading the rest', async () => {
      const chunk = new Uint8Array(1024)
      const { stream, state } = streamOf(
        Array.from({ length: 1000 }, () => chunk),
      )

      fetchMock.mockImplementation(async () => {
        return new Response(stream, { status: 200 })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
        maxResponseBytes: 4096,
      })
      const exception = await errorOf(response.text())

      expect(exception.message).toBe('The server answered with too much data')
      expect(state.canceled).toBe(true)
      expect(state.pulled).toBeLessThan(10)
    })

    it('rejects up front when Content-Length is over the cap', async () => {
      const { stream, state } = streamOf([new Uint8Array(10)])

      fetchMock.mockImplementation(async () => {
        return new Response(stream, {
          status: 200,
          headers: { 'content-length': '999999' },
        })
      })

      const exception = await errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
        maxResponseBytes: 1000,
      }))

      expect(exception.message).toBe('The server answered with too much data')
      await vi.waitFor(() => {
        expect(state.canceled).toBe(true)
      })
    })

    it('does not trust a lying Content-Length', async () => {
      fetchMock.mockImplementation(async () => {
        return new Response(new Uint8Array(5000), {
          status: 200,
          headers: { 'content-length': '10' },
        })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
        maxResponseBytes: 1000,
      })

      expect((await errorOf(response.text())).message)
        .toBe('The server answered with too much data')
    })

    it('returns a body exactly at the cap', async () => {
      fetchMock.mockImplementation(async () => ok('a'.repeat(1000)))

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
        maxResponseBytes: 1000,
      })

      expect((await response.text()).length).toBe(1000)
    })

    it('uses the cap of the purpose by default', async () => {
      fetchMock.mockImplementation(async () => {
        return new Response(
          new Uint8Array(SAFE_FETCH_PURPOSE_POLICY.oauth.maxResponseBytes + 1),
        )
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect((await errorOf(response.text())).message)
        .toBe('The server answered with too much data')
    })

    it('passes a response without a body through', async () => {
      fetchMock.mockImplementation(async () => {
        return new Response(null, { status: 204 })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect(response.status).toBe(204)
      expect(response.body).toBeNull()
    })

    it('hands over decoded bytes without stale encoding headers', async () => {
      fetchMock.mockImplementation(async () => {
        return ok('hello', {
          'content-encoding': 'gzip',
          'content-length': '999999',
        })
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('content-length')).toBeNull()
      expect(await response.text()).toBe('hello')
    })
  })

  describe('timeout', () => {
    it('aborts when no answer arrives', async () => {
      vi.useFakeTimers()
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => {
            reject(init.signal!.reason)
          })
        })
      })

      const pending = errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
        timeoutMs: 50,
      }))

      await vi.advanceTimersByTimeAsync(60)

      const exception = await pending

      expect(exception.status).toBe(504)
      expect(exception.message).toBe('The server did not answer in time')
    })

    it('covers the body: a stalled stream is aborted', async () => {
      vi.useFakeTimers()
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal!.addEventListener('abort', () => {
              controller.error(init.signal!.reason)
            })
          },
        })

        return Promise.resolve(new Response(stream, { status: 200 }))
      })

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
        timeoutMs: 50,
      })
      const pending = errorOf(response.text())

      await vi.advanceTimersByTimeAsync(60)

      const exception = await pending

      expect(exception.status).toBe(504)
    })

    it('shares one deadline across hops', async () => {
      vi.useFakeTimers()
      fetchMock.mockImplementation((url: string, init: RequestInit) => {
        if (url.endsWith('/start')) {
          return new Promise((resolve) => {
            setTimeout(() => resolve(redirect(302, '/slow')), 40)
          })
        }

        return new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => {
            reject(init.signal!.reason)
          })
        })
      })

      const pending = errorOf(safeFetch('https://example.com/start', {
        purpose: 'oauth',
        timeoutMs: 60,
      }))

      await vi.advanceTimersByTimeAsync(70)

      expect((await pending).status).toBe(504)
    })

    it('leaves no timer behind after the body was read', async () => {
      vi.useFakeTimers()
      fetchMock.mockImplementation(async () => ok('done'))

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      expect(vi.getTimerCount()).toBe(1)

      await response.text()

      expect(vi.getTimerCount()).toBe(0)
    })

    it('leaves no timer behind after the body was canceled', async () => {
      vi.useFakeTimers()
      fetchMock.mockImplementation(async () => ok('done'))

      const response = await safeFetch('https://example.com', {
        purpose: 'oauth',
      })

      await response.body!.cancel()

      expect(vi.getTimerCount()).toBe(0)
    })

    it('leaves no timer behind after a rejection', async () => {
      vi.useFakeTimers()

      await errorOf(safeFetch('https://127.0.0.1', { purpose: 'oauth' }))

      expect(vi.getTimerCount()).toBe(0)
    })

    it('uses the timeout of the purpose by default', () => {
      expect(SAFE_FETCH_PURPOSE_POLICY.mcp.timeoutMs).toBe(60_000)
      expect(SAFE_FETCH_PURPOSE_POLICY.oauth.timeoutMs).toBe(10_000)
      expect(SAFE_FETCH_PURPOSE_POLICY.registry.timeoutMs).toBe(30_000)
    })
  })

  describe('caller signal and failures', () => {
    it('rethrows the abort reason of the caller unchanged', async () => {
      const controller = new AbortController()
      const reason = new Error('user stopped')

      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          if (init.signal!.aborted) {
            reject(init.signal!.reason)

            return
          }

          init.signal!.addEventListener('abort', () => {
            reject(init.signal!.reason)
          })
        })
      })

      const pending = errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
        signal: controller.signal,
      }))

      controller.abort(reason)

      expect(await pending).toBe(reason)
    })

    it('wraps a network failure without the raw exception or any URL', async () => {
      const failure = new TypeError(
        'fetch failed for https://example.com/path?token=secret',
        { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1'), {
          code: 'ECONNREFUSED',
        }) },
      )

      fetchMock.mockRejectedValueOnce(failure)

      const exception = await errorOf(safeFetch(
        'https://example.com/path?token=secret',
        { purpose: 'oauth' },
      ))
      const serialized = JSON.stringify({
        message: exception.message,
        why: (exception as { why?: string }).why,
        cause: exception.cause,
        stack: undefined,
      })

      expect(exception.status).toBe(502)
      expect(exception.message).toBe('The server could not be reached')
      expect(exception.cause).toBeUndefined()
      expect((exception as { why?: string }).why)
        .toBe('The connection failed (TypeError ECONNREFUSED)')
      expect(serialized).not.toContain('secret')
      expect(serialized).not.toContain('example.com')
      expect(serialized).not.toContain('10.0.0.1')
    })

    it('keeps only a plain class name for a non-error failure', async () => {
      fetchMock.mockRejectedValueOnce('https://example.com/?token=secret')

      const exception = await errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
      }))

      expect((exception as { why?: string }).why)
        .toBe('The connection failed (Unknown)')
      expect(exception.cause).toBeUndefined()
    })
  })

  describe('logging', () => {
    it('logs host, purpose and status, never a path or a query', async () => {
      const logger = { set: vi.fn() }

      fetchMock.mockImplementation(async () => ok())

      await safeFetch('https://example.com/secret/path?token=abc', {
        purpose: 'oauth',
        logger,
      })

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).toContain('example.com')
      expect(logged).toContain('oauth')
      expect(logged).not.toContain('secret')
      expect(logged).not.toContain('token')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          net: {
            purpose: 'oauth',
            host: 'example.com',
            status: 200,
            redirects: 0,
          },
        },
      })
    })

    it('logs a rejection with the host only', async () => {
      const logger = { set: vi.fn() }

      fetchMock.mockImplementationOnce(async () => {
        return redirect(302, 'https://localhost/x?secret=1')
      })

      await errorOf(safeFetch('https://example.com', {
        purpose: 'oauth',
        logger,
      }))

      const logged = JSON.stringify(logger.set.mock.calls)

      expect(logged).toContain('"rejected":true')
      expect(logged).not.toContain('secret')
    })

    it('works without a logger', async () => {
      fetchMock.mockImplementation(async () => ok())

      await expect(safeFetch('https://example.com', {
        purpose: 'oauth',
      })).resolves.toBeInstanceOf(Response)
    })
  })

  describe('createSafeFetch', () => {
    it('binds the purpose and accepts the fetch call shape', async () => {
      fetchMock.mockImplementation(async () => ok())

      const boundFetch = createSafeFetch('mcp')
      const response = await boundFetch('https://example.com/mcp', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(200)
      expect(headersOf(calls()[0]!).get('user-agent'))
        .toBe('Besidka-Connectors/1.0')
    })

    it('cannot be pointed at a blocked address', async () => {
      const boundFetch = createSafeFetch('oauth')
      const exception = await errorOf(boundFetch('https://10.0.0.1/token'))

      expect(exception.message).toBe('This address is not allowed')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not let the caller change the purpose', async () => {
      fetchMock.mockImplementationOnce(async () => {
        return redirect(302, 'https://other.example.org/')
      })

      const boundFetch = createSafeFetch('mcp')
      const exception = await errorOf(boundFetch('https://example.com/mcp', {
        purpose: 'oauth',
      } as RequestInit))

      expect(exception.code).toBe('CONNECTOR_ORIGIN_CHANGED')
    })

    it('passes the logger option through', async () => {
      const logger = { set: vi.fn() }

      fetchMock.mockImplementation(async () => ok())

      await createSafeFetch('registry', { logger })('https://example.com/')

      expect(logger.set).toHaveBeenCalled()
    })
  })

  it('has a policy for every purpose', () => {
    expect(Object.keys(SAFE_FETCH_PURPOSE_POLICY).sort())
      .toEqual([...SAFE_FETCH_PURPOSES].sort())
    expect(SAFE_FETCH_PURPOSE_POLICY.mcp.redirects).toBe('same-origin')
    expect(SAFE_FETCH_PURPOSE_POLICY.oauth.maxResponseBytes).toBe(256 * 1024)
    expect(SAFE_FETCH_PURPOSE_POLICY.mcp.maxResponseBytes).toBe(1024 * 1024)
  })

  it('keeps the favicon purpose small, short and redirect-validated', () => {
    expect(SAFE_FETCH_PURPOSE_POLICY.favicon).toMatchObject({
      redirects: 'validated',
      timeoutMs: 5_000,
      maxResponseBytes: 32 * 1024,
    })
  })
})

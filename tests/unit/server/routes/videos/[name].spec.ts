import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeResponse {
  status: number
  headers: Headers
}

const mocks = vi.hoisted(() => {
  return {
    env: {} as Record<string, unknown>,
    params: { name: 'demo.mp4' },
    response: null as unknown,
    get: vi.fn(),
    head: vi.fn(),
  }
})

vi.mock('evlog', () => {
  return {
    createError: (input: { message: string, status?: number }) => {
      const exception = new Error(input.message)

      Object.assign(exception, input)

      return exception
    },
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
    setResponseStatus: (event: { res: FakeResponse }, status: number) => {
      event.res.status = status
    },
  }
})

vi.mock('cloudflare:workers', () => {
  return { env: mocks.env }
})

vi.mock('~~/server/utils/http/get-decoded-router-params', () => {
  return {
    getDecodedRouterParams: () => {
      return mocks.params
    },
  }
})

const BODY = new ReadableStream()

function createMetadata() {
  return {
    size: 1000,
    httpEtag: '"abc"',
    uploaded: new Date('2026-01-01T00:00:00Z'),
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    size: 1000,
    httpEtag: '"abc"',
    body: BODY,
    ...overrides,
  }
}

function createEvent(
  requestHeaders: Record<string, string> = {},
  method = 'GET',
) {
  return {
    req: { method, headers: new Headers(requestHeaders) },
    res: { status: 200, headers: new Headers() } as FakeResponse,
  }
}

async function callRoute(event: ReturnType<typeof createEvent>) {
  const { default: handler } = await import(
    '../../../../../server/routes/videos/[name]'
  )

  return (handler as (event: unknown) => Promise<unknown>)(event)
}

describe('GET /videos/[name]', () => {
  beforeEach(() => {
    mocks.params.name = 'demo.mp4'
    mocks.get.mockReset()
    mocks.head.mockReset()
    mocks.env.CMS_BUCKET = { get: mocks.get, head: mocks.head }
  })

  it('returns 200 with the full object, headers and a streamed body',
    async () => {
      mocks.get.mockResolvedValue(createBody())

      const event = createEvent()
      const result = await callRoute(event)

      expect(result).toBe(BODY)
      expect(event.res.status).toBe(200)
      expect(event.res.headers.get('Content-Type')).toBe('video/mp4')
      expect(event.res.headers.get('Content-Length')).toBe('1000')
      expect(event.res.headers.get('ETag')).toBe('"abc"')
      expect(event.res.headers.get('Accept-Ranges')).toBe('bytes')
      expect(event.res.headers.get('Cache-Control'))
        .toBe('public, max-age=86400')
      expect(event.res.headers.get('X-Content-Type-Options'))
        .toBe('nosniff')
      expect(event.res.headers.has('Content-Range')).toBe(false)
    })

  it('performs a single R2 read and never calls head on success',
    async () => {
      mocks.get.mockResolvedValue(createBody())

      await callRoute(createEvent())

      expect(mocks.get).toHaveBeenCalledTimes(1)
      expect(mocks.head).not.toHaveBeenCalled()
    })

  it('passes the parsed range and the request headers as onlyIf',
    async () => {
      mocks.get.mockResolvedValue(createBody())

      const event = createEvent({
        'range': 'bytes=0-99',
        'if-none-match': '"zzz"',
      })

      await callRoute(event)

      expect(mocks.get).toHaveBeenCalledWith('demo.mp4', {
        range: { offset: 0, length: 100 },
        onlyIf: event.req.headers,
      })
    })

  it.each([
    ['an open-ended range', 'bytes=500-', { offset: 500 }],
    ['a suffix range', 'bytes=-200', { suffix: 200 }],
  ])('maps %s to the matching R2 range', async (_label, range, expected) => {
    mocks.get.mockResolvedValue(createBody())

    await callRoute(createEvent({ range }))

    expect(mocks.get.mock.calls[0]![1].range).toEqual(expected)
  })

  it('omits the range option when the request has no Range header',
    async () => {
      mocks.get.mockResolvedValue(createBody())

      await callRoute(createEvent())

      expect(mocks.get.mock.calls[0]![1].range).toBeUndefined()
    })

  it('returns 206 with Content-Range for an offset range', async () => {
    mocks.get.mockResolvedValue(createBody())

    const event = createEvent({ range: 'bytes=0-99' })
    const result = await callRoute(event)

    expect(result).toBe(BODY)
    expect(event.res.status).toBe(206)
    expect(event.res.headers.get('Content-Length')).toBe('100')
    expect(event.res.headers.get('Content-Range')).toBe('bytes 0-99/1000')
  })

  it('resolves a suffix range into explicit offsets', async () => {
    mocks.get.mockResolvedValue(createBody())

    const event = createEvent({ range: 'bytes=-200' })

    await callRoute(event)

    expect(event.res.status).toBe(206)
    expect(event.res.headers.get('Content-Range')).toBe('bytes 800-999/1000')
    expect(event.res.headers.get('Content-Length')).toBe('200')
  })

  it('clamps an end past EOF to the last byte per RFC 9110', async () => {
    mocks.get.mockResolvedValue(createBody())

    const event = createEvent({ range: 'bytes=900-99999999' })

    await callRoute(event)

    expect(event.res.status).toBe(206)
    expect(event.res.headers.get('Content-Range')).toBe('bytes 900-999/1000')
    expect(event.res.headers.get('Content-Length')).toBe('100')
  })

  it('serves HEAD as a bodyless Response with the real Content-Length',
    async () => {
      const cancel = vi.fn(async () => {})

      mocks.get.mockResolvedValue(createBody({ body: { cancel } }))

      const event = createEvent({}, 'HEAD')
      const result = await callRoute(event) as Response

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect(result.body).toBeNull()
      expect(result.headers.get('Content-Length')).toBe('1000')
      expect(result.headers.get('Content-Type')).toBe('video/mp4')
      expect(result.headers.get('ETag')).toBe('"abc"')
      expect(cancel).toHaveBeenCalledTimes(1)
    })

  it('serves a ranged HEAD as 206 with the range Content-Length',
    async () => {
      const cancel = vi.fn(async () => {})

      mocks.get.mockResolvedValue(createBody({ body: { cancel } }))

      const event = createEvent({ range: 'bytes=0-99' }, 'HEAD')
      const result = await callRoute(event) as Response

      expect(result.status).toBe(206)
      expect(result.headers.get('Content-Length')).toBe('100')
      expect(result.headers.get('Content-Range')).toBe('bytes 0-99/1000')
    })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])(
    'returns 405 with Allow GET, HEAD for %s without touching R2',
    async (method) => {
      const event = createEvent({}, method)

      await expect(callRoute(event)).rejects.toMatchObject({ status: 405 })
      expect(event.res.headers.get('Allow')).toBe('GET, HEAD')
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(event.res.headers.get('X-Content-Type-Options'))
        .toBe('nosniff')
      expect(mocks.get).not.toHaveBeenCalled()
    })

  it('returns 304 with the cache headers when If-None-Match matches',
    async () => {
      mocks.get.mockResolvedValue({
        size: 1000,
        httpEtag: '"abc"',
        uploaded: new Date('2026-01-01T00:00:00Z'),
      })

      const event = createEvent({ 'if-none-match': '"abc"' })
      const result = await callRoute(event)

      expect(result).toBeNull()
      expect(event.res.status).toBe(304)
      expect(event.res.headers.get('ETag')).toBe('"abc"')
      expect(event.res.headers.get('Cache-Control'))
        .toBe('public, max-age=86400')
      expect(event.res.headers.has('Content-Length')).toBe(false)
    })

  it('returns 412 with only ETag and no-store when If-Match fails',
    async () => {
      mocks.get.mockResolvedValue(createMetadata())

      const event = createEvent({ 'if-match': '"other"' })
      const result = await callRoute(event)

      expect(result).toBeNull()
      expect(event.res.status).toBe(412)
      expect(event.res.headers.get('ETag')).toBe('"abc"')
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(event.res.headers.has('Accept-Ranges')).toBe(false)
    })

  it('prefers 412 over 304 when If-Match fails alongside If-None-Match',
    async () => {
      mocks.get.mockResolvedValue(createMetadata())

      const event = createEvent({
        'if-match': '"other"',
        'if-none-match': '"abc"',
      })

      await callRoute(event)

      expect(event.res.status).toBe(412)
    })

  it('returns 304 when If-Match passes and If-None-Match matches',
    async () => {
      mocks.get.mockResolvedValue(createMetadata())

      const event = createEvent({
        'if-match': '"abc"',
        'if-none-match': '"abc"',
      })

      await callRoute(event)

      expect(event.res.status).toBe(304)
    })

  it('returns 412 when If-Unmodified-Since predates the upload',
    async () => {
      mocks.get.mockResolvedValue(createMetadata())

      const event = createEvent({
        'if-unmodified-since': 'Mon, 01 Jan 2001 00:00:00 GMT',
        'if-modified-since': 'Mon, 01 Jan 2030 00:00:00 GMT',
      })

      await callRoute(event)

      expect(event.res.status).toBe(412)
    })

  it('returns 304 for If-Modified-Since when nothing failed', async () => {
    mocks.get.mockResolvedValue(createMetadata())

    const event = createEvent({
      'if-modified-since': 'Mon, 01 Jan 2030 00:00:00 GMT',
    })

    await callRoute(event)

    expect(event.res.status).toBe(304)
  })

  it('returns 400 with no-store when R2 rejects a malformed conditional',
    async () => {
      mocks.get.mockRejectedValue(
        new Error('get: Invalid ETag in if-none-match header (10031)'),
      )

      const event = createEvent({ 'if-none-match': 'garbage' })

      await expect(callRoute(event)).rejects.toMatchObject({ status: 400 })
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.get).toHaveBeenCalledTimes(1)
    })

  it('serves 206 when If-Range matches the current ETag', async () => {
    mocks.get.mockResolvedValue(createBody())

    const event = createEvent({ 'range': 'bytes=0-99', 'if-range': '"abc"' })

    await callRoute(event)

    expect(event.res.status).toBe(206)
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('ignores the Range and serves 200 when If-Range does not match',
    async () => {
      const cancel = vi.fn(async () => {})

      mocks.get
        .mockResolvedValueOnce(createBody({ body: { cancel } }))
        .mockResolvedValueOnce(createBody())

      const event = createEvent({ 'range': 'bytes=0-99', 'if-range': '"old"' })
      const result = await callRoute(event)

      expect(result).toBe(BODY)
      expect(event.res.status).toBe(200)
      expect(event.res.headers.get('Content-Length')).toBe('1000')
      expect(event.res.headers.has('Content-Range')).toBe(false)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(mocks.get).toHaveBeenCalledTimes(2)
      expect(mocks.get.mock.calls[1]![1].range).toBeUndefined()
    })

  it('returns 404 for a name outside the allow-list without touching R2',
    async () => {
      mocks.params.name = 'secret.mp4'

      const event = createEvent()

      await expect(callRoute(event)).rejects.toMatchObject({ status: 404 })
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.get).not.toHaveBeenCalled()
    })

  it('returns 404 with no-store when the object is missing in the bucket',
    async () => {
      mocks.get.mockResolvedValue(null)

      const event = createEvent()

      await expect(callRoute(event)).rejects.toMatchObject({ status: 404 })
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
    })

  it('returns 503 with no-store when the CMS_BUCKET binding is missing',
    async () => {
      delete mocks.env.CMS_BUCKET

      const event = createEvent()

      await expect(callRoute(event)).rejects.toMatchObject({ status: 503 })
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
    })

  it.each([
    ['starts past the end', 'bytes=5000-6000'],
    ['starts past the end with an open end', 'bytes=1000-'],
    ['is reversed', 'bytes=500-100'],
  ])('returns 416 with the size and cancels the body when the range %s',
    async (_label, range) => {
      const cancel = vi.fn(async () => {})

      mocks.get.mockResolvedValue(createBody({ body: { cancel } }))

      const event = createEvent({ range })

      await expect(callRoute(event)).rejects.toMatchObject({ status: 416 })
      expect(event.res.headers.get('Content-Range')).toBe('bytes */1000')
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(mocks.head).not.toHaveBeenCalled()
    })

  it.each([
    ['is malformed', 'items=0-10'],
    ['asks for multiple ranges', 'bytes=0-1,5-6'],
  ])('reads without a range and answers 416 when the range %s',
    async (_label, range) => {
      const cancel = vi.fn(async () => {})

      mocks.get.mockResolvedValue(createBody({ body: { cancel } }))

      const event = createEvent({ range })

      await expect(callRoute(event)).rejects.toMatchObject({ status: 416 })
      expect(mocks.get.mock.calls[0]![1].range).toBeUndefined()
      expect(event.res.headers.get('Content-Range')).toBe('bytes */1000')
      expect(cancel).toHaveBeenCalledTimes(1)
    })

  it('returns 416 with Content-Range bytes */size when R2 rejects the range',
    async () => {
      mocks.get.mockRejectedValue(
        new Error('get: The requested range is not satisfiable (10039)'),
      )
      mocks.head.mockResolvedValue({ size: 1000 })

      const event = createEvent({ range: 'bytes=5000-6000' })

      await expect(callRoute(event)).rejects.toMatchObject({ status: 416 })
      expect(event.res.headers.get('Content-Range')).toBe('bytes */1000')
      expect(event.res.headers.get('Cache-Control')).toBe('no-store')
      expect(mocks.head).toHaveBeenCalledTimes(1)
    })

  it('rethrows unrelated R2 errors', async () => {
    mocks.get.mockRejectedValue(new Error('R2 is down (10001)'))

    await expect(callRoute(createEvent())).rejects.toThrow('R2 is down')
  })

  it('serves captions with the vtt content type', async () => {
    mocks.params.name = 'demo.en.vtt'
    mocks.get.mockResolvedValue(createBody({ size: 50 }))

    const event = createEvent()

    await callRoute(event)

    expect(event.res.headers.get('Content-Type'))
      .toBe('text/vtt; charset=utf-8')
  })
})

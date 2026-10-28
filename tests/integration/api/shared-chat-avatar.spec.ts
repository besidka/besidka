import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  fetchMock: vi.fn(),
  cacheMatch: vi.fn(),
  cachePut: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: mocks.loggerSet,
  }),
  createError: (input: {
    status?: number
    message?: string
    why?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/shared/[slug]/avatar.get'
  )

  return module.default
}

interface ShareFixture {
  id: string
  slug: string
  chatId: string
  revoked: boolean
  expiresAt: Date | null
  indexable: boolean
  showFiles: boolean
  showMetadata: boolean
  showAuthorAvatar: boolean
  allowBranch: boolean
}

function createShareFixture(
  overrides: Partial<ShareFixture> = {},
): ShareFixture {
  return {
    id: 'share-1',
    slug: 'share-slug',
    chatId: 'chat-1',
    revoked: false,
    expiresAt: null,
    indexable: false,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    ...overrides,
  }
}

function matchesCondition(rowValue: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') {
    return rowValue === condition
  }

  const operators = condition as Record<string, unknown>

  if ('isNull' in operators) {
    return (rowValue === null) === operators.isNull
  }

  if ('gt' in operators) {
    return rowValue !== null
      && (rowValue as Date).getTime() > (operators.gt as Date).getTime()
  }

  return false
}

function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') {
      const subConditions = condition as Record<string, unknown>[]

      return subConditions.some((subCondition) => {
        return matchesWhere(row, subCondition)
      })
    }

    return matchesCondition(row[key], condition)
  })
}

function createDb(options: {
  shares: ShareFixture[]
  image: string | null
}) {
  return {
    query: {
      chatShares: {
        findFirst: vi.fn(async (
          { where }: { where: Record<string, unknown> },
        ) => {
          return options.shares.find((share) => {
            return matchesWhere(
              share as unknown as Record<string, unknown>,
              where,
            )
          })
        }),
      },
      chats: {
        findFirst: vi.fn(async () => {
          return { user: { image: options.image } }
        }),
      },
    },
  }
}

function createImageResponse(
  bytes: Uint8Array,
  init: ResponseInit = {},
): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
    ...init,
  })
}

describe('public shared chat avatar proxy API', () => {
  const googleImage = 'https://lh3.googleusercontent.com/a/abc=s96-c'
  const responseHeaders = new Map<string, string>()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    responseHeaders.clear()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('getRouterParams', (
      event: { params: unknown },
    ) => {
      return event.params
    })
    vi.stubGlobal('fetch', mocks.fetchMock)
    vi.stubGlobal('caches', undefined)
  })

  function stubCache() {
    mocks.cacheMatch.mockResolvedValue(undefined)
    mocks.cachePut.mockResolvedValue(undefined)
    vi.stubGlobal('caches', {
      default: { match: mocks.cacheMatch, put: mocks.cachePut },
    })
  }

  function createEvent(slug: string) {
    return {
      params: { slug },
      context: {},
      url: new URL(`https://besidka.test/api/v1/shared/${slug}/avatar`),
      res: {
        headers: {
          set: (name: string, value: string) => {
            responseHeaders.set(name, value)
          },
        },
      },
    } as never
  }

  it('proxies an allowlisted Google avatar with safe headers', async () => {
    const handler = await getHandler()
    const bytes = new Uint8Array([1, 2, 3, 4])

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(createImageResponse(bytes))

    const body = await handler(createEvent('share-slug'))

    expect(body).toEqual(bytes)
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)

    const [requestedUrl, requestInit] = mocks.fetchMock.mock.calls[0]!

    expect(String(requestedUrl)).toBe(googleImage)
    expect(requestInit.redirect).toBe('manual')
    expect(requestInit.headers).toEqual({ accept: 'image/*' })
    expect(requestInit.credentials).toBeUndefined()
    expect(responseHeaders.get('Content-Type')).toBe('image/jpeg')
    expect(responseHeaders.get('Cache-Control')).toBe('private, max-age=300')
    expect(responseHeaders.get('X-Content-Type-Options')).toBe('nosniff')
    expect(responseHeaders.get('Content-Security-Policy'))
      .toBe('default-src \'none\'; sandbox')
    expect(requestInit.signal).toBeInstanceOf(AbortSignal)
  })

  it('proxies a GitHub avatar', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({
        shares: [createShareFixture()],
        image: 'https://avatars.githubusercontent.com/u/1?v=4',
      })
    })
    mocks.fetchMock.mockResolvedValue(
      createImageResponse(new Uint8Array([9]), {
        headers: { 'content-type': 'image/png' },
      }),
    )

    await handler(createEvent('share-slug'))

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    expect(responseHeaders.get('Content-Type')).toBe('image/png')
  })

  it.each([
    'https://tracker.example.com/pixel.png',
    'http://lh3.googleusercontent.com/a/abc',
    'https://googleusercontent.com.evil.test/a/abc',
    'https://evilgoogleusercontent.com/a/abc',
    'https://lh3.googleusercontent.com:8443/a/abc',
    'https://user:pass@lh3.googleusercontent.com/a/abc',
    'https://lh3.googleusercontent.com./a/abc',
    'https://xn--lh3-googleusercontent.com/a/abc',
    'https://127.0.0.1/a/abc',
    'https://[::1]/a/abc',
    'https://evil.test\\@lh3.googleusercontent.com/a/abc',
    'https://avatars.githubusercontent.com.evil.test/u/1',
    'https://docs.googleusercontent.com/a/abc',
    'https://lh.googleusercontent.com/a/abc',
    'https://lh3.googleusercontent.com/proxy/abc',
    'https://lh3.googleusercontent.com/gadgets/proxy?url=x',
    'https://lh3.googleusercontent.com/a/../proxy/abc',
    'https://lh3.googleusercontent.com/ab/abc',
    'https://avatars.githubusercontent.com/in/1',
    'data:image/png;base64,AAAA',
    'not a url',
  ])('returns 404 without fetching for image %s', async (image) => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image })
    })

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it('normalises an uppercase host and fetches the lowercase avatar host',
    async () => {
      const handler = await getHandler()

      vi.stubGlobal('useDb', () => {
        return createDb({
          shares: [createShareFixture()],
          image: 'https://LH3.GoogleUserContent.com/a/abc',
        })
      })
      mocks.fetchMock.mockResolvedValue(
        createImageResponse(new Uint8Array([1])),
      )

      await handler(createEvent('share-slug'))

      expect(String(mocks.fetchMock.mock.calls[0]![0]))
        .toBe('https://lh3.googleusercontent.com/a/abc')
    })

  it('returns 404 when the author has no image', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: null })
    })

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown', []],
    ['revoked', [createShareFixture({ revoked: true })]],
    [
      'expired',
      [createShareFixture({ expiresAt: new Date(Date.now() - 60_000) })],
    ],
    ['avatar-off', [createShareFixture({ showAuthorAvatar: false })]],
  ])('returns 404 for a %s share', async (_label, shares) => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares, image: googleImage })
    })

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
    expect(mocks.fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a redirect from the upstream host', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://tracker.example.com/pixel.png' },
      }),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
  })

  it.each([
    ['image/svg+xml'],
    ['text/html'],
    ['application/octet-stream'],
  ])('rejects the upstream content type %s', async (contentType) => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(
      createImageResponse(new Uint8Array([1]), {
        headers: { 'content-type': contentType },
      }),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
  })

  it('rejects a non-2xx upstream response', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(
      createImageResponse(new Uint8Array([1]), { status: 500 }),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
  })

  it('rejects an upstream body over the size cap', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(
      createImageResponse(new Uint8Array(1024 * 1024 + 1)),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
  })

  it('rejects an oversized content-length header on its own', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockResolvedValue(
      createImageResponse(new Uint8Array([1]), {
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(2 * 1024 * 1024),
        },
      }),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
  })

  it('rejects an oversized body behind an understated content-length',
    async () => {
      const handler = await getHandler()

      vi.stubGlobal('useDb', () => {
        return createDb({ shares: [createShareFixture()], image: googleImage })
      })
      mocks.fetchMock.mockResolvedValue(
        createImageResponse(new Uint8Array(1024 * 1024 + 1), {
          headers: {
            'content-type': 'image/jpeg',
            'content-length': '10',
          },
        }),
      )

      await expect(handler(createEvent('share-slug')))
        .rejects.toThrow('Avatar not found')
    })

  it('returns 404 when the upstream fetch times out', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockRejectedValue(
      new DOMException('The operation timed out.', 'TimeoutError'),
    )

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
    expect(mocks.loggerSet).toHaveBeenCalled()
  })

  describe('edge cache', () => {
    it('stores a validated avatar under a synthetic same-origin key',
      async () => {
        const handler = await getHandler()

        stubCache()
        vi.stubGlobal('useDb', () => {
          return createDb({
            shares: [createShareFixture()],
            image: googleImage,
          })
        })
        mocks.fetchMock.mockResolvedValue(
          createImageResponse(new Uint8Array([1, 2])),
        )

        await handler(createEvent('share-slug'))

        expect(mocks.cacheMatch).toHaveBeenCalledTimes(1)
        expect(mocks.cachePut).toHaveBeenCalledTimes(1)

        const [request, response] = mocks.cachePut.mock.calls[0]!

        expect(request.url).toMatch(
          /^https:\/\/besidka\.test\/api\/v1\/shared\/avatar-cache\/[0-9a-f]{64}$/,
        )
        expect(response.headers.get('cache-control'))
          .toBe('public, max-age=3600')
        expect(response.headers.get('content-type')).toBe('image/jpeg')
      })

    it('serves a cache hit without fetching upstream', async () => {
      const handler = await getHandler()
      const bytes = new Uint8Array([7, 8, 9])

      stubCache()
      mocks.cacheMatch.mockResolvedValue(createImageResponse(bytes))
      vi.stubGlobal('useDb', () => {
        return createDb({ shares: [createShareFixture()], image: googleImage })
      })

      const body = await handler(createEvent('share-slug'))

      expect(body).toEqual(bytes)
      expect(mocks.fetchMock).not.toHaveBeenCalled()
      expect(responseHeaders.get('Cache-Control')).toBe('private, max-age=300')
      expect(responseHeaders.get('X-Content-Type-Options')).toBe('nosniff')
    })

    it.each([
      ['revoked', createShareFixture({ revoked: true })],
      ['avatar-off', createShareFixture({ showAuthorAvatar: false })],
      [
        'expired',
        createShareFixture({ expiresAt: new Date(Date.now() - 60_000) }),
      ],
    ])('still returns 404 for a %s share when the avatar is cached',
      async (_label, share) => {
        const handler = await getHandler()

        stubCache()
        mocks.cacheMatch.mockResolvedValue(
          createImageResponse(new Uint8Array([7])),
        )
        vi.stubGlobal('useDb', () => {
          return createDb({ shares: [share], image: googleImage })
        })

        await expect(handler(createEvent('share-slug')))
          .rejects.toThrow('Avatar not found')
        expect(mocks.cacheMatch).not.toHaveBeenCalled()
      })

    it('ignores a cached entry with a disallowed content type', async () => {
      const handler = await getHandler()

      stubCache()
      mocks.cacheMatch.mockResolvedValue(
        createImageResponse(new Uint8Array([7]), {
          headers: { 'content-type': 'text/html' },
        }),
      )
      mocks.fetchMock.mockResolvedValue(
        createImageResponse(new Uint8Array([1])),
      )
      vi.stubGlobal('useDb', () => {
        return createDb({ shares: [createShareFixture()], image: googleImage })
      })

      await handler(createEvent('share-slug'))

      expect(mocks.fetchMock).toHaveBeenCalledTimes(1)
    })

    it('keeps serving when the cache API throws', async () => {
      const handler = await getHandler()

      stubCache()
      mocks.cacheMatch.mockRejectedValue(new Error('cache down'))
      mocks.cachePut.mockRejectedValue(new Error('cache down'))
      mocks.fetchMock.mockResolvedValue(
        createImageResponse(new Uint8Array([1])),
      )
      vi.stubGlobal('useDb', () => {
        return createDb({ shares: [createShareFixture()], image: googleImage })
      })

      await expect(handler(createEvent('share-slug')))
        .resolves.toEqual(new Uint8Array([1]))
      expect(mocks.loggerSet).toHaveBeenCalled()
    })
  })

  it('returns 404 when the upstream fetch fails', async () => {
    const handler = await getHandler()

    vi.stubGlobal('useDb', () => {
      return createDb({ shares: [createShareFixture()], image: googleImage })
    })
    mocks.fetchMock.mockRejectedValue(new Error('network down'))

    await expect(handler(createEvent('share-slug')))
      .rejects.toThrow('Avatar not found')
    expect(mocks.loggerSet).toHaveBeenCalled()
  })
})

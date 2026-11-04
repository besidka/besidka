import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyOAuthQueryParams: vi.fn(async () => true),
  sendRedirect: vi.fn(),
  getRequestHeader: vi.fn(),
  getRequestURL: vi.fn(),
  logger: { set: vi.fn() },
}))

vi.mock('@better-auth/oauth-provider', () => ({
  verifyOAuthQueryParams: mocks.verifyOAuthQueryParams,
}))

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: mocks.getRequestHeader,
  getRequestURL: mocks.getRequestURL,
  readValidatedBody: async (
    event: { body: unknown },
    parser: (body: unknown) => unknown,
  ) => {
    return parser(event.body)
  },
  sendRedirect: mocks.sendRedirect,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const SECRET = 'auth-secret'
const ORIGIN = 'https://besidka.com'
const COOKIE = 'better-auth.session_token=abc'
const REQUESTED_SCOPE = 'openid offline_access chats:read memory:write'
const CLIENT_REDIRECT_URL = 'https://claude.ai/api/mcp/auth_callback?code=abc'
const SEE_OTHER = 303

function signedQuery(overrides: Record<string, string> = {}): string {
  return new URLSearchParams({
    client_id: 'client-1',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    scope: REQUESTED_SCOPE,
    exp: '4102444800',
    sig: 'signature',
    ...overrides,
  }).toString()
}

function createEvent(body: unknown) {
  return {
    body,
    context: {},
    res: { headers: new Headers() },
  } as any
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    oauth_query: signedQuery(),
    decision: 'approve',
    user_id: '5',
    scope: ['chats:read'],
    ...overrides,
  }
}

function betterAuthResponse(
  payload: unknown,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function consentErrorUrl(oauthQuery: string, code: string): string {
  return `/oauth/consent?${oauthQuery}&consent_error=${code}`
}

async function getHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/connected-apps/consent.post'
  )

  return module.default
}

describe('connected apps consent form API', () => {
  let authHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.verifyOAuthQueryParams.mockResolvedValue(true)
    mocks.sendRedirect.mockImplementation(
      (_event: unknown, location: string, status?: number) => {
        return { location, status }
      },
    )
    mocks.getRequestURL.mockReturnValue(new URL(`${ORIGIN}/api/v1/x`))
    mocks.getRequestHeader.mockImplementation(
      (_event: unknown, name: string) => {
        const headers: Record<string, string> = {
          origin: ORIGIN,
          cookie: COOKIE,
        }

        return headers[name]
      },
    )

    authHandler = vi.fn().mockResolvedValue(
      betterAuthResponse({ redirect: true, url: CLIENT_REDIRECT_URL }),
    )

    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn())
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '5' },
      session: { token: 'session-token' },
    }))
    vi.stubGlobal('useServerAuth', () => ({
      $context: Promise.resolve({ secret: SECRET }),
      handler: authHandler,
    }))
  })

  it('rejects a cross-site request with 403', async () => {
    vi.stubGlobal('assertNotCrossSiteRequest', vi.fn(() => {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }))

    const handler = await getHandler()

    await expect(handler(createEvent(validBody())))
      .rejects.toMatchObject({ status: 403 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing Origin', undefined],
    ['a foreign Origin', 'https://attacker.example'],
    ['a same-site subdomain Origin', 'https://studio.besidka.com'],
  ])('rejects %s with 403', async (_label, origin) => {
    mocks.getRequestHeader.mockImplementation(
      (_event: unknown, name: string) => {
        const headers: Record<string, string | undefined> = {
          origin,
          cookie: COOKIE,
        }

        return headers[name]
      },
    )

    const handler = await getHandler()

    await expect(handler(createEvent(validBody())))
      .rejects.toMatchObject({ status: 403 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('rejects a missing oauth_query with 400', async () => {
    const handler = await getHandler()

    await expect(handler(createEvent(validBody({ oauth_query: undefined }))))
      .rejects.toMatchObject({ status: 400 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('rejects an oauth_query with a line break with 400', async () => {
    const handler = await getHandler()
    const body = validBody()

    await expect(handler(createEvent({
      ...body,
      oauth_query: `${body.oauth_query}\r\nx-injected: 1`,
    }))).rejects.toMatchObject({ status: 400 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('rejects an unknown decision with 400', async () => {
    const handler = await getHandler()

    await expect(handler(createEvent(validBody({ decision: 'maybe' }))))
      .rejects.toMatchObject({ status: 400 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('rejects a body above the size limit with 413', async () => {
    mocks.getRequestHeader.mockImplementation(
      (_event: unknown, name: string) => {
        const headers: Record<string, string> = {
          'origin': ORIGIN,
          'cookie': COOKIE,
          'content-length': String(64 * 1024),
        }

        return headers[name]
      },
    )

    const handler = await getHandler()

    await expect(handler(createEvent(validBody())))
      .rejects.toMatchObject({ status: 413 })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('returns to the unchanged consent page on an implicit submit', async () => {
    const handler = await getHandler()
    const body = validBody({ decision: 'none' })
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: `/oauth/consent?${body.oauth_query}`,
      status: 303,
    })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('verifies the signature before reflecting the query', async () => {
    mocks.verifyOAuthQueryParams.mockResolvedValueOnce(false)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const response = await handler(createEvent(validBody()))

    expect(response).toEqual({
      location: '/oauth/consent?consent_error=expired',
      status: 303,
    })
  })

  it('redirects to sign-in without a session', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: `/signin?${body.oauth_query}`,
      status: SEE_OTHER,
    })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('returns to the consent page when the account changed', async () => {
    const handler = await getHandler()
    const body = validBody({ user_id: '9' })
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'account_changed'),
      status: SEE_OTHER,
    })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('returns to the consent page when the signature fails', async () => {
    mocks.verifyOAuthQueryParams.mockResolvedValueOnce(false)

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(mocks.verifyOAuthQueryParams)
      .toHaveBeenCalledExactlyOnceWith(body.oauth_query, SECRET)
    expect(response).toEqual({
      location: '/oauth/consent?consent_error=expired',
      status: SEE_OTHER,
    })
    expect(authHandler).not.toHaveBeenCalled()
  })

  it('reports nothing selected when only write scopes are unticked',
    async () => {
      const handler = await getHandler()
      const body = validBody({ scope: undefined })

      body.oauth_query = signedQuery({ scope: 'chats:write' })

      const response = await handler(createEvent(body))

      expect(response).toEqual({
        location: consentErrorUrl(body.oauth_query, 'nothing_selected'),
        status: SEE_OTHER,
      })
      expect(authHandler).not.toHaveBeenCalled()
    })

  it('forwards an approval to Better Auth and redirects to its url',
    async () => {
      const handler = await getHandler()
      const body = validBody()
      const event = createEvent(body)
      const response = await handler(event)

      expect(authHandler).toHaveBeenCalledTimes(1)

      const request = authHandler.mock.calls[0]![0] as Request

      expect(request.method).toBe('POST')
      expect(new URL(request.url).pathname).toBe('/api/auth/oauth2/consent')
      expect(request.headers.get('cookie')).toBe(COOKIE)
      expect(request.headers.get('accept')).toBe('application/json')
      expect(request.headers.get('origin')).toBe(ORIGIN)
      expect(await request.json()).toEqual({
        accept: true,
        scope: 'openid offline_access chats:read',
        oauth_query: body.oauth_query,
      })
      expect(response).toEqual({
        location: CLIENT_REDIRECT_URL,
        status: SEE_OTHER,
      })
    })

  it('forwards a single scope sent as a plain string', async () => {
    const handler = await getHandler()

    await handler(createEvent(validBody({ scope: 'memory:write' })))

    const request = authHandler.mock.calls[0]![0] as Request

    expect(await request.json()).toMatchObject({
      accept: true,
      scope: 'openid offline_access memory:write',
    })
  })

  it('appends Better Auth cookies to the response', async () => {
    authHandler.mockResolvedValue(betterAuthResponse(
      { redirect: true, url: CLIENT_REDIRECT_URL },
      {
        headers: [
          ['content-type', 'application/json'],
          ['set-cookie', 'first=1; Path=/'],
          ['set-cookie', 'second=2; Path=/'],
        ],
      },
    ))

    const handler = await getHandler()
    const event = createEvent(validBody())

    await handler(event)

    expect(event.res.headers.getSetCookie())
      .toEqual(['first=1; Path=/', 'second=2; Path=/'])
  })

  it('drops a form scope the app never requested', async () => {
    const handler = await getHandler()

    await handler(createEvent(validBody({
      scope: ['chats:read', 'data:delete'],
    })))

    const request = authHandler.mock.calls[0]![0] as Request
    const payload = await request.json() as { scope: string }

    expect(payload.scope).toBe('openid offline_access chats:read')
    expect(payload.scope).not.toContain('data:delete')
  })

  it('forwards a denial without a scope', async () => {
    const handler = await getHandler()
    const body = validBody({ decision: 'deny', scope: undefined })
    const response = await handler(createEvent(body))

    expect(authHandler).toHaveBeenCalledTimes(1)

    const request = authHandler.mock.calls[0]![0] as Request

    expect(await request.json()).toEqual({
      accept: false,
      oauth_query: body.oauth_query,
    })
    expect(response).toEqual({
      location: CLIENT_REDIRECT_URL,
      status: SEE_OTHER,
    })
  })

  it('lets a denial through when no scope is selected', async () => {
    const handler = await getHandler()
    const body = validBody({ decision: 'deny', scope: [] })
    const response = await handler(createEvent(body))

    expect(response).toMatchObject({ location: CLIENT_REDIRECT_URL })
  })

  it('maps a Better Auth 429 to rate_limited', async () => {
    authHandler.mockResolvedValue(
      betterAuthResponse({ message: 'Too many requests' }, { status: 429 }),
    )

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'rate_limited'),
      status: SEE_OTHER,
    })
  })

  it.each([400, 500])('maps a Better Auth %i to failed', async (status) => {
    authHandler.mockResolvedValue(
      betterAuthResponse({ message: 'nope' }, { status }),
    )

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'failed'),
      status: SEE_OTHER,
    })
  })

  it('maps a 200 without a redirect url to failed', async () => {
    authHandler.mockResolvedValue(betterAuthResponse({ redirect: false }))

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'failed'),
      status: SEE_OTHER,
    })
  })

  it('maps a 200 with an unreadable body to failed', async () => {
    authHandler.mockResolvedValue(new Response('not json', { status: 200 }))

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'failed'),
      status: SEE_OTHER,
    })
  })

  it('maps a thrown Better Auth handler to failed', async () => {
    authHandler.mockRejectedValue(new Error('boom'))

    const handler = await getHandler()
    const body = validBody()
    const response = await handler(createEvent(body))

    expect(response).toEqual({
      location: consentErrorUrl(body.oauth_query, 'failed'),
      status: SEE_OTHER,
    })
  })
})

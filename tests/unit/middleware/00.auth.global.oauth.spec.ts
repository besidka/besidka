import { ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import authMiddleware from '../../../app/middleware/00.auth.global'

const mocks = vi.hoisted(() => ({
  loggedIn: false,
  navigateTo: vi.fn((target: unknown, _options?: unknown) => target),
  fetchSession: vi.fn(async () => undefined),
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: {
      get value() {
        return mocks.loggedIn
      },
    },
    options: {
      redirectUserTo: '/chats/new',
      redirectGuestTo: '/signin',
    },
    fetchSession: mocks.fetchSession,
    user: ref(null),
  })
})

mockNuxtImport('navigateTo', () => mocks.navigateTo)

const FUTURE_EXP = '4102444800'
const PAST_EXP = '946684800'

function signedQuery(overrides: Record<string, unknown> = {}) {
  const query: Record<string, unknown> = {
    client_id: 'client-1',
    scope: 'openid chats:read',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    exp: FUTURE_EXP,
    ...overrides,
  }

  return {
    ...query,
    ba_param: [...Object.keys(query), 'ba_param'].sort(),
    sig: 'signature',
  }
}

function buildRoute(
  path: string,
  query: Record<string, unknown>,
  only: 'guest' | 'user',
) {
  return {
    path,
    fullPath: path,
    query,
    meta: { auth: { only } },
  } as any
}

describe('global auth middleware with a signed OAuth request', () => {
  beforeEach(() => {
    mocks.loggedIn = false
    mocks.navigateTo.mockClear()
  })

  it('lets a signed-out user stay on /signin with the request', async () => {
    await authMiddleware(buildRoute('/signin', signedQuery(), 'guest'), {} as any)

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('sends a signed-out user from the consent page to /signin with the '
    + 'signed query intact', async () => {
    const query = { ...signedQuery(), utm_source: 'reddit' }

    await authMiddleware(
      buildRoute('/oauth/consent', query, 'user'),
      {} as any,
    )

    const target = mocks.navigateTo.mock.calls[0]![0] as {
      path: string
      query: Record<string, unknown>
    }

    expect(target.path).toBe('/signin')
    expect(target.query).toMatchObject({
      sig: 'signature',
      client_id: 'client-1',
      exp: FUTURE_EXP,
    })
    expect(target.query).not.toHaveProperty('utm_source')
  })

  it('does not bounce a signed-in user who must sign in again', async () => {
    mocks.loggedIn = true

    await authMiddleware(
      buildRoute('/signin', signedQuery({ prompt: 'login' }), 'guest'),
      {} as any,
    )

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('does not bounce a signed-in user when max_age is set', async () => {
    mocks.loggedIn = true

    await authMiddleware(
      buildRoute('/signin', signedQuery({ max_age: '60' }), 'guest'),
      {} as any,
    )

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('resumes the authorization for a signed-in user instead of /chats/new',
    async () => {
      mocks.loggedIn = true

      await authMiddleware(
        buildRoute('/signin', signedQuery(), 'guest'),
        {} as any,
      )

      const [target, options] = mocks.navigateTo.mock.calls[0]!

      expect(String(target)).toMatch(/^\/api\/auth\/oauth2\/authorize\?/)
      expect(String(target)).not.toContain('sig=')
      expect(options).toEqual({ external: true })
    })

  it('drops an expired request from the sign-in page', async () => {
    await authMiddleware(
      buildRoute('/signin', signedQuery({ exp: PAST_EXP }), 'guest'),
      {} as any,
    )

    expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
  })

  it('sends a signed-out user with an expired request to /signin', async () => {
    await authMiddleware(
      buildRoute('/oauth/consent', signedQuery({ exp: PAST_EXP }), 'user'),
      {} as any,
    )

    expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
  })

  it('ignores a query that only looks signed', async () => {
    mocks.loggedIn = true

    await authMiddleware(
      buildRoute('/signin', { sig: 'signature' }, 'guest'),
      {} as any,
    )

    expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/new')
  })
})

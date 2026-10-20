import { ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import authMiddleware from '../../../app/middleware/00.auth.global'

const mocks = vi.hoisted(() => ({
  loggedIn: false,
  navigateTo: vi.fn((target: string) => target),
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

function buildRoute(
  path: string,
  query: Record<string, unknown>,
  only: 'guest' | 'user' | undefined = 'guest',
  fullPath: string = path,
) {
  return {
    path,
    fullPath,
    query,
    meta: { auth: only ? { only } : undefined },
  } as any
}

describe('global auth middleware', () => {
  beforeEach(() => {
    mocks.loggedIn = false
    mocks.navigateTo.mockClear()
    mocks.fetchSession.mockClear()
  })

  describe('guest-only page visited while signed in', () => {
    beforeEach(() => {
      mocks.loggedIn = true
    })

    it('redirects to the default destination without a next value',
      async () => {
        await authMiddleware(buildRoute('/signup', {}), {} as any)

        expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/new')
      })

    it('honours a safe next value', async () => {
      await authMiddleware(
        buildRoute('/signup', { next: '/profile/keys?provider=google' }),
        {} as any,
      )

      expect(mocks.navigateTo)
        .toHaveBeenCalledWith('/profile/keys?provider=google')
    })

    it('honours a safe next value on /signin as well', async () => {
      await authMiddleware(
        buildRoute('/signin', { next: '/profile/keys' }),
        {} as any,
      )

      expect(mocks.navigateTo).toHaveBeenCalledWith('/profile/keys')
    })

    it.each([
      ['//evil.com'],
      ['https://evil.com'],
      ['/chats/123'],
      ['/signin'],
    ])('ignores the unsafe next value %j', async (unsafeNext) => {
      await authMiddleware(
        buildRoute('/signup', { next: unsafeNext }),
        {} as any,
      )

      expect(mocks.navigateTo).toHaveBeenCalledWith('/chats/new')
    })

    it('does not redirect when already on the default destination',
      async () => {
        const result = await authMiddleware(
          buildRoute('/chats/new', { next: '/profile/keys' }),
          {} as any,
        )

        expect(result).toBeUndefined()
        expect(mocks.navigateTo).not.toHaveBeenCalled()
      })
  })

  it('lets a signed-out visitor reach a guest-only page', async () => {
    const result = await authMiddleware(
      buildRoute('/signup', { next: '/profile/keys' }),
      {} as any,
    )

    expect(result).toBeUndefined()
    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  describe('user-only page visited while signed out', () => {
    it('sends the visitor to /signin and remembers an allowlisted page',
      async () => {
        await authMiddleware(
          buildRoute(
            '/profile/keys',
            { provider: 'google' },
            'user',
            '/profile/keys?provider=google',
          ),
          {} as any,
        )

        expect(mocks.navigateTo).toHaveBeenCalledWith({
          path: '/signin',
          query: { next: '/profile/keys?provider=google' },
        })
      })

    it('remembers the bare keys page', async () => {
      await authMiddleware(
        buildRoute('/profile/keys', {}, 'user'),
        {} as any,
      )

      expect(mocks.navigateTo).toHaveBeenCalledWith({
        path: '/signin',
        query: { next: '/profile/keys' },
      })
    })

    it('omits next when the page is the default destination', async () => {
      await authMiddleware(
        buildRoute('/chats/new', {}, 'user', '/chats/new?project=abc'),
        {} as any,
      )

      expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
    })

    it('omits next for a page outside the allowlist', async () => {
      await authMiddleware(
        buildRoute('/chats/abc', {}, 'user', '/chats/abc#message-3'),
        {} as any,
      )

      expect(mocks.navigateTo).toHaveBeenCalledWith('/signin')
    })

    it('does not loop when already on the guest redirect target',
      async () => {
        const result = await authMiddleware(
          buildRoute('/signin', {}, 'user'),
          {} as any,
        )

        expect(result).toBeUndefined()
        expect(mocks.navigateTo).not.toHaveBeenCalled()
      })
  })
})
